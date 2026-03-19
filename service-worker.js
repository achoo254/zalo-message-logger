importScripts('telegram-notifier.js');

// Service worker: receive DOM-scraped messages, store in chrome.storage.local

let unreadCount = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'ZALO_DOM_MSG') return;

  chrome.storage.local.get('logging_enabled', ({ logging_enabled }) => {
    if (logging_enabled === false) return;

    const msg = message.message;
    console.log(`[ZaloLogger ${msg.direction}] ${msg.sender}: ${msg.content}`);

    storeMessage(msg);
    incrementBadge();
    checkAndNotifyTelegram(msg);
  });
});

// --- Storage ---

async function storeMessage(msg) {
  const key = `messages_${msg.conversationId || 'unknown'}`;
  const result = await chrome.storage.local.get(key);
  const messages = result[key] || [];

  // Dedup by frame ID
  if (msg.id && messages.some(m => m.id === msg.id)) return false;

  messages.push(msg);

  // Cap per conversation (keep last 1000)
  if (messages.length > 1000) messages.splice(0, messages.length - 1000);

  await chrome.storage.local.set({ [key]: messages });
  await updateStats(1);

  // Auto-cleanup check every 100 messages
  const { meta_stats } = await chrome.storage.local.get('meta_stats');
  if (meta_stats && meta_stats.totalCount % 100 === 0) {
    await checkStorageQuota();
  }

  return true;
}

async function updateStats(addCount) {
  const { meta_stats = { totalCount: 0, lastUpdated: 0 } } =
    await chrome.storage.local.get('meta_stats');
  meta_stats.totalCount += addCount;
  meta_stats.lastUpdated = Date.now();
  await chrome.storage.local.set({ meta_stats });
}

// --- Storage Cleanup ---

async function checkStorageQuota() {
  const usage = await navigator.storage.estimate();
  const usedMB = (usage.usage || 0) / 1024 / 1024;
  if (usedMB > 8) await cleanupOldMessages();
}

async function cleanupOldMessages() {
  const all = await chrome.storage.local.get(null);
  const msgKeys = Object.keys(all).filter(k => k.startsWith('messages_'));
  for (const key of msgKeys) {
    const msgs = all[key];
    if (msgs.length > 200) {
      await chrome.storage.local.set({ [key]: msgs.slice(-200) });
    }
  }
}

// --- Badge ---

function incrementBadge() {
  unreadCount++;
  chrome.action.setBadgeText({ text: String(unreadCount) });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    unreadCount = 0;
    chrome.action.setBadgeText({ text: '' });
  }
});
