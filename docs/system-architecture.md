# Zalo Message Logger - System Architecture

## Tổng Quan Kiến Trúc

Zalo Message Logger là Chrome/Edge MV3 extension với 3 thành phần chính:
1. **DOM Scraper** (inject.js) - Quét tin nhắn Zalo Web mỗi 2s
2. **Telegram Notifier** (telegram-notifier.js) - Gửi thông báo theo rules
3. **Telegram Poller** (telegram-reply-poller.js) - Long-poll replies → Zalo

```
┌─────────────────────────────────────────────────────────────┐
│                    Zalo Web (chat.zalo.me)                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  DOM Content                                          │   │
│  │  ├─ #richInput (message input)                       │   │
│  │  ├─ div[id^="message-frame_"] (chat messages)        │   │
│  │  ├─ .msg-item[data-id] (sidebar conversations)       │   │
│  │  └─ .chat-title__name, .conv-item-title (names)     │   │
│  └──────────────────────────────────────────────────────┘   │
│                           ▲                                  │
│                           │ DOM access (MAIN_WORLD)         │
│                           │                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  inject.js (MAIN_WORLD, pollMessages 2s)             │   │
│  │  ├─ getConversationName()                            │   │
│  │  ├─ getSenderName()                                  │   │
│  │  ├─ extractMessage() → SEEN_MSG_IDS dedup           │   │
│  │  ├─ pollSidebar() → SIDEBAR_PREVIEWS dedup          │   │
│  │  └─ handleSendMessage() (reverse)                   │   │
│  │      ├─ findAndClickConversation()                  │   │
│  │      ├─ waitForInputReady()                         │   │
│  │      └─ typeAndSend() (execCommand + Enter)         │   │
│  └──────────────────────────────────────────────────────┘   │
│          │ window.postMessage(ZALO_DOM_MSG/ZALO_SEND_MSG)   │
└──────────┼─────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│         content-script.js (ISOLATED context)                 │
│  ├─ Forward: window.message → chrome.runtime.sendMessage()  │
│  └─ Reverse: chrome.runtime.onMessage → window.postMessage()│
│             (with correlation ID matching)                   │
└──────────┬─────────────────────────────────────────────────┘
           │ chrome.runtime.sendMessage/onMessage
           ▼
┌──────────────────────────────────────────────────────────────┐
│          service-worker.js (Background service worker)       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Message Listener                                      │   │
│  │  ├─ ZALO_DOM_MSG → storeMessage()                    │   │
│  │  ├─ incrementBadge()                                 │   │
│  │  └─ checkAndNotifyTelegram()                         │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Storage Management (chrome.storage.local)             │   │
│  │  ├─ messages_{conversationId} (Message[])            │   │
│  │  ├─ meta_stats ({totalCount, lastUpdated})           │   │
│  │  ├─ telegram_config                                  │   │
│  │  ├─ telegram_rules (Rule[])                          │   │
│  │  └─ [auto-cleanup >8MB]                              │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Alarm Handler (keepalive 0.5 min)                    │   │
│  │  └─ Restart pollLoop if killed                       │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Storage Event Listener                                │   │
│  │  └─ telegram_config change → startReplyPolling()     │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────┬─────────────────────────────────────────────────┘
           │
     ┌─────┴──────────────────────────────────────────┬────────┐
     │                                                │        │
     ▼ importScripts('telegram-notifier.js')         ▼        ▼
┌──────────────────────────┐      ┌────────────────────────────────┐
│ telegram-notifier.js     │      │ telegram-reply-poller.js       │
│                          │      │                                │
│ matchRules(msg, rules)   │      │ Long-polling Telegram:         │
│ sendTelegramMessage()    │      │ ├─ getUpdates(offset, 25s)    │
│ escapeHtmlTelegram()     │      │ ├─ offset tracking             │
│ parseConversation*()     │      │ ├─ callback_query (button)    │
│ parseSender*()           │      │ ├─ message.reply_to_message   │
│                          │      │ └─ sendReplyToZaloTab()       │
└──────────────────────────┘      └────────────────────────────────┘
     │                                    │
     └────────────┬─────────────────────┬─┘
                  │                     │
                  ▼                     ▼
            Telegram API           Telegram API
         /sendMessage          /getUpdates, /editMessageText
         /answerCallbackQuery


┌─────────────────────────────────────────────────────────────┐
│              Popup UI (popup/popup.{html,js,css})           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Messages Tab                                          │   │
│  │  ├─ Load all messages_* keys from storage            │   │
│  │  ├─ Filter: direction / keyword / conversation       │   │
│  │  ├─ Display: total count, storage used, last updated │   │
│  │  ├─ Export JSON, Clear All, Refresh, Toggle logging  │   │
│  │  └─ Unread badge counter                             │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Telegram Tab (telegram-settings.js)                   │   │
│  │  ├─ Config: botToken, chatId, topicId                │   │
│  │  ├─ Enable/Disable notifications                     │   │
│  │  ├─ Enable/Disable replies (Telegram → Zalo)         │   │
│  │  ├─ Rules CRUD: type, value, direction               │   │
│  │  ├─ Test connection button                           │   │
│  │  ├─ Auto-save (debounce 500ms)                       │   │
│  │  └─ Status feedback (Success/Error)                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### 1. Forward Flow: Zalo → Telegram Notifications

```
┌────────────────────┐
│  Zalo Web Message  │
│  (DOM change 2s)   │
└────────┬───────────┘
         │
         ▼
