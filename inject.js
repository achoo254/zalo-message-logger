// DOM polling approach: scan chat area every 2s for new messages
// Zalo uses virtual DOM so MutationObserver doesn't work reliably
// Runs in MAIN_WORLD to access page DOM directly

const SEEN_MSG_IDS = new Set();
const POLL_INTERVAL = 2000;

// Get current conversation name from multiple sources
function getConversationName() {
  // 1. Try input placeholder: "Nhập @, tin nhắn tới Inet Đức Hòa"
  const input = document.querySelector('#richInput');
  if (input) {
    const trailer = input.getAttribute('data-trailer');
    if (trailer) return trailer.trim();
    const placeholder = input.getAttribute('placeholder') || '';
    const match = placeholder.match(/tin nhắn tới (.+)/);
    if (match) return match[1].trim();
  }
  // 2. Try chat header text
  const header = document.querySelector('p.chat-title__name')
    || document.querySelector('.chat-title span')
    || document.querySelector('[data-translate-inner="MODULE_CONTACT_TITLE"]');
  return header?.textContent?.trim() || 'unknown';
}

// Get sender name for a message (handles group chats)
function getSenderName(msgFrame, isOutgoing) {
  if (isOutgoing) return 'me';
  // In group chats, sender name appears above the message
  const senderEl = msgFrame.querySelector('.msg-item__name')
    || msgFrame.querySelector('[data-id*="SenderName"]')
    || msgFrame.closest('.message-content-wrapper')?.querySelector('.msg-item__name');
  if (senderEl) return senderEl.textContent.trim();
  // 1-on-1 chat: sender = conversation name
  return getConversationName();
}

// Extract message data from a message frame element
function extractMessage(msgFrame) {
  const frameId = msgFrame.id;
  if (!frameId || SEEN_MSG_IDS.has(frameId)) return null;
  SEEN_MSG_IDS.add(frameId);

  const isOutgoing = msgFrame.classList.contains('me');

  // Text content: span.text inside the message
  const textEl = msgFrame.querySelector('span.text');
  const content = textEl?.textContent?.trim() || '';

  // Detect media types if no text
  let contentType = 'text';
  if (!content) {
    if (msgFrame.querySelector('[data-id*="Img"]') || msgFrame.querySelector('img.msg-img')) contentType = 'image';
    else if (msgFrame.querySelector('[data-id*="File"]')) contentType = 'file';
    else if (msgFrame.querySelector('[data-id*="Sticker"]')) contentType = 'sticker';
    else contentType = 'unknown';
  }

  const timeEl = msgFrame.querySelector('.card-send-time');
  const timeText = timeEl?.textContent?.trim() || '';
  const dataQid = msgFrame.getAttribute('data-qid') || '';

  return {
    id: frameId,
    direction: isOutgoing ? 'outgoing' : 'incoming',
    sender: getSenderName(msgFrame, isOutgoing),
    content: content || `[${contentType}]`,
    contentType,
    conversationId: getConversationName(),
    timestamp: Date.now(),
    timeDisplay: timeText,
    dataQid,
  };
}

// Flag to prevent polling interference during send (used by reverse direction below)
let isSending = false;

// Poll: scan all visible message frames, send new ones
function pollMessages() {
  if (isSending) return; // skip polling while sending reply
  const frames = document.querySelectorAll('div[id^="message-frame_"]');
  let newCount = 0;

  frames.forEach(frame => {
    const msg = extractMessage(frame);
    if (msg) {
      window.postMessage({ type: 'ZALO_DOM_MSG', message: msg }, '*');
      newCount++;
    }
  });

  if (newCount > 0) {
    console.log(`[ZaloLogger] Found ${newCount} new message(s)`);
  }
}

// --- Sidebar polling: capture preview messages from non-active conversations ---

// Track sidebar previews: key = animDataId, value = last seen preview text
const SIDEBAR_PREVIEWS = new Map();

