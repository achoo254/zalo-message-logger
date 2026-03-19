// Bridge between inject.js (MAIN_WORLD) and service-worker
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'ZALO_DOM_MSG') return;

  chrome.runtime.sendMessage({
    type: 'ZALO_DOM_MSG',
    message: event.data.message,
  });
});
