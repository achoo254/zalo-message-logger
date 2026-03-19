# Zalo Message Logger - Project Overview & PDR

## Mục đích Dự án

Phát triển tiện ích Chrome/Edge (Manifest v3) tự động ghi lại tin nhắn từ Zalo Web, gửi thông báo Telegram theo bộ lọc tùy chỉnh, và hỗ trợ trả lời từ Telegram trực tiếp tới Zalo mà không cần mở Zalo.

## Các Bên Liên Quan

| Vai Trò | Mô Tả |
|---------|-------|
| **Users** | Người dùng Zalo Web cần theo dõi/lưu trữ tin nhắn, nhận thông báo Telegram |
| **Maintainer** | Cá nhân phát triển + bảo trì tiện ích |
| **Zalo Service** | API/DOM tại chat.zalo.me (không có API công khai) |
| **Telegram Bot API** | Bot Token, sendMessage, getUpdates, editMessageText |

## Phạm Vi (Scope)

### Bao Gồm
- Ghi lại tin nhắn từ chat tích cực + sidebar preview
- Lọc tin nhắn theo user, keyword, conversation, content type
- Gửi thông báo tới Telegram Bot API
- Trả lời Telegram → Zalo (DOM automation)
- Lưu trữ cục bộ (chrome.storage.local)
- Xuất JSON dữ liệu
- Cấu hình rules UI

### Không Bao Gồm
- API Zalo chính thức (không công khai)
- Webhook thay vì long-polling Telegram
- Web UI riêng (chỉ popup extension)
- Đồng bộ multi-device
- Mã hóa dữ liệu
- Support cho Zalo Mobile

## Yêu Cầu Chức Năng (Functional Requirements)

| # | Yêu Cầu | Mô Tả |
|---|---------|-------|
| FR-1 | DOM Polling | Quét DOM 2s/lần để phát hiện tin nhắn mới (text, image, file, sticker) |
| FR-2 | Dedup | Tránh ghi lại tin nhắn trùng (frame ID + sidebar anim-data-id) |
| FR-3 | Telegram Notify | Gửi tin nhắn Zalo tới Telegram nếu khớp rules (max 500 ID dedup) |
| FR-4 | Inline Reply | Nút "↩️ [Tên]" trên mỗi thông báo → prompt force-reply |
| FR-5 | Long-polling | Lấy updates từ Telegram (timeout 25s, offset tracking) |
| FR-6 | Send to Zalo | Tìm conversation → click → type + Enter (với guard isSending) |
| FR-7 | Storage Quota | Tự động xóa khi >8MB (giới hạn 1000 msg/conv, 200 msg khi cleanup) |
| FR-8 | Popup UI | Tabs: Messages (filter, export, stats) + Telegram (config, rules) |
| FR-9 | Auto-save | Lưu config/rules tự động khi nhập (debounce 500ms) |
| FR-10 | Badge Counter | Hiển thị số tin nhắn chưa đọc, xóa khi mở popup |

## Yêu Cầu Phi Chức Năng (Non-Functional Requirements)

| # | Yêu Cầu | Tiêu Chuẩn |
|---|---------|-----------|
| NFR-1 | Performance | Poll 2s/lần không làm lag Zalo Web, async/await xử lý Telegram |
| NFR-2 | Security | Không lưu bot token/chat ID plaintext ngoài storage; HTML escape Telegram; Zalo no credentials |
| NFR-3 | Reliability | Retry error handling Telegram, keepalive alarm, no hard crashes |
| NFR-4 | Usability | Config rõ ràng, status feedback (Success/Error), test connection button |
| NFR-5 | Compatibility | Chrome/Edge MV3, chat.zalo.me chỉ (không mobile app) |
| NFR-6 | Storage | Max 8MB chrome.storage.local; auto-cleanup >1000 msg/conv |

## Kiến Trúc Tổng Quan

```
┌─ Zalo Web (chat.zalo.me)
│  ├─ inject.js (MAIN_WORLD, DOM polling 2s)
│  │  ├─ Chat area: message-frame_* elements
│  │  └─ Sidebar: .msg-item[data-id] previews
│  └─ content-script.js (bridge)
│
├─ Service Worker (service-worker.js)
│  ├─ Message listener → storeMessage() → chrome.storage.local
│  ├─ checkAndNotifyTelegram() → telegram-notifier.js
│  ├─ Alarm keepalive (0.5 min) → restart polling
│  └─ Badge counter (unread count)
│
├─ Telegram (long-polling)
│  └─ telegram-reply-poller.js
│     ├─ getUpdates (offset, timeout=25s)
│     ├─ callback_query (inline button) → force-reply prompt
│     ├─ message.reply_to_message → parseConversationIdFromReply()
│     └─ sendReplyToZaloTab() → ZALO_SEND_MSG
│
└─ Popup UI (popup/popup.{html,js,css})
   ├─ Messages tab: filter, search, export, clear, toggle logging
   └─ Telegram tab: config (token, chatId, topicId, replyEnabled) + rules CRUD
```

## Dữ Liệu Cơ Bản

### Message Object
```javascript
{
  id: string,                 // frame-id (chat area) hoặc sidebar_animDataId_timestamp
  direction: 'incoming'|'outgoing',
  sender: string,             // người gửi (hoặc 'me' nếu outgoing)
  content: string,            // text hoặc [image]/[file]/[sticker]
  contentType: 'text'|'image'|'file'|'sticker'|'unknown',
  conversationId: string,     // tên chat/group
  timestamp: number,          // Date.now()
  timeDisplay: string,        // "Hôm nay 14:30" từ Zalo UI
  source?: 'sidebar-preview',
  hasUnread?: boolean,
}
```

