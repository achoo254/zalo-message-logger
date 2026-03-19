# Zalo Message Logger - Code Standards

## Cấu Trúc Dự Án

```
zalo-message-logger/
├── manifest.json              # MV3 extension config
├── service-worker.js          # Background service worker
├── inject.js                  # MAIN_WORLD DOM polling (315 LOC)
├── content-script.js          # ISOLATED content script bridge (48 LOC)
├── telegram-notifier.js       # Rule matching + notification (130 LOC)
├── telegram-reply-poller.js   # Long-poll Telegram (252 LOC)
├── popup/
│   ├── popup.html            # Popup UI structure
│   ├── popup.js              # Message tab logic
│   ├── popup.css             # Popup styling
│   └── telegram-settings.js  # Telegram config CRUD (193 LOC)
├── docs/
│   ├── install.png           # Installation screenshot
│   ├── popup.png             # Popup UI screenshot
│   ├── telegram.png          # Telegram settings screenshot
│   ├── project-overview-pdr.md
│   ├── codebase-summary.md
│   ├── code-standards.md
│   ├── system-architecture.md
│   └── project-roadmap.md
└── README.md
```

## Quy Ước Đặt Tên

### JavaScript Files
- **Kebab-case** cho tệp JS: inject.js, content-script.js, service-worker.js, telegram-notifier.js, telegram-reply-poller.js
- **Mục đích rõ ràng**: Tên tệp thể hiện chức năng chính
- **Không dùng**: index.js, utils.js, helpers.js (quá chung chung)

### Hàm & Biến
- **camelCase** cho hàm: `extractMessage()`, `getConversationName()`, `storeMessage()`
- **camelCase** cho biến: `unreadCount`, `isOutgoing`, `currentRules`
- **SCREAMING_SNAKE_CASE** cho hằng số: `POLL_INTERVAL`, `MAX_REPLY_LENGTH`, `SEEN_MSG_IDS`
- **Leading underscore** cho private: `_parsePrivateData()` (nếu cần)

### CSS Classes & IDs
- **kebab-case** cho class/id: `.msg-item__name`, `.tg-rule`, `#richInput`
- **BEM naming** cho component-heavy: `.tg-rule__field`, `.tg-rule--delete`

### Storage Keys
- **snake_case** cho chrome.storage.local keys: `messages_{conversationId}`, `telegram_config`, `telegram_rules`, `telegram_last_update_id`, `reply_prompt_{msgId}`, `meta_stats`, `logging_enabled`

## Mẫu Mã (Code Style)

### Arrow Functions vs Function Declarations
```javascript
// ✅ Prefer async functions cho handler, polling
async function handleReplyPoll() {
  // ...
}

// ✅ Arrow function cho callback, map/filter
const filtered = messages.filter(m => m.direction === 'incoming');

// ✅ Named arrow function cho exported utility
const extractMessage = (msgFrame) => { /* ... */ };
```

### Guard Clauses & Early Returns
```javascript
// ✅ Guard checks + early return
async function checkAndNotifyTelegram(msg) {
  const config = result.telegram_config;
  if (!config || !config.enabled) return; // Early guard
  if (!config.botToken || !config.chatId) return;
  if (rules.length === 0) return;
  // Main logic follows
}

// ❌ Avoid
async function checkAndNotifyTelegram(msg) {
  const config = result.telegram_config;
  if (config && config.enabled && config.botToken && config.chatId && rules.length > 0) {
    // nested logic
  }
}
```

### Async/Await & Error Handling
```javascript
// ✅ Try-catch với meaningful error log
async function sendTelegramMessage(config, msg) {
  try {
    const res = await fetch(url, { method: 'POST', headers, body });
    const data = await res.json();
    return { ok: data.ok, error: data.ok ? null : data.description };
  } catch (err) {
    console.warn('[ZaloLogger→TG] Error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ✅ Guard async operations
async function storeMessage(msg) {
  const result = await chrome.storage.local.get(key);
  if (!result[key]) return false; // Early guard
  // ...
}
```

### Dedup & Set Management
```javascript
// ✅ Use Set cho O(1) lookup
const SEEN_MSG_IDS = new Set();

function extractMessage(msgFrame) {
  const frameId = msgFrame.id;
  if (!frameId || SEEN_MSG_IDS.has(frameId)) return null;
  SEEN_MSG_IDS.add(frameId);
  // ...
}

// ✅ Bounded dedup
if (TELEGRAM_SENT_IDS.size > TELEGRAM_DEDUP_MAX) {
  const arr = Array.from(TELEGRAM_SENT_IDS);
  arr.splice(0, arr.length - TELEGRAM_DEDUP_MAX); // Keep last N
  TELEGRAM_SENT_IDS.clear();
  arr.forEach(id => TELEGRAM_SENT_IDS.add(id));
}
```

