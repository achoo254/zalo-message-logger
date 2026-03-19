// Telegram notification module - rule matching + Telegram Bot API
// Used by service-worker via importScripts()

const TELEGRAM_SENT_IDS = new Set();
const TELEGRAM_DEDUP_MAX = 500;

// Escape HTML special chars to prevent injection in Telegram messages
function escapeHtmlTelegram(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Check if message matches any rule (OR logic)
function matchRules(msg, rules) {
  for (const rule of rules) {
    // Direction filter
    if (rule.direction !== 'all' && rule.direction !== msg.direction) continue;

    const val = rule.value.toLowerCase();
    let matched = false;

    switch (rule.type) {
      case 'user':
        // Match sender name OR conversationId (outgoing has sender="me")
        matched = (msg.sender || '').toLowerCase().includes(val)
          || (msg.conversationId || '').toLowerCase().includes(val);
        break;
      case 'keyword':
        matched = (msg.content || '').toLowerCase().includes(val);
        break;
      case 'conversation':
        matched = (msg.conversationId || '').toLowerCase().includes(val);
        break;
      case 'content_type':
        matched = (msg.contentType || '').toLowerCase() === val;
        break;
    }

    if (matched) return true;
  }
  return false;
}

// Send message to Telegram via Bot API
async function sendTelegramMessage(config, msg) {
  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString('vi-VN') : (msg.timeDisplay || '');
  const text = `<b>${escapeHtmlTelegram(msg.sender || '?')}</b>\n📍 ${escapeHtmlTelegram(msg.conversationId || '?')}\n🕐 ${escapeHtmlTelegram(time)}\n${escapeHtmlTelegram(msg.content || '')}`;

  const body = {
    chat_id: config.chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: `↩️ ${msg.sender || '?'}`, callback_data: 'reply' },
      ]],
    },
  };
  if (config.topicId) body.message_thread_id = Number(config.topicId);

  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { ok: data.ok, error: data.ok ? null : data.description };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Parse conversation name from a Telegram reply_to_message text
// Looks for line starting with 📍 marker
function parseConversationIdFromReply(text) {
  if (!text) return null;
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('📍 ')) {
      return line.slice(2).trim();
    }
  }
  return null;
}

// Parse sender name from Telegram message text (first line, bold tag)
function parseSenderFromReply(text) {
  if (!text) return null;
  // First line format: <b>SenderName</b> or just SenderName (plain text after HTML strip)
  const firstLine = text.split('\n')[0];
  // Plain text (entities stripped by Telegram in reply_to_message.text)
  if (firstLine && !firstLine.startsWith('📍') && !firstLine.startsWith('🕐')) {
    return firstLine.trim();
  }
  return null;
}

// Main entry: check rules and send notification if matched
async function checkAndNotifyTelegram(msg) {
  try {
    const result = await chrome.storage.local.get(['telegram_config', 'telegram_rules']);
    const config = result.telegram_config;
    const rules = result.telegram_rules || [];

    // Guard checks
    if (!config || !config.enabled || !config.botToken || !config.chatId) return;
    if (rules.length === 0) return;

    // Dedup
    if (TELEGRAM_SENT_IDS.has(msg.id)) return;
    TELEGRAM_SENT_IDS.add(msg.id);
    if (TELEGRAM_SENT_IDS.size > TELEGRAM_DEDUP_MAX) {
      const arr = Array.from(TELEGRAM_SENT_IDS);
      arr.splice(0, arr.length - TELEGRAM_DEDUP_MAX);
      TELEGRAM_SENT_IDS.clear();
      arr.forEach(id => TELEGRAM_SENT_IDS.add(id));
    }

    if (!matchRules(msg, rules)) return;

    const res = await sendTelegramMessage(config, msg);
    if (res.ok) {
      console.log(`[ZaloLogger→TG] Sent: ${msg.sender} - ${(msg.content || '').slice(0, 30)}`);
    } else {
      console.warn(`[ZaloLogger→TG] Error: ${res.error}`);
    }
  } catch (err) {
    console.warn('[ZaloLogger→TG] Failed:', err.message);
  }
}