### Storage Keys
- `messages_{conversationId}` → Message[]
- `meta_stats` → {totalCount, lastUpdated}
- `telegram_config` → {enabled, botToken, chatId, topicId, replyEnabled}
- `telegram_rules` → Rule[]
- `telegram_last_update_id` → number
- `reply_prompt_{messageId}` → {chatId, sender, conversationId, preview}
- `logging_enabled` → boolean

### Rule Object
```javascript
{
  type: 'user'|'keyword'|'conversation'|'content_type',
  value: string,
  direction: 'all'|'incoming'|'outgoing',
}
```

## Luồng Chính

### 1. Ghi Tin Nhắn Zalo
```
inject.js (poll 2s)
  → extractMessage(msgFrame)
  → window.postMessage(ZALO_DOM_MSG)
  → content-script.js
    → chrome.runtime.sendMessage()
      → service-worker.js
        → storeMessage() → chrome.storage.local
        → incrementBadge()
        → checkAndNotifyTelegram()
          → matchRules() → Telegram API (sendMessage)
```

### 2. Trả Lời từ Telegram
```
getUpdates (long-poll 25s)
  → callback_query (inline button)
    → answerCallbackQuery() (dismiss loading)
    → handleCallbackQuery()
      → parseConversationIdFromReply()
      → sendMessage (force_reply prompt)
        ↓ User replies
      → message.reply_to_message
        → sendReplyToZaloTab()
          → chrome.tabs.sendMessage(ZALO_SEND_MSG)
            → content-script.js
              → window.postMessage(ZALO_SEND_MSG)
                → inject.js
                  → findAndClickConversation()
                  → waitForInputReady()
                  → typeAndSend() (execCommand + Enter)
                  → window.postMessage(ZALO_SEND_RESULT)
                    ← content-script.js ← service-worker (editMessageText status)
```

## Giới Hạn & Rủi Ro

| Vấn Đề | Tác Động | Giải Pháp |
|--------|----------|-----------|
| DOM không ổn định | Messages bị miss, dedup sai | Polling 2s, SEEN_MSG_IDS set |
| Virtual DOM Zalo | MutationObserver vô dụng | Polling loop dạng imperative |
| Không có Zalo API | Phải DOM scraping | Accept fragility, test trên UI stable |
| Chrome Storage 10MB limit | Mất dữ liệu khi full | Auto-cleanup >8MB: xóa 800 msg/conv |
| Service Worker unload | Mất reply polling nếu không alarm | Keepalive alarm 0.5 min |
| Telegram webhook conflict | getUpdates fail (error 409) | Prompt user: disable webhook |
| Conversation không sidebar | Không tìm được để click | Lỗi: "Conversation not found" |

## Tiêu Chuẩn Kỹ Thuật

- **MV3 only**: no eval, no background script pages, CSP strict
- **MAIN_WORLD inject.js**: access Zalo DOM directly (window, document)
- **ISOLATED content-script.js**: bridge only (postMessage)
- **Service Worker**: stateless per instance, alarm keepalive, storage event listeners
- **Error handling**: try-catch, console logs, Telegram error feedback
- **Dedup**: frame ID (chat) + sidebar anim-data-id + 500 Telegram ID memory

## Tiến Độ Hiện Tại

| Mô Đun | Trạng Thái | Ghi Chú |
|--------|-----------|---------|
| DOM polling (chat + sidebar) | HOÀN THÀNH | Stable, tested |
| Telegram notifications | HOÀN THÀNH | Rule matching, HTML escape |
| Long-polling replies | HOÀN THÀNH | 25s timeout, offset tracking |
| Reverse send (Zalo) | HOÀN THÀNH | execCommand + Enter, guards |
| Popup UI | HOÀN THÀNH | Tabs, filters, CRUD rules |
| Auto-save config | HOÀN THÀNH | Debounce 500ms |

## Các Chỉ Số Thành Công

1. **Tin nhắn ghi lại**: Tất cả tin nhắn Zalo (text, media) được phát hiện trong 2-4s
2. **Thông báo Telegram**: 100% tin nhắn khớp rule được gửi, dedup hoàn hảo
3. **Trả lời**: Tin nhắn Telegram trả lời được gửi tới Zalo, status cập nhật
4. **Storage**: Không crash khi >8MB, auto-cleanup logic hoạt động
5. **Uptime**: Service worker không tắt liên tục, alarm keepalive đều hoạt động
6. **UX**: Popup load <1s, config save instant (debounce), status feedback rõ ràng

## Công Nghệ Stack

| Lớp | Công Nghệ | Lý Do |
|-----|-----------|-------|
| Runtime | Chrome/Edge MV3 | Chỉ hỗ trợ extension |
| DOM | Vanilla JS (no jQuery) | MV3 CSP không cho eval |
| Storage | chrome.storage.local | Extension built-in |
| API | Telegram Bot API | Long-polling, no webhook needed |
| UI | Vanilla HTML/CSS/JS | Minimal popup |

## Phiên Bản & Changelog

**v0.1.0** (Hiện tại)
- Ghi lại tin nhắn Zalo
- Thông báo Telegram với rules
- Trả lời Telegram → Zalo
- Popup UI + config

## Khuyến Nghị Tương Lai

1. **Persistent Storage**: Consider IndexedDB or Firestore nếu >8MB
2. **Web UI**: Standalone dashboard để quản lý dữ liệu, stats
3. **Encryption**: Encrypt bot token/chat ID tại rest
4. **Multi-device sync**: Cloud sync dữ liệu tin nhắn
5. **Advanced Filters**: Regex rules, schedule-based muting
6. **Zalo API**: Nếu Zalo công khai API, replace DOM scraping
7. **Sticker/Media**: Tải xuống và attach media vào Telegram
8. **Group reply context**: Quote sender + conversation trong reply