### DOM Manipulation
```javascript
// ✅ querySelector + null check
const input = document.querySelector('#richInput');
if (input && input.offsetParent !== null) {
  // Element visible
}

// ✅ classList for conditional styling
msgFrame.classList.contains('me') // Check outgoing
msgFrame.classList.add('selected')

// ❌ Avoid innerHTML unless sanitized
// ✅ Use textContent for user data
const content = textEl?.textContent?.trim() || '';
```

### Storage Operations
```javascript
// ✅ Destructure + provide defaults
const result = await chrome.storage.local.get(['telegram_config', 'telegram_rules']);
const config = result.telegram_config || {};
const rules = result.telegram_rules || [];

// ✅ Key-based set
await chrome.storage.local.set({
  telegram_config: config,
  telegram_rules: rules,
});

// ✅ Null coalescing for optional fields
const topicId = tgElements.topicId.value.trim() || null;
```

### String Escaping
```javascript
// ✅ Separate escape function, reusable
function escapeHtmlTelegram(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ✅ Use in message formatting
const text = `<b>${escapeHtmlTelegram(msg.sender)}</b>`;

// ✅ Attribute escaping (HTML form)
function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

## Cấu Trúc Mô-đun

### Service Worker (service-worker.js)
```javascript
// 1. Imports (importScripts for MV3)
importScripts('telegram-notifier.js');
importScripts('telegram-reply-poller.js');

// 2. Module state
let unreadCount = 0;

// 3. Chrome event listeners
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { });
chrome.alarms.onAlarm.addListener((alarm) => { });
chrome.storage.onChanged.addListener((changes) => { });

// 4. Main logic (storeMessage, checkAndNotifyTelegram)
async function storeMessage(msg) { }
async function updateStats(addCount) { }

// 5. Specialized logic (storage, badge, cleanup)
async function checkStorageQuota() { }
function incrementBadge() { }
```

### Content Script (content-script.js)
```javascript
// Minimal bridge: ISOLATED ↔ MAIN_WORLD
// 1. Forward: inject.js → service-worker
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'ZALO_DOM_MSG') return;
  chrome.runtime.sendMessage({ type: 'ZALO_DOM_MSG', message: event.data.message });
});

// 2. Reverse: service-worker → inject.js (with correlation ID)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'ZALO_SEND_MSG') return;
  // Send → listen for response → respond
});
```

### MAIN_WORLD Script (inject.js)
```javascript
// 1. Constants
const SEEN_MSG_IDS = new Set();
const POLL_INTERVAL = 2000;
const MAX_REPLY_LENGTH = 2000;

// 2. Module state
let isSending = false;
const SIDEBAR_PREVIEWS = new Map();

// 3. DOM extraction (getConversationName, getSenderName, extractMessage)
function getConversationName() { }
function getSenderName(msgFrame, isOutgoing) { }
function extractMessage(msgFrame) { }

// 4. Polling (pollMessages, pollSidebar)
function pollMessages() { }
function pollSidebar() { }

// 5. Reverse direction (findAndClickConversation, waitForInputReady, typeAndSend)
async function findAndClickConversation(conversationId) { }
async function waitForInputReady(maxWaitMs) { }
async function typeAndSend(text) { }

// 6. Orchestrator
async function handleSendMessage(conversationId, text) { }

// 7. Event listeners + initialization
window.addEventListener('message', (event) => { });
function init() { }
init();
```

### Telegram Modules (telegram-notifier.js, telegram-reply-poller.js)
```javascript
// 1. Utility functions (escape, parse, match)
function escapeHtmlTelegram(str) { }
function parseConversationIdFromReply(text) { }
function matchRules(msg, rules) { }

// 2. API interaction (sendTelegramMessage, getUpdates)
async function sendTelegramMessage(config, msg) { }
async function sendReplyToZaloTab(config, conversationId, text) { }

// 3. State management (polling loop, handlers)
let isPolling = false;
async function pollLoop() { }
async function handleReplyPoll() { }

// 4. Main entry point
async function checkAndNotifyTelegram(msg) { }
```

### Popup UI (popup.js, telegram-settings.js)
```javascript
// 1. DOM element cache
const elements = {
  enabled: document.getElementById('tg-enabled'),
  botToken: document.getElementById('tg-bot-token'),
  // ...
};

