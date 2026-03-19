# Zalo Message Logger - Codebase Summary

Tổng: **11 files, 13,088 tokens, 1,100+ LOC**

## Tệp Chính (Root)

### manifest.json (27 LOC)
**Mục đích**: Khai báo MV3 extension
**Chi tiết**:
- `permissions`: storage, alarms
- `host_permissions`: https://chat.zalo.me/*
- `service_worker`: service-worker.js (background)
- `content_scripts`: 2 scripts
  - inject.js (MAIN_WORLD, DOM access)
  - content-script.js (bridge)
- `action.default_popup`: popup/popup.html

---

### inject.js (314 LOC, 19.1% token)
**Mục đích**: DOM polling MAIN_WORLD - quét tin nhắn Zalo mỗi 2s
**Hàm Chính**:
- `getConversationName()` - Lấy tên chat từ input placeholder hoặc header (3 sources)
- `getSenderName(msgFrame, isOutgoing)` - Tên người gửi (xử lý group chat)
- `extractMessage(msgFrame)` - Trích xuất: id, direction, sender, content, contentType, timestamp
- `pollMessages()` - Quét message-frame_* elements, dedup SEEN_MSG_IDS
- `pollSidebar()` - Quét sidebar previews (.msg-item[anim-data-id]), dedup by SIDEBAR_PREVIEWS map
- `findAndClickConversation(conversationId)` - Click sidebar item để mở chat
- `waitForInputReady(maxWaitMs=5000)` - Poll #richInput cho đến khi visible
- `typeAndSend(text)` - Focus → execCommand('insertText') → Enter key event
- `handleSendMessage(conversationId, text)` - Orchestrator: find → wait → send (guard isSending=true/false)
- `init()` - Chờ chat load, start polling 2s

**Dedup Logic**:
- Chat area: SEEN_MSG_IDS set (frame ID)
- Sidebar: SIDEBAR_PREVIEWS map (anim-data-id → preview text)
- Max message length: 2000 chars

**Event Listener**:
- window.message (type='ZALO_SEND_MSG') → handleSendMessage() → postMessage('ZALO_SEND_RESULT')

---

### content-script.js (48 LOC, bridge)
**Mục đích**: Cầu nối inject.js (MAIN_WORLD) ↔ service-worker
**Hàm Chính**:
- Forward: window.message(ZALO_DOM_MSG) → chrome.runtime.sendMessage()
- Reverse: chrome.runtime.onMessage(ZALO_SEND_MSG) → window.postMessage() + correlation ID
- Timeout fallback: 10s → error response

**Correlation ID**: Đảm bảo match request/response giữa ISOLATED ↔ MAIN_WORLD

---

### service-worker.js (123 LOC, background)
**Mục đích**: Nhận tin nhắn, lưu storage, notify Telegram, quản lý alarm
**Hàm Chính**:
- `storeMessage(msg)` - Lưu vào messages_{conversationId}, dedup, cap 1000/conv, update stats
- `updateStats(addCount)` - Cộng meta_stats.totalCount, lastUpdated=now
- `checkStorageQuota()` - Kiểm >8MB → cleanup
- `cleanupOldMessages()` - Giảm mỗi conversation xuống 200 msg nếu >200
- `incrementBadge()` - Badge text = unreadCount, color=#4CAF50 (green)

**Message Handler** (chrome.runtime.onMessage):
- Guard: logging_enabled !== false
- storeMessage() → incrementBadge() → checkAndNotifyTelegram()

**Alarm Handler** (chrome.alarms.onAlarm):
- Keepalive cho REPLY_POLL_ALARM (0.5 min)
- Restart pollLoop nếu isPolling=false

**Storage Listener** (chrome.storage.onChanged):
- telegram_config thay đổi → startReplyPolling() / stopReplyPolling()

**Port Listener** (chrome.runtime.onConnect):
- Popup mở (port.name='popup') → reset badge text

---

### telegram-notifier.js (130 LOC, 8.4% token)
**Mục đích**: Rule matching + Telegram notification gửi
**Hàm Chính**:
- `escapeHtmlTelegram(str)` - Escape &<> để prevent injection
- `matchRules(msg, rules)` - Check message khớp ANY rule (OR logic)
  - Types: user, keyword, conversation, content_type
  - Directions: all, incoming, outgoing
- `sendTelegramMessage(config, msg)` - Telegram Bot API sendMessage
  - Format: **Sender** / 📍 Conversation / 🕐 Time / Content
  - Inline button: "↩️ [Sender]" callback_data='reply'
  - Topic ID support (message_thread_id)
- `parseConversationIdFromReply(text)` - Extract từ "📍 Name" line
- `parseSenderFromReply(text)` - Extract sender từ line đầu (plain text, no HTML)
- `checkAndNotifyTelegram(msg)` - Main entry
  - Guard: enabled, botToken, chatId, rules not empty
  - Dedup: TELEGRAM_SENT_IDS set (max 500)
  - matchRules() → sendTelegramMessage()

---

