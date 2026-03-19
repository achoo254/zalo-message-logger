// Bridge between inject.js (MAIN_WORLD) and service-worker

// Forward: inject.js → service-worker (Zalo messages)
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'ZALO_DOM_MSG') return;

  chrome.runtime.sendMessage({
    type: 'ZALO_DOM_MSG',
    message: event.data.message,
  });
});

// Reverse: service-worker → inject.js (Telegram replies → Zalo send)
let sendCorrelationId = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'ZALO_SEND_MSG') return;

  const corrId = ++sendCorrelationId;

  // Forward to inject.js (MAIN_WORLD) with correlation ID
  window.postMessage({
    type: 'ZALO_SEND_MSG',
    conversationId: message.conversationId,
    text: message.text,
    corrId,
  }, 'https://chat.zalo.me');

  // Listen for response from inject.js matching corrId
  const handler = (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'ZALO_SEND_RESULT') return;
    if (event.data.corrId !== corrId) return;
    window.removeEventListener('message', handler);
    clearTimeout(timeout);
    sendResponse(event.data);
  };
  window.addEventListener('message', handler);

  // Timeout fallback (10s)
  const timeout = setTimeout(() => {
    window.removeEventListener('message', handler);
    sendResponse({ ok: false, error: 'Timeout waiting for inject.js' });
  }, 10000);

  return true; // keep sendResponse channel open (async)
});