// 2. Module state
let currentRules = [];

// 3. Load/Save functions
async function loadTelegramConfig() { }
async function saveTelegramConfig() { }

// 4. CRUD helpers
function renderRules() { }
function addRule() { }
function deleteRule(index) { }

// 5. Validation/Testing
async function testConnection() { }

// 6. UI helpers (debounce, status)
function showStatus(text, isError) { }
let autoSaveTimer = null;
function scheduleAutoSave() { }

// 7. Event listeners + initialization
elements.saveBtn.addEventListener('click', saveTelegramConfig);
loadTelegramConfig();
```

## Kiểu Dữ Liệu & Hình Chữ Ký

### Message Object
```javascript
{
  id: string,                       // frame-id hoặc sidebar_animId_timestamp
  direction: 'incoming' | 'outgoing',
  sender: string,
  content: string,
  contentType: 'text' | 'image' | 'file' | 'sticker' | 'unknown',
  conversationId: string,
  timestamp: number,                // Date.now()
  timeDisplay: string,              // Display format
  source?: 'sidebar-preview',       // Optional
  hasUnread?: boolean,              // Optional
}
```

### Config Object
```javascript
{
  enabled: boolean,
  botToken: string,                 // Format: "123456:ABC-DEF..."
  chatId: string,                   // Format: "-100123456789"
  topicId?: string,                 // Optional
  replyEnabled: boolean,
}
```

### Rule Object
```javascript
{
  type: 'user' | 'keyword' | 'conversation' | 'content_type',
  value: string,                    // Filter value (case-insensitive)
  direction: 'all' | 'incoming' | 'outgoing',
}
```

## Logging & Debugging

### Console Patterns
```javascript
// ✅ Use prefixed logs with direction indicator
console.log(`[ZaloLogger] Found ${newCount} new message(s)`);
console.log(`[ZaloLogger→TG] Sent: ${msg.sender}`);
console.log(`[ZaloLogger←TG] Reply to ${sender}`);

// ✅ Warn for expected errors
console.warn(`[ZaloLogger←TG] Poll loop error:`, err.message);
console.warn(`[ZaloLogger←TG] Callback query error:`, err.message);

// ✅ No sensitive data in logs
console.log(`[ZaloLogger] ${msg.sender}: ${msg.content.slice(0, 30)}`);
```

### Debug Helpers
```javascript
// Storage inspection
chrome.storage.local.get(null, (items) => {
  console.log('All storage:', items);
});

// Message trace
if (newCount > 0) {
  console.log(`[ZaloLogger] Found ${newCount} new(s)`);
}
```

## Performance & Memory

### Polling Optimization
```javascript
// ✅ Bounded dedup (not unbounded growth)
const SEEN_MSG_IDS = new Set();
// Limit: keep recent 1000 frame IDs

// ✅ Skip polling during send
let isSending = false;
function pollMessages() {
  if (isSending) return; // Skip this cycle
}

// ✅ Efficient querySelector
const frames = document.querySelectorAll('div[id^="message-frame_"]');
// Cache selector pattern, not live query
```

### Storage Cleanup
```javascript
// ✅ Auto-cleanup triggered every 100 messages
if (meta_stats && meta_stats.totalCount % 100 === 0) {
  await checkStorageQuota();
}

// ✅ Graduated cleanup: 1000 → 200 per conversation
if (messages.length > 1000) messages.splice(0, messages.length - 1000);
if (msgs.length > 200) await chrome.storage.local.set({ [key]: msgs.slice(-200) });
```

### Debounce Pattern
```javascript
// ✅ Debounce auto-save (500ms)
let autoSaveTimer = null;
function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveTelegramConfig(), 500);
}