### telegram-reply-poller.js (252 LOC, 17% token)
**Mục đích**: Long-poll Telegram getUpdates, xử lý reply → gửi Zalo
**Hàm Chính**:
- `startReplyPolling()` - Create alarm (0.5 min), start pollLoop()
- `stopReplyPolling()` - Clear alarm, set isPolling=false
- `pollLoop()` - While isPolling: handleReplyPoll() (error: back off 5s)
- `handleReplyPoll()` - Single long-poll cycle
  - getUpdates(offset, timeout=25s)
  - Guard: enabled, replyEnabled, botToken, chatId
  - Loop updates: track maxUpdateId
  - callback_query → handleCallbackQuery()
  - message.reply_to_message → parseConversationIdFromReply() → sendReplyToZaloTab()
  - Save telegram_last_update_id
- `handleCallbackQuery(config, callbackQuery)` - Inline button press
  - answerCallbackQuery() (dismiss loading)
  - Parse original sender + conversation
  - sendMessage(force_reply=true) → reply_prompt_${msgId} storage
- `answerCallbackQuery(config, id, text)` - Dismiss button loading
- `editTelegramMessage(config, chatId, msgId, text)` - Update prompt message (✅ Sent / ❌ Failed)
- `sendReplyToZaloTab(config, conversationId, text)` - Find Zalo tab → chrome.tabs.sendMessage()
  - Guard: tab open, response.ok
  - Error: sendTelegramError()
- `sendTelegramError(config, errorMsg)` - Report error back to Telegram

**Long-polling Logic**:
- offset = last_update_id + 1
- timeout = 25s (Telegram holds connection)
- Instant return khi có update mới

**Reverse Flow**:
- User replies to force-reply prompt
- getUpdates detects reply
- parseConversationIdFromReply() → sendReplyToZaloTab() → ZALO_SEND_MSG
- editMessageText status (✅/❌)

---

## Popup UI (popup/)

### popup.html (81 LOC)
**Tabs**:
1. **Messages** (tab-messages)
   - Stats: total count, storage used, last updated
   - Filters: direction (All/In/Out), keyword search, conversation select
   - Actions: Export JSON, Clear All, Refresh, toggle logging checkbox
   - Message list div

2. **Telegram** (tab-telegram)
   - Enable notifications checkbox
   - Enable reply checkbox
   - Bot Token (password input)
   - Chat ID, Topic ID (text input)
   - Rules list + Add button
   - Test & Save buttons
   - Status message

---

### popup.js (~120 LOC, 11.2% token)
**Mục đích**: Message tab logic - load, filter, export, stats
**Hàm Chính**:
- `loadMessages()` - Fetch all messages_* keys, render
- `filterMessages()` - Apply direction/keyword/conversation filters
- `renderMessages(filtered)` - Build message list HTML
- `formatTime(timestamp)` - Convert to local string
- `exportJSON()` - Download JSON file all messages
- `clearAllMessages()` - Confirm + delete all storage
- `updateStats()` - Display total count, storage used, last updated
- `toggleLogging(enabled)` - Set logging_enabled in storage
- `loadConversationFilter()` - Populate dropdown from all convIds

**Event Listeners**:
- Tab buttons (click) → show panel
- Filters (change/input) → rerender
- Actions buttons (click) → export/clear/refresh/toggle

---

### popup.css (~100 LOC)
**Styling**:
- Body: 400px width, 500px max-height, Segoe UI
- Stats: #f5f5f5 bg, 12px font
- Filters: flexbox gap 4px
- Rules: CRUD UI (.tg-rule, .tg-rule-type, .tg-rule-value, .tg-rule-direction)
- Actions: buttons, checkboxes
- Message list: scroll, message item cards

---

### telegram-settings.js (193 LOC, 11.7% token)
**Mục đích**: Telegram config + rules CRUD
**Hàm Chính**:
- `loadTelegramConfig()` - Load telegram_config + telegram_rules → render form
- `saveTelegramConfig()` - Save config (validation) + rules to storage
- `renderRules()` - Render rule items with dropdowns (type, value, direction)
- `addRule()` - Push default rule, rerender
- `deleteRule(index)` - Remove rule, rerender
- `collectRules()` - Extract rules from form (skip empty value)
- `testConnection()` - Send test message to Telegram
- `showStatus(text, isError)` - Display feedback (green/red, auto-clear 2s)
- `scheduleAutoSave()` - Debounce 500ms → saveTelegramConfig()
- `escapeAttr(str)` - HTML attr escape

**Auto-save Events**:
- Input: botToken, chatId, topicId
- Change: enabled, replyEnabled, rule fields
- Click: addRule, deleteRule

**Validation**:
- Bot token format (must contain ':')
- Empty values skip on save

**Status Feedback**:
- "Saved!" (green, 2s)
- "Testing..." (during fetch)
- "Error: {description}" (red, persistent)

---

## Storage Schema