┌────────────────────────────────────────┐
│ inject.js:pollMessages()               │
│  ├─ querySelector(message-frame_*)     │
│  ├─ extractMessage(msgFrame)           │
│  │   ├─ frameId dedup (SEEN_MSG_IDS)   │
│  │   ├─ getText(), getSenderName()     │
│  │   ├─ conversationId = getConvName() │
│  │   └─ Return {id, direction, sender} │
│  ├─ window.postMessage(ZALO_DOM_MSG)   │
│  └─ newCount++                         │
└────────┬───────────────────────────────┘
         │ window.postMessage(ZALO_DOM_MSG)
         │ (MAIN_WORLD → bridge)
         ▼
┌────────────────────────────────────────┐
│ content-script.js:message listener     │
│  ├─ Check event.data.type == 'ZALO_DOM_MSG'
│  └─ chrome.runtime.sendMessage()       │
└────────┬───────────────────────────────┘
         │ chrome.runtime.sendMessage()
         │ (ISOLATED → Background)
         ▼
┌────────────────────────────────────────┐
│ service-worker.js:onMessage listener   │
│  ├─ Guard: logging_enabled !== false   │
│  ├─ storeMessage(msg)                  │
│  │   ├─ Get messages_{conversationId}  │
│  │   ├─ dedup by msg.id                │
│  │   ├─ Append to array                │
│  │   ├─ Cap 1000 msgs/conv             │
│  │   └─ Save to storage                │
│  ├─ updateStats()                      │
│  │   ├─ meta_stats.totalCount++        │
│  │   └─ meta_stats.lastUpdated = now   │
│  ├─ incrementBadge()                   │
│  │   ├─ unreadCount++                  │
│  │   └─ setBadgeText()                 │
│  └─ checkAndNotifyTelegram(msg)        │
└────────┬───────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│ telegram-notifier.js:checkAndNotify()  │
│  ├─ Get telegram_config, telegram_rules│
│  ├─ Guard checks (enabled, config)     │
│  ├─ Dedup TELEGRAM_SENT_IDS.has(msg.id)
│  │   └─ Max 500 IDs (LRU rotation)     │
│  ├─ matchRules(msg, rules)             │
│  │   ├─ For each rule (OR logic)       │
│  │   ├─ Check type: user/keyword/conv  │
│  │   ├─ Case-insensitive match         │
│  │   └─ Return true if matched         │
│  └─ sendTelegramMessage()              │
│      ├─ Format text with escape        │
│      │  **Sender**                     │
│      │  📍 Conversation                │
│      │  🕐 Time                        │
│      │  Content                        │
│      ├─ Inline button: "↩️ Sender"     │
│      ├─ POST /sendMessage              │
│      └─ Log result or error            │
└────────┬───────────────────────────────┘
         │ Telegram API: sendMessage
         ▼
    ✅ User receives notification
       with inline reply button