// Event handlers call scheduleAutoSave() instead of direct save
tgElements.botToken.addEventListener('input', scheduleAutoSave);
```

## Error Handling Strategy

### Guard Clauses (Fail-safe)
```javascript
// ✅ Early return for invalid state
async function handleReplyPoll() {
  const config = result.telegram_config;
  if (!config || !config.enabled || !config.replyEnabled) {
    isPolling = false;
    return; // Silent fail, expected behavior
  }
  if (!config.botToken || !config.chatId) return;
  // ...
}
```

### API Error Handling
```javascript
// ✅ Network error + response error handling
try {
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) {
    return { ok: false, error: data.description };
  }
  return { ok: true };
} catch (err) {
  console.warn('[ZaloLogger→TG] Error:', err.message);
  return { ok: false, error: err.message };
}
```

### User Feedback
```javascript
// ✅ Show status with timeout
function showStatus(text, isError) {
  tgElements.status.textContent = text;
  tgElements.status.style.color = isError ? '#e53935' : '#4CAF50';
  if (!isError) {
    setTimeout(() => { tgElements.status.textContent = ''; }, 2000);
  }
}
```

## Testing & Validation

### Manual Testing Checklist
- [ ] Ghi tin nhắn từ chat tích cực (text, image, file)
- [ ] Ghi tin nhắn từ sidebar preview
- [ ] Không bị lặp lại (dedup)
- [ ] Thông báo Telegram khớp rules
- [ ] Bấm nút reply → force-reply prompt
- [ ] Trả lời trong Telegram → tin nhắn gửi tới Zalo
- [ ] Status update ✅/❌ trên prompt
- [ ] Config auto-save (500ms debounce)
- [ ] Storage cleanup >8MB
- [ ] Badge counter tăng + reset khi mở popup

### Edge Cases
```javascript
// ✅ Message without text (media only)
contentType = 'text';
if (!content) {
  if (msgFrame.querySelector('[data-id*="Img"]')) contentType = 'image';
  // ...
  content = `[${contentType}]`;
}

// ✅ Group chat without sender name (fallback)
const sender = senderEl?.textContent?.trim() || getConversationName() || '?';

// ✅ Empty rules (skip notify)
if (rules.length === 0) return;

// ✅ Conversation not in sidebar (error with context)
if (!target) {
  return { ok: false, error: `Conversation not found: ${conversationId}` };
}
```

## Công Cụ & Tiện Ích

### Chrome DevTools
- **Extension DevTools**: chrome://extensions → Zalo Message Logger → Inspect views (service-worker)
- **Console**: Log tin nhắn, kiểm tra storage
- **Network**: Monitor Telegram API calls
- **Storage**: View chrome.storage.local keys

### Testing with repomix
```bash
repomix --output repomix-output.xml
# Review structure, file sizes, token counts
```

## Hướng Dẫn Đóng Góp

### Trước Khi Commit
1. Kiểm tra console log không có lỗi
2. Kiểm tra dedup logic hoạt động (không tin nhắn trùng)
3. Kiểm tra Telegram thông báo gửi đúng cách
4. Kiểm tra storage không vượt quá 8MB
5. Kiểm tra popup load <1s
6. Format code: 2-space indent, no trailing whitespace

### Thêm Tính Năng Mới
1. Tạo helper function ở mô-đun thích hợp (telegram-notifier.js, telegram-reply-poller.js, v.v.)
2. Thêm guard clauses cho invalid input
3. Thêm try-catch cho async operations
4. Thêm console log với prefix [ZaloLogger]
5. Cập nhật docs/codebase-summary.md nếu thêm file/hàm mới

### Sửa Bug
1. Tạo issue với reproduce steps
2. Thêm guard clause để prevent
3. Test edge case
4. Update changelog (xem project-roadmap.md)

## Best Practices

| Pattern | Tại Sao | Ví Dụ |
|---------|--------|-------|
| **Guard clauses** | Fail-safe, dễ đọc | Early return invalid state |
| **Dedup with Set** | O(1) lookup, bounded | SEEN_MSG_IDS, TELEGRAM_SENT_IDS |
| **Debounce auto-save** | Reduce I/O, batch updates | 500ms scheduleAutoSave() |
| **Correlation ID** | Match async req/resp | content-script.js sendMessage |
| **Prefixed logs** | Trace flow direction | [ZaloLogger→TG], [ZaloLogger←TG] |
| **Async/await** | Readable, error handling | try-catch sendTelegramMessage() |
| **Module state** | Encapsulation, isolation | let unreadCount, let isPolling |
| **Separate escape fn** | Reusable, tested | escapeHtmlTelegram(), escapeAttr() |

## Cấm Kỵ

- ❌ eval(), new Function() (MV3 CSP)
- ❌ Inline scripts, style (MV3 CSP)
- ❌ Plaintext bot token in code (use storage)
- ❌ Unbounded dedup (use Set.size check)
- ❌ Synchronous API calls (use async/await)
- ❌ Hardcoded delays without reason (document why)
- ❌ console.log credentials/tokens
- ❌ Direct DOM innerHTML with user data (use textContent, escapeHtml)
