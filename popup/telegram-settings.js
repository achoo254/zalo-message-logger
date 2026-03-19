// Telegram settings UI - config + rules CRUD for popup

const tgElements = {
  enabled: document.getElementById('tg-enabled'),
  botToken: document.getElementById('tg-bot-token'),
  chatId: document.getElementById('tg-chat-id'),
  topicId: document.getElementById('tg-topic-id'),
  rulesList: document.getElementById('tg-rules-list'),
  addRule: document.getElementById('tg-add-rule'),
  testBtn: document.getElementById('tg-test'),
  saveBtn: document.getElementById('tg-save'),
  status: document.getElementById('tg-status'),
};

let currentRules = [];

// --- Load / Save ---

async function loadTelegramConfig() {
  const result = await chrome.storage.local.get(['telegram_config', 'telegram_rules']);
  const config = result.telegram_config || {};
  currentRules = result.telegram_rules || [];

  tgElements.enabled.checked = !!config.enabled;
  tgElements.botToken.value = config.botToken || '';
  tgElements.chatId.value = config.chatId || '';
  tgElements.topicId.value = config.topicId || '';

  renderRules();
}

async function saveTelegramConfig() {
  const config = {
    enabled: tgElements.enabled.checked,
    botToken: tgElements.botToken.value.trim(),
    chatId: tgElements.chatId.value.trim(),
    topicId: tgElements.topicId.value.trim() || null,
  };

  // Validate bot token format if enabled
  if (config.enabled && config.botToken && !config.botToken.includes(':')) {
    showStatus('Invalid bot token format', true);
    return;
  }

  const rules = collectRules();

  await chrome.storage.local.set({
    telegram_config: config,
    telegram_rules: rules,
  });

  currentRules = rules;
  showStatus('Saved!');
}

// --- Rules CRUD ---

function renderRules() {
  tgElements.rulesList.innerHTML = '';
  currentRules.forEach((rule, i) => {
    const div = document.createElement('div');
    div.className = 'tg-rule';
    div.innerHTML = `
      <select class="tg-rule-type">
        <option value="user" ${rule.type === 'user' ? 'selected' : ''}>User name</option>
        <option value="keyword" ${rule.type === 'keyword' ? 'selected' : ''}>Keyword</option>
        <option value="conversation" ${rule.type === 'conversation' ? 'selected' : ''}>Conversation</option>
        <option value="content_type" ${rule.type === 'content_type' ? 'selected' : ''}>Content type</option>
      </select>
      <input class="tg-rule-value" value="${escapeAttr(rule.value || '')}" placeholder="Value...">
      <select class="tg-rule-direction">
        <option value="all" ${rule.direction === 'all' ? 'selected' : ''}>All</option>
        <option value="incoming" ${rule.direction === 'incoming' ? 'selected' : ''}>In</option>
        <option value="outgoing" ${rule.direction === 'outgoing' ? 'selected' : ''}>Out</option>
      </select>
      <button class="tg-rule-delete" data-index="${i}">\u2715</button>
    `;
    tgElements.rulesList.appendChild(div);
  });
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addRule() {
  currentRules.push({ type: 'keyword', value: '', direction: 'all' });
  renderRules();
}

function deleteRule(index) {
  currentRules.splice(index, 1);
  renderRules();
}

function collectRules() {
  const rows = tgElements.rulesList.querySelectorAll('.tg-rule');
  const rules = [];
  rows.forEach(row => {
    const value = row.querySelector('.tg-rule-value').value.trim();
    if (!value) return; // skip empty rules
    rules.push({
      type: row.querySelector('.tg-rule-type').value,
      value,
      direction: row.querySelector('.tg-rule-direction').value,
    });
  });
  return rules;
}

// --- Test Connection ---

async function testConnection() {
  const token = tgElements.botToken.value.trim();
  const chatId = tgElements.chatId.value.trim();
  const topicId = tgElements.topicId.value.trim();

  if (!token || !chatId) {
    showStatus('Enter bot token and chat ID first', true);
    return;
  }

  showStatus('Testing...');
  const body = {
    chat_id: chatId,
    text: '✅ Zalo Message Logger - Test connection successful!',
    parse_mode: 'HTML',
  };
  if (topicId) body.message_thread_id = Number(topicId);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      showStatus('Success! Check Telegram.');
    } else {
      showStatus(`Error: ${data.description}`, true);
    }
  } catch (err) {
    showStatus(`Failed: ${err.message}`, true);
  }
}

// --- UI Helpers ---

function showStatus(text, isError) {
  tgElements.status.textContent = text;
  tgElements.status.style.color = isError ? '#e53935' : '#4CAF50';
  if (!isError) {
    setTimeout(() => { tgElements.status.textContent = ''; }, 2000);
  }
}

// --- Events ---

tgElements.saveBtn.addEventListener('click', saveTelegramConfig);
tgElements.testBtn.addEventListener('click', testConnection);
tgElements.addRule.addEventListener('click', addRule);
tgElements.rulesList.addEventListener('click', (e) => {
  if (e.target.classList.contains('tg-rule-delete')) {
    deleteRule(Number(e.target.dataset.index));
  }
});

// --- Init ---
loadTelegramConfig();
