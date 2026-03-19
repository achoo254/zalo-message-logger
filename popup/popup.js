// Connect to service-worker to reset badge
const port = chrome.runtime.connect({ name: 'popup' });

const elements = {
  totalCount: document.getElementById('total-count'),
  storageUsed: document.getElementById('storage-used'),
  lastUpdated: document.getElementById('last-updated'),
  filterDirection: document.getElementById('filter-direction'),
  filterKeyword: document.getElementById('filter-keyword'),
  filterConversation: document.getElementById('filter-conversation'),
  messageList: document.getElementById('message-list'),
  btnExport: document.getElementById('btn-export'),
  btnClear: document.getElementById('btn-clear'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnToggle: document.getElementById('btn-toggle'),
};

// --- Tab switching ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
    tab.classList.add('active');
    const panel = document.getElementById(`tab-${tab.dataset.tab}`);
    panel.style.display = '';
    panel.classList.add('active');
  });
});

// --- Load & Render ---

async function loadStats() {
  const { meta_stats = { totalCount: 0, lastUpdated: 0 } } =
    await chrome.storage.local.get('meta_stats');
  elements.totalCount.textContent = meta_stats.totalCount;
  elements.lastUpdated.textContent = meta_stats.lastUpdated
    ? new Date(meta_stats.lastUpdated).toLocaleTimeString()
    : '-';

  // Estimate storage
  const all = await chrome.storage.local.get(null);
  const size = new Blob([JSON.stringify(all)]).size;
  elements.storageUsed.textContent = (size / 1024).toFixed(1);
}

async function loadConversations() {
  const all = await chrome.storage.local.get(null);
  const convKeys = Object.keys(all).filter(k => k.startsWith('messages_'));
  const select = elements.filterConversation;

  // Keep "All" option, clear rest
  select.innerHTML = '<option value="all">All conversations</option>';
  convKeys.forEach(key => {
    const id = key.replace('messages_', '');
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    select.appendChild(opt);
  });
}

async function loadMessages() {
  const direction = elements.filterDirection.value;
  const keyword = elements.filterKeyword.value.toLowerCase();
  const convId = elements.filterConversation.value;

  const all = await chrome.storage.local.get(null);
  const msgKeys = Object.keys(all).filter(k => k.startsWith('messages_'));

  let allMessages = [];
  for (const key of msgKeys) {
    const id = key.replace('messages_', '');
    if (convId !== 'all' && id !== convId) continue;
    allMessages = allMessages.concat(all[key] || []);
  }

  // Sort by timestamp desc
  allMessages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // Apply filters
  let filtered = allMessages;
  if (direction !== 'all') {
    filtered = filtered.filter(m => m.direction === direction);
  }
  if (keyword) {
    filtered = filtered.filter(m =>
      (m.content || '').toLowerCase().includes(keyword) ||
      (m.sender || '').toLowerCase().includes(keyword)
    );
  }

  // Show last 50
  renderMessages(filtered.slice(0, 50));
}

function renderMessages(messages) {
  const list = elements.messageList;
  list.innerHTML = '';

  if (messages.length === 0) {
    list.innerHTML = '<div class="empty">No messages yet</div>';
    return;
  }

  messages.forEach(msg => {
    const div = document.createElement('div');
    div.className = `msg msg-${msg.direction || 'unknown'}`;
    div.innerHTML = `
      <div class="msg-header">
        <span class="msg-direction">${msg.direction === 'incoming' ? '⬇' : '⬆'}</span>
        <span class="msg-sender">${escapeHtml(msg.sender || '?')}</span>
        <span class="msg-time">${msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}</span>
      </div>
      <div class="msg-content">${escapeHtml(msg.content || msg.raw || '[no content]')}</div>
    `;
    list.appendChild(div);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Actions ---

async function exportJson() {
  const all = await chrome.storage.local.get(null);
  const msgKeys = Object.keys(all).filter(k => k.startsWith('messages_'));

  const exportData = {};
  msgKeys.forEach(key => { exportData[key] = all[key]; });

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zalo-messages-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearAll() {
  if (!confirm('Clear all stored messages?')) return;
  // Only remove message keys + stats, preserve telegram config
  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter(k => k.startsWith('messages_') || k === 'meta_stats');
  await chrome.storage.local.remove(keysToRemove);
  await refresh();
}

async function refresh() {
  await loadStats();
  await loadConversations();
  await loadMessages();
}

async function toggleLogging() {
  const enabled = elements.btnToggle.checked;
  await chrome.storage.local.set({ logging_enabled: enabled });
}

async function loadToggleState() {
  const { logging_enabled } = await chrome.storage.local.get('logging_enabled');
  elements.btnToggle.checked = logging_enabled !== false; // default true
}

// --- Events ---

elements.btnExport.addEventListener('click', exportJson);
elements.btnClear.addEventListener('click', clearAll);
elements.btnRefresh.addEventListener('click', refresh);
elements.btnToggle.addEventListener('change', toggleLogging);
elements.filterDirection.addEventListener('change', loadMessages);
elements.filterKeyword.addEventListener('input', loadMessages);
elements.filterConversation.addEventListener('change', loadMessages);

// --- Init ---

loadToggleState();
refresh();