```

### 2. Reverse Flow: Telegram Reply → Zalo

```
┌──────────────────────┐
│ User presses button  │
│ "↩️ Sender" (reply)  │
└────────┬─────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ Telegram Bot: callback_query event       │
└────────┬─────────────────────────────────┘
         │ Long-polling from service-worker
         ▼
┌──────────────────────────────────────────┐
│ telegram-reply-poller.js:handleReplyPoll │
│  ├─ getUpdates(offset, timeout=25s)      │
│  ├─ Loop through data.result[]           │
│  │   ├─ if callback_query                │
│  │   │   └─ handleCallbackQuery()        │
│  │   │       ├─ answerCallbackQuery()    │
│  │   │       ├─ Parse original sender    │
│  │   │       ├─ Extract conversation     │
│  │   │       ├─ Create force-reply prompt│
│  │   │       │   ↩️ Reply to Sender      │
│  │   │       │   📍 Conversation         │
│  │   │       │   Preview of original msg │
│  │   │       │   ✍️ Type your reply:    │
│  │   │       ├─ sendMessage(force_reply) │
│  │   │       └─ Store reply_prompt_{id}  │
│  │   │           in storage              │
│  │   │                                   │
│  │   └─ if message.reply_to_message     │
│  │       └─ User replied to force-reply │
│  │           ├─ parseConversationId()    │
│  │           ├─ parseSenderFromReply()   │
│  │           ├─ Get reply text           │
│  │           └─ sendReplyToZaloTab()    │
│  └─ Save telegram_last_update_id         │
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ sendReplyToZaloTab()                     │
│  ├─ chrome.tabs.query(chat.zalo.me)      │
│  ├─ Guard: tabs.length > 0               │
│  └─ chrome.tabs.sendMessage(ZALO_SEND_MSG)
│      ├─ conversationId                   │
│      └─ text (reply content)             │
└────────┬─────────────────────────────────┘
         │ chrome.tabs.sendMessage()
         ▼
┌──────────────────────────────────────────┐
│ content-script.js:reverse listener       │
│  ├─ Check event.data.type == 'ZALO_SEND_MSG'
│  ├─ Generate correlationId               │
│  └─ window.postMessage(ZALO_SEND_MSG)    │
│      with corrId (for response matching) │
└────────┬─────────────────────────────────┘
         │ window.postMessage()
         ▼
┌──────────────────────────────────────────┐
│ inject.js:message listener               │
│  └─ type == 'ZALO_SEND_MSG'              │
│     └─ handleSendMessage()               │
│         ├─ Guard: !isSending (mutex)     │
│         ├─ isSending = true              │
│         ├─ findAndClickConversation()    │
│         │   ├─ getConversationName()     │
│         │   ├─ Check if already there    │
│         │   ├─ querySelector sidebar     │
│         │   ├─ Find exact match          │
│         │   ├─ target.closest('.msg-item')
│         │   ├─ msgItem.click()           │
│         │   └─ Wait 500ms for UI update  │
│         ├─ waitForInputReady(5000)       │
│         │   ├─ querySelector('#richInput')
│         │   ├─ While offsetParent == null│
│         │   ├─ Wait 200ms, retry         │
│         │   └─ Return true/false         │
│         ├─ typeAndSend(text)             │
│         │   ├─ input.focus()             │
│         │   ├─ input.innerHTML = ''      │
│         │   ├─ execCommand('insertText') │
│         │   ├─ Wait 100ms                │
│         │   ├─ dispatchEvent('keydown')  │
│         │   │   key='Enter', keyCode=13  │
│         │   ├─ Wait 300ms                │
│         │   └─ Return true               │
│         └─ isSending = false             │
│             window.postMessage(ZALO_SEND_RESULT)
└────────┬──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ content-script.js:response handler       │
│  ├─ Match corrId from ZALO_SEND_RESULT   │
│  └─ sendResponse() back to service-worker│
└────────┬─────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ telegram-reply-poller.js (continued)     │
│  ├─ if response.ok                       │
│  │   └─ editMessageText(✅ Sent to...)   │
│  └─ else                                 │
│      └─ editMessageText(❌ Failed: ...)  │
└────────┬─────────────────────────────────┘
         │
         ▼
    ✅ User sees status update
       in Telegram chat