```javascript
chrome.storage.local keys:
├── messages_{conversationId}     // Message[]
├── meta_stats                    // {totalCount, lastUpdated}
├── logging_enabled               // boolean
├── telegram_config               // {enabled, botToken, chatId, topicId, replyEnabled}
├── telegram_rules                // Rule[]
├── telegram_last_update_id       // number (for getUpdates offset)
└── reply_prompt_{msgId}          // {chatId, sender, conversationId, preview}
```

## Message Flow Diagram

```
Zalo Web DOM (chat.zalo.me)
    ↓ (poll 2s)
inject.js:extractMessage() [MAIN_WORLD]
    ↓ window.postMessage(ZALO_DOM_MSG)
content-script.js:forward
    ↓ chrome.runtime.sendMessage()
service-worker.js:onMessage
    ├─ storeMessage() → messages_{convId}
    ├─ incrementBadge()
    └─ checkAndNotifyTelegram()
        ├─ matchRules()
        └─ Telegram API: sendMessage + inline button

Telegram Polling (service-worker.js start)
    ↓ telegram-reply-poller.js:pollLoop()
    ↓ getUpdates(offset, timeout=25s)
    ├─ callback_query → handleCallbackQuery() → force-reply prompt
    └─ message.reply_to_message → parseConversationIdFromReply()
        ↓ sendReplyToZaloTab()
        ↓ chrome.tabs.sendMessage(ZALO_SEND_MSG)
        ↓ content-script.js:reverse
        ↓ window.postMessage(ZALO_SEND_MSG) [MAIN_WORLD]
        ↓ inject.js:handleSendMessage()
        ├─ findAndClickConversation()
        ├─ waitForInputReady()
        ├─ typeAndSend(text)
        └─ postMessage(ZALO_SEND_RESULT)
            ↓ editTelegramMessage(status)
```

## Bảng Tóm Tắt Tệp

| Tệp | LOC | Tokens | % | Mục Đích |
|-----|-----|--------|---|----------|
| inject.js | 314 | 2,503 | 19.1 | DOM polling + reverse send |
| telegram-reply-poller.js | 252 | 2,231 | 17 | Long-poll Telegram → Zalo |
| telegram-settings.js | 193 | 1,533 | 11.7 | Config + rules UI |
| popup.js | 120 | 1,462 | 11.2 | Message tab logic |
| telegram-notifier.js | 130 | 1,094 | 8.4 | Rule matching + notify |
| service-worker.js | 123 | ~900 | 6.9 | Storage + badge + alarm |
| content-script.js | 48 | ~400 | 3.1 | MAIN_WORLD ↔ worker bridge |
| popup.html | 81 | ~350 | 2.7 | UI structure |
| popup.css | 100 | ~300 | 2.3 | Styling |
| manifest.json | 27 | ~130 | 1 | MV3 config |
| **TOTAL** | **1,168** | **13,088** | **100** | |

## Công Nghệ & Design Patterns

| Pattern | Nơi Dùng | Lý Do |
|---------|----------|-------|
| **Polling** | inject.js (2s) | MutationObserver không đáng tin trên virtual DOM |
| **Dedup with Set** | SEEN_MSG_IDS, TELEGRAM_SENT_IDS | O(1) lookup, prevent duplicates |
| **Long-polling** | telegram-reply-poller.js | Real-time updates, no webhook |
| **Debounce** | auto-save (500ms) | Prevent excessive storage writes |
| **Event bridge** | window.postMessage + chrome.runtime | ISOLATED ↔ MAIN_WORLD communication |
| **Correlation ID** | content-script.js | Match async request/response |
| **Guard clauses** | storeMessage, handleReplyPoll | Early return, fail-safe |
| **Auto-cleanup** | checkStorageQuota (>8MB) | Prevent storage exhaustion |
| **Keepalive alarm** | service-worker.js (0.5 min) | Prevent unload + restart polling |

## Performance Notes

- **Poll interval**: 2s → balance latency vs CPU
- **Telegram timeout**: 25s → minimize requests, quick response
- **Debounce**: 500ms → smooth input, batch saves
- **Dedup max**: 500 Telegram IDs, 1000 msgs/conv → memory bounded
- **Storage cleanup**: Triggered every 100 messages → distributed cost

## Security Considerations

- **Bot Token**: Stored plaintext in chrome.storage.local (encrypted by Chrome)
- **HTML Escape**: escapeHtmlTelegram() prevents Telegram injection
- **Zalo**: No credentials stored; DOM automation only
- **MV3 CSP**: No eval, no inline scripts, no remote JS
- **IPC**: Only window.postMessage to self, chrome.runtime to same extension

## Known Limitations

1. **DOM fragility**: Zalo UI changes break selectors (monitor in issues)
2. **Sidebar-only reply**: Conversations must be in sidebar to click
3. **No media download**: Sticker/image → "[image]" text only
4. **Storage 8MB cap**: Mất data khi cleanup (auto-delete oldest)
5. **Telegram webhook conflict**: Must disable if set (error 409)
6. **Single Zalo tab**: Only first tab of chat.zalo.me used for replies