function pollSidebar() {
  const items = document.querySelectorAll('div.msg-item[data-id="div_TabMsg_ThrdChItem"]');
  let newCount = 0;

  items.forEach(item => {
    const animId = item.getAttribute('anim-data-id');
    if (!animId) return;

    // Check if has unread badge
    const unreadBadge = item.querySelector('.z-noti-badge');
    const hasUnread = !!unreadBadge;

    // Get conversation name
    const nameEl = item.querySelector('.conv-item-title__name .truncate');
    const convName = nameEl?.textContent?.trim()?.replace(/\u00a0/g, ' ') || 'unknown';

    // Get preview text
    const previewEl = item.querySelector('.conv-message .truncate span');
    const previewText = previewEl?.textContent?.trim() || '';

    if (!previewText) return;

    // Dedup: only send if preview changed for this conversation
    const prevPreview = SIDEBAR_PREVIEWS.get(animId);
    if (prevPreview === previewText) return;
    SIDEBAR_PREVIEWS.set(animId, previewText);

    // Skip if this is the active conversation (already captured by chat area polling)
    const activeConv = getConversationName();
    if (convName === activeConv) return;

    // Check if preview starts with "Bạn:" (our own sent message preview)
    const isOwnPreview = previewText.startsWith('Bạn:') || previewText.startsWith('Bạn: ');

    const msg = {
      id: `sidebar_${animId}_${Date.now()}`,
      direction: isOwnPreview ? 'outgoing' : 'incoming',
      sender: isOwnPreview ? 'me' : convName,
      content: isOwnPreview ? previewText.replace(/^Bạn:\s*/, '') : previewText,
      contentType: 'text',
      conversationId: convName,
      timestamp: Date.now(),
      timeDisplay: '',
      source: 'sidebar-preview',
      hasUnread,
    };

    window.postMessage({ type: 'ZALO_DOM_MSG', message: msg }, '*');
    newCount++;
  });

  if (newCount > 0) {
    console.log(`[ZaloLogger] Sidebar: ${newCount} new preview(s)`);
  }
}

// --- Reverse direction: receive send commands from Telegram replies ---

// Find conversation in sidebar and click it
async function findAndClickConversation(conversationId) {
  // Check if already in the right conversation
  const currentConv = getConversationName();
  if (currentConv === conversationId) return true;

  // Search sidebar items
  const items = document.querySelectorAll('.conv-item-title__name .truncate');
  let target = null;

  // Exact match first
  for (const el of items) {
    const name = el.textContent?.trim()?.replace(/\u00a0/g, ' ');
    if (name === conversationId) {
      target = el;
      break;
    }
  }

  if (!target) {
    console.warn(`[ZaloLogger←TG] Exact match not found for: "${conversationId}"`);
    return false;
  }

  // Click the sidebar item (ancestor .msg-item)
  const msgItem = target.closest('div.msg-item') || target.closest('[data-id="div_TabMsg_ThrdChItem"]');
  if (msgItem) {
    msgItem.click();
    // Wait for conversation to switch
    await new Promise(r => setTimeout(r, 500));
    return true;
  }

  return false;
}

// Wait for #richInput to be ready
async function waitForInputReady(maxWaitMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const input = document.querySelector('#richInput');
    if (input && input.offsetParent !== null) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

// Type text into #richInput and send via Enter key
async function typeAndSend(text) {
  const input = document.querySelector('#richInput');
  if (!input) return false;

  // Focus input
  input.focus();

  // Clear existing content
  input.innerHTML = '';

  // Try execCommand first (best compatibility with contenteditable)
  const inserted = document.execCommand('insertText', false, text);

  if (!inserted) {
    // Fallback: set innerText + dispatch input event
    input.innerText = text;
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text,
    }));
  }

  // Small delay for Zalo to process input
  await new Promise(r => setTimeout(r, 100));

  // Send via Enter key
  const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
  });
  input.dispatchEvent(enterEvent);

  // Assume success after Enter dispatch — Zalo clear timing is inconsistent
  // and checking innerText is unreliable (may still contain DOM nodes)
  await new Promise(r => setTimeout(r, 300));
  return true;
}

// Orchestrator: find conversation → wait for input → type and send
const MAX_REPLY_LENGTH = 2000;

async function handleSendMessage(conversationId, text) {
  if (text.length > MAX_REPLY_LENGTH) {
    return { ok: false, error: `Message too long (${text.length}/${MAX_REPLY_LENGTH} chars)` };
  }

  isSending = true;
  try {
    const found = await findAndClickConversation(conversationId);
    if (!found) {
      return { ok: false, error: `Conversation not found: ${conversationId}` };
    }

    const ready = await waitForInputReady(5000);
    if (!ready) {
      return { ok: false, error: 'Input not ready (timeout)' };
    }

    const sent = await typeAndSend(text);
    if (!sent) {
      return { ok: false, error: 'Send may have failed (input not cleared)' };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    isSending = false;
  }
}

// Listen for send commands from content-script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'ZALO_SEND_MSG') return;

  const corrId = event.data.corrId;
  handleSendMessage(event.data.conversationId, event.data.text)
    .then(result => {
      window.postMessage({ type: 'ZALO_SEND_RESULT', corrId, ...result }, '*');
    });
});

// Wait for chat UI to load, then start polling
function init() {
  const check = setInterval(() => {
    const hasMessages = document.querySelector('div[id^="message-frame_"]')
      || document.querySelector('div.msg-item');
    if (hasMessages) {
      clearInterval(check);
      console.log('[ZaloLogger] Chat area found, starting poll (every 2s)');
      pollMessages(); // initial scan of chat area
      setInterval(pollMessages, POLL_INTERVAL);
      setInterval(pollSidebar, POLL_INTERVAL);
    }
  }, 1000);

  setTimeout(() => clearInterval(check), 60000);
}

init();