```

## Component Responsibilities

| Component | Trách Nhiệm | Input | Output |
|-----------|-----------|-------|--------|
| **inject.js** | Poll DOM 2s, extract messages, handle reverse send | Document DOM | window.postMessage(ZALO_DOM_MSG), (ZALO_SEND_RESULT) |
| **content-script.js** | Bridge MAIN_WORLD ↔ Background, match req/resp | postMessage, sendMessage | sendMessage, postMessage |
| **service-worker.js** | Receive messages, store, badge, notify, alarm | ZALO_DOM_MSG | Storage writes, incrementBadge(), notify Telegram |
| **telegram-notifier.js** | Match rules, format, send Telegram notification | Message, Config, Rules | Telegram API call |
| **telegram-reply-poller.js** | Long-poll Telegram, handle replies, reverse send | Telegram updates | chrome.tabs.sendMessage(ZALO_SEND_MSG), editMessageText |
| **popup.js** | Display messages, filter, export, stats | chrome.storage | Rendered HTML, JSON export |
| **telegram-settings.js** | Config CRUD, rules management, auto-save | Form inputs | Storage writes, status feedback |

## State Management

### Stateful Components

| Component | State | Scope | Lifetime |
|-----------|-------|-------|----------|
| **inject.js** | `SEEN_MSG_IDS` (Set) | Page-level | Until page reload |
| **inject.js** | `SIDEBAR_PREVIEWS` (Map) | Page-level | Until page reload |
| **inject.js** | `isSending` (boolean) | Page-level | Per send operation (guard) |
| **service-worker.js** | `unreadCount` (number) | Worker-level | Until reset by popup |
| **telegram-reply-poller.js** | `isPolling` (boolean) | Worker-level | Per alarm cycle |
| **telegram-notifier.js** | `TELEGRAM_SENT_IDS` (Set) | Worker-level | Bounded 500 IDs (LRU) |
| **popup.js** | `currentRules` (array) | Popup-level | Until closed |
| **telegram-settings.js** | `currentRules` (array) | Popup-level | Until closed |

### Persistent State (chrome.storage.local)

```javascript
{
  // Messages
  "messages_Conversation Name 1": [{...}, {...}],     // Max 1000 per conv
  "messages_Conversation Name 2": [...],

  // Metadata
  "meta_stats": {
    "totalCount": 1234,
    "lastUpdated": 1679887200000
  },

  // Telegram Config
  "telegram_config": {
    "enabled": true,
    "botToken": "123456:ABC-DEF...",
    "chatId": "-100123456789",
    "topicId": "42",
    "replyEnabled": true
  },

  // Telegram Rules
  "telegram_rules": [
    { "type": "keyword", "value": "urgent", "direction": "all" },
    { "type": "user", "value": "Boss", "direction": "incoming" }
  ],

  // Telegram Polling
  "telegram_last_update_id": 567890,

  // Reply Prompts (temporary)
  "reply_prompt_123": { "chatId": "-100...", "conversationId": "...", "sender": "..." },

  // Logging Control
  "logging_enabled": true
}
```

## Event Flow & Communication

### Event Types

| Event Type | Source | Destination | Format | Handler |
|-----------|--------|-------------|--------|---------|
| `ZALO_DOM_MSG` | inject.js | content-script.js | `{type, message}` | window.addEventListener |
| `ZALO_SEND_MSG` | service-worker.js | content-script.js | `{type, conversationId, text, corrId}` | chrome.runtime.onMessage |
| `ZALO_SEND_RESULT` | inject.js | content-script.js | `{type, corrId, ok, error}` | window.addEventListener |
| `chrome.runtime.onMessage` | content-script.js | service-worker.js | `{type: 'ZALO_DOM_MSG', message}` | chrome.runtime.onMessage |
| `chrome.alarms.onAlarm` | Chrome | service-worker.js | `{name: 'telegram-reply-poll'}` | chrome.alarms.onAlarm |
| `chrome.storage.onChanged` | storage | service-worker.js | `{telegram_config: {newValue, oldValue}}` | chrome.storage.onChanged |
| `chrome.tabs.sendMessage` | service-worker.js | content-script.js | `{type: 'ZALO_SEND_MSG', ...}` | chrome.runtime.onMessage |

### Call Sequence: Message Logging

```
Zalo Web DOM mutation (new message element)
  ↓ [2s later]
