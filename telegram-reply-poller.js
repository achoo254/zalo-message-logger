// Telegram reply poller - long-polls getUpdates for replies, sends to Zalo tab
// Used by service-worker via importScripts()

const REPLY_POLL_ALARM = 'telegram-reply-poll';
let isPolling = false;

// Start long-polling loop + keepalive alarm
function startReplyPolling() {
  // Alarm keeps service worker alive and restarts polling if it dies
  chrome.alarms.create(REPLY_POLL_ALARM, { periodInMinutes: 0.5 });
  if (!isPolling) {
    isPolling = true;
    pollLoop();
  }
  console.log('[ZaloLogger←TG] Reply long-polling started');
}

// Stop polling
function stopReplyPolling() {
  isPolling = false;
  chrome.alarms.clear(REPLY_POLL_ALARM);
  console.log('[ZaloLogger←TG] Reply polling stopped');
}

// Long-polling loop: Telegram holds connection up to 25s, returns instantly on new update
async function pollLoop() {
  while (isPolling) {
    try {
      await handleReplyPoll();
    } catch (err) {
      console.warn('[ZaloLogger←TG] Poll loop error:', err.message);
      // Back off on error to avoid tight loop
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Single poll cycle with long-polling (timeout=25s)
async function handleReplyPoll() {
  const result = await chrome.storage.local.get(['telegram_config', 'telegram_last_update_id']);
  const config = result.telegram_config;

  // Guard: check enabled + replyEnabled
  if (!config || !config.enabled || !config.replyEnabled) {
    isPolling = false;
    return;
  }
  if (!config.botToken || !config.chatId) return;

  const offset = (result.telegram_last_update_id || 0) + 1;
  const url = `https://api.telegram.org/bot${config.botToken}/getUpdates?offset=${offset}&timeout=25&allowed_updates=["message","callback_query"]`;

  // Long-poll: Telegram holds this request up to 25s, returns instantly when update arrives
  const res = await fetch(url);
  const data = await res.json();

  if (!data.ok) {
    if (data.error_code === 409) {
      console.warn('[ZaloLogger←TG] Conflict: bot has webhook set. Disable webhook or use a different bot.');
      stopReplyPolling();
    }
    return;
  }
  if (!data.result || data.result.length === 0) return;

  let maxUpdateId = result.telegram_last_update_id || 0;

  for (const update of data.result) {
    if (update.update_id > maxUpdateId) {
      maxUpdateId = update.update_id;
    }

    // Handle callback_query (inline button press) — instant response
    if (update.callback_query) {
      await handleCallbackQuery(config, update.callback_query);
      continue;
    }

    const msg = update.message;
    if (!msg || !msg.reply_to_message) continue;

    // Only process replies in our chat
    if (String(msg.chat.id) !== String(config.chatId)) continue;

    // Parse conversation from the original message
    const originalText = msg.reply_to_message.text || '';
    const conversationId = parseConversationIdFromReply(originalText);

    if (!conversationId) {
      console.log('[ZaloLogger←TG] Reply ignored: no 📍 marker in original message');
      continue;
    }

    const sender = parseSenderFromReply(originalText);
    const replyText = msg.text || '';
    if (!replyText.trim()) continue;

    console.log(`[ZaloLogger←TG] Reply to ${sender || '?'} → "${conversationId}": ${replyText.slice(0, 50)}`);
    const sendResult = await sendReplyToZaloTab(config, conversationId, replyText);

    // Edit the force-reply prompt message to show result
    const promptMsgId = msg.reply_to_message.message_id;
    const promptKey = `reply_prompt_${promptMsgId}`;
    const promptData = (await chrome.storage.local.get(promptKey))[promptKey];
    if (promptData) {
      if (sendResult?.ok) {
        await editTelegramMessage(config, promptData.chatId, promptMsgId,
          `✅ Sent to <b>${escapeHtmlTelegram(promptData.conversationId)}</b>`);
      } else {
        await editTelegramMessage(config, promptData.chatId, promptMsgId,
          `❌ Failed: ${escapeHtmlTelegram(sendResult?.error || 'Unknown error')}`);
      }
      await chrome.storage.local.remove(promptKey);
    }
  }

  // Save latest update_id
  await chrome.storage.local.set({ telegram_last_update_id: maxUpdateId });
}

// Handle inline button press — send minimal force-reply message quoting original
async function handleCallbackQuery(config, callbackQuery) {
  try {
    const originalMsg = callbackQuery.message;
    if (!originalMsg) return;

    const originalText = originalMsg.text || '';
    const conversationId = parseConversationIdFromReply(originalText);
    const sender = parseSenderFromReply(originalText);

    // Dismiss button loading immediately
    await answerCallbackQuery(config, callbackQuery.id, '');

    if (!conversationId) return;

    // Extract original content (last line after 🕐 time line)
    const lines = originalText.split('\n');
    const contentLines = lines.filter(l => !l.startsWith('📍') && !l.startsWith('🕐') && l.trim() !== sender);
    const preview = contentLines.join('\n').trim().slice(0, 100);

    // Send force_reply with full context — triggers reply bar in Telegram client
    // Include 📍 marker so poller can parse conversation from the reply
    const promptText = `↩️ <b>Reply to ${escapeHtmlTelegram(sender || '?')}</b>\n📍 ${escapeHtmlTelegram(conversationId)}\n\n<i>${escapeHtmlTelegram(preview)}</i>\n\n✍️ Type your reply:`;
    const body = {
      chat_id: originalMsg.chat.id,
      text: promptText,
      parse_mode: 'HTML',
      reply_parameters: { message_id: originalMsg.message_id },
      reply_markup: { force_reply: true, selective: true },
    };
    if (config.topicId) body.message_thread_id = Number(config.topicId);

    const sendRes = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const sendData = await sendRes.json();

    // Store prompt message_id so we can edit it after successful reply
    if (sendData.ok && sendData.result?.message_id) {
      const promptMsgId = sendData.result.message_id;
      const chatId = originalMsg.chat.id;
      // Save mapping: when user replies to this prompt, we know which message to edit
      await chrome.storage.local.set({
        [`reply_prompt_${promptMsgId}`]: { chatId, sender, conversationId, preview },
      });
    }
  } catch (err) {
    console.warn('[ZaloLogger←TG] Callback query error:', err.message);
  }
}

// Answer callback query to dismiss loading indicator
async function answerCallbackQuery(config, callbackQueryId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${config.botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (err) {
    console.warn('[ZaloLogger←TG] Answer callback error:', err.message);
  }
}

// Edit a Telegram message text
async function editTelegramMessage(config, chatId, messageId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${config.botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.warn('[ZaloLogger←TG] Edit message error:', err.message);
  }
}

// Find Zalo tab and send message command
async function sendReplyToZaloTab(config, conversationId, text) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://chat.zalo.me/*' });

    if (tabs.length === 0) {
      await sendTelegramError(config, '❌ Zalo tab not open. Cannot send reply.');
      return { ok: false, error: 'Zalo tab not open' };
    }

    const tabId = tabs[0].id;
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'ZALO_SEND_MSG',
      conversationId,
      text,
    });

    if (response && response.ok) {
      console.log(`[ZaloLogger←TG] Sent to Zalo: "${conversationId}"`);
      return { ok: true };
    } else {
      const error = response?.error || 'Unknown error';
      console.warn(`[ZaloLogger←TG] Send failed: ${error}`);
      await sendTelegramError(config, `❌ Send failed: ${error}`);
      return { ok: false, error };
    }
  } catch (err) {
    console.warn('[ZaloLogger←TG] Tab communication error:', err.message);
    await sendTelegramError(config, `❌ Error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Send error notification back to Telegram
async function sendTelegramError(config, errorMsg) {
  try {
    const body = {
      chat_id: config.chatId,
      text: `<b>[Zalo Logger]</b>\n${escapeHtmlTelegram(errorMsg)}`,
      parse_mode: 'HTML',
    };
    if (config.topicId) body.message_thread_id = Number(config.topicId);

    await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn('[ZaloLogger←TG] Failed to send error to Telegram:', err.message);
  }
}