inject.js:pollMessages()
  ├─ document.querySelectorAll('div[id^="message-frame_"]')
  ├─ extractMessage(msgFrame)
  │   ├─ Check SEEN_MSG_IDS.has(frameId)
  │   └─ SEEN_MSG_IDS.add(frameId)
  └─ window.postMessage({type: 'ZALO_DOM_MSG', message})
    ↓
content-script.js:window.addEventListener('message')
  └─ chrome.runtime.sendMessage({type: 'ZALO_DOM_MSG', message})
    ↓
service-worker.js:chrome.runtime.onMessage.addListener()
  ├─ storeMessage(msg)
  │   ├─ Get messages_{conversationId}
  │   ├─ Check dedup
  │   └─ Save to storage
  ├─ incrementBadge()
  └─ checkAndNotifyTelegram(msg)
    ↓
telegram-notifier.js:checkAndNotifyTelegram()
  ├─ matchRules()
  └─ sendTelegramMessage() [if matched]
    ↓
Telegram API: sendMessage success
  ↓
User receives notification with ↩️ button
```

## Error Handling Strategy

### Failure Points & Recovery

| Failure Point | Error | Recovery | User Impact |
|---------------|-------|----------|-------------|
| DOM selector fails | Message extraction | Log warning, skip frame | Message missed (rare) |
| Zalo UI change | Frame ID pattern mismatch | Update selector in code | Message missed until fix |
| Conversation not in sidebar | findAndClickConversation() fails | Return error | User sees "❌ Conversation not found" |
| Input not ready | waitForInputReady() timeout | Return error | User sees "❌ Input not ready" |
| Telegram API error | Network timeout, invalid token | Catch + log | Status feedback to user |
| Telegram webhook conflict | getUpdates error 409 | Stop polling, log warning | Polling disabled, user prompted |
| Storage quota exceeded | >8MB usage | Auto-cleanup oldest msgs | Data loss (expected behavior) |
| Service worker killed | Polling interrupted | Alarm restarts after 0.5 min | Delay in replies (bounded) |

## Performance Characteristics

### Timing Analysis

| Operation | Duration | Trigger | Impact |
|-----------|----------|---------|--------|
| poll 2s | 2000ms | setInterval | CPU: polling loop, DOM query |
| Telegram API call | 200-500ms | Rule matched | Network: blocking if many rules |
| extractMessage() | <5ms | Per message | CPU: string parsing, DOM query |
| storeMessage() | <10ms | Per message | I/O: storage.local.set |
| Auto-cleanup | <100ms | Every 100 msgs | I/O: storage rebuild |
| Popup render | <1000ms | On open | CPU: filter, sort, render |
| Debounce auto-save | 500ms | Input change | I/O: deferred write |
| Long-poll timeout | 25000ms | No updates | Network: held connection |
| findAndClickConversation | 500-1000ms | Reply received | DOM: sidebar scroll, click |

### Memory Usage (estimated)

- `SEEN_MSG_IDS`: 1000 IDs × 50 bytes = ~50KB
- `SIDEBAR_PREVIEWS`: 100 convs × 100 bytes = ~10KB
- `TELEGRAM_SENT_IDS`: 500 IDs × 50 bytes = ~25KB
- `messages_{convId}` (1000 msgs × 4 convs): ~400KB (1-2KB per message)
- **Total**: ~500KB per extension instance (well within limits)

## Scalability Considerations

### Limits & Quotas

| Resource | Limit | Reason | Recovery |
|----------|-------|--------|----------|
| `chrome.storage.local` | 10MB | Chrome API limit | Auto-cleanup >8MB |
| Messages per conversation | 1000 | Memory bound | Splice oldest when full |
| Telegram dedup IDs | 500 | Memory bound | LRU rotation (oldest dropped) |
| Max reply text length | 2000 chars | Arbitrary (Zalo UI) | Error message to user |
| Popup max-height | 500px | UX design | Scroll for long lists |

### What Scales Well
- ✅ Number of conversations (separate storage keys)
- ✅ Number of rules (linear matching)
- ✅ Message volume (with auto-cleanup)

### What Doesn't Scale
- ❌ Very large conversations (>1000 msgs, cleanup occurs)
- ❌ Very frequent polling (2s is already aggressive)
- ❌ Unbounded dedup (capped at 500)

## Security Architecture

### Trust Boundaries

```
┌─────────────────────────────────┐
│  Chrome Extension Container     │ ← Trusted
│  (Private context, isolated)    │
│                                 │
│  ├─ inject.js (MAIN_WORLD)      │ ← Access to Zalo DOM
│  ├─ content-script.js (ISOLATED)│ ← Bridge
│  └─ service-worker.js (BG)      │ ← No DOM access
│                                 │
│  ├─ chrome.storage.local        │ ← Encrypted by Chrome
│  └─ chrome.alarms               │
│                                 │
└─────────────────────────────────┘
         │
         ├─ Zalo Web (https://chat.zalo.me) ← Untrusted page
         │   (inject.js reads DOM, no credentials)
         │
         └─ Telegram Bot API ← Untrusted service
             (Bot token stored locally, HTML escaped)
```

### Data Sensitivity

| Data | Storage | Exposure Risk | Mitigation |
|------|---------|---------------|-----------|
| **Bot Token** | chrome.storage.local (encrypted) | If device stolen | User must rotate token |
| **Chat ID** | chrome.storage.local (encrypted) | If device stolen | Not sensitive (public) |
| **Message Content** | chrome.storage.local (encrypted) | Storage leak | 8MB auto-cleanup |
| **Zalo DOM** | inject.js memory | Script injection | MAIN_WORLD isolation |
| **Telegram Updates** | In-memory during polling | Memory dump | Minimal exposure |

### Input Validation

| Input | Validation | Sanitization |
|-------|-----------|--------------|
| Bot Token | Format check (contains ':') | Stored as-is (used in API URL) |
| Chat ID | String accept | Used in JSON body |
| Message Content | None (from Zalo) | HTML escape for Telegram |
| Rule Values | Trim whitespace | Case-insensitive matching |
| Conversation Name | From Zalo DOM (trusted) | No sanitization |

## Deployment Architecture

### Installation
1. User downloads extension ZIP / git clone
2. Chrome → Extensions → Developer mode → Load unpacked
3. manifest.json loaded, service-worker registered, content scripts injected
4. Popup UI available (chrome-extension:// URL)

### Runtime Lifecycle
```
┌─ Chrome startup
│  └─ Service worker starts (lazy load)
│
├─ Tab opens chat.zalo.me
│  ├─ inject.js loaded (MAIN_WORLD)
│  ├─ content-script.js loaded (ISOLATED)
│  └─ polling starts (2s interval)
│
├─ User clicks extension icon
│  ├─ popup.html opened (400x500px window)
│  ├─ popup.js loads chrome.storage
│  └─ telegram-settings.js ready
│
├─ Config changed (Telegram enabled)
│  ├─ telegram_config stored
│  ├─ storage.onChanged fires
│  └─ service-worker starts polling
│
└─ Chrome closes / Service worker unload
   ├─ Polling stops
   └─ Alarm registered (0.5 min) for restart
```

### Update Path
- User updates extension ZIP in Chrome
- New manifest.json loaded
- Service worker restarted
- Storage persists (backward compatible)

## Monitoring & Debugging

### Available Logs
```javascript
// Console logs from service worker
console.log('[ZaloLogger] Found 3 new messages');
console.log('[ZaloLogger→TG] Sent: Boss - Urgent meeting');
console.log('[ZaloLogger←TG] Reply to Boss → "Meeting Room 101": Confirmed');

// Chrome DevTools → Extension → Inspect service-worker
// Access chrome.storage.local via DevTools → Application → Storage
```

### Debugging Tools
- Chrome DevTools → Extension Inspect Service Worker
- chrome://extensions → Developer mode → Inspect views
- Network tab → Monitor Telegram API calls
- Storage tab → View all chrome.storage.local keys
- Console → Real-time logs with [ZaloLogger] prefix

## Future Scalability Improvements

1. **IndexedDB instead of chrome.storage.local** - for >10MB data
2. **Shared Worker or Web Worker** - offload polling from main thread
3. **Batch storage writes** - reduce I/O frequency
4. **Compression** - compress message archive
5. **Cloud sync** - Firebase Firestore for multi-device
6. **Service Worker v2** - support for more advanced features
