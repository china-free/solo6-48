const { clipSync } = window;

let devices = [];
let history = [];
let selectedTargets = new Set();
let expandedItems = new Set();
let isReady = false;

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function init() {
  setupTabs();
  setupSettings();
  setupEventListeners();
  loadInitialData();
}

function setupTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      $$('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const tabId = 'tab-' + btn.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });
}

function setupSettings() {
  const enableEncryption = $('#enableEncryption');
  const passwordRow = $('#passwordRow');
  const savePasswordBtn = $('#savePasswordBtn');

  enableEncryption.addEventListener('change', () => {
    const enabled = enableEncryption.checked;
    passwordRow.style.display = enabled ? 'flex' : 'none';
    savePasswordBtn.style.display = enabled ? 'inline-block' : 'none';
    if (!enabled) {
      clipSync.setPassword('');
      showToast('已关闭加密');
    }
  });

  savePasswordBtn.addEventListener('click', async () => {
    const password = $('#encryptionPassword').value;
    if (!password) {
      showToast('请输入密码');
      return;
    }
    await clipSync.setPassword(password);
    showToast('加密密码已保存');
  });

  $('#saveDeviceNameBtn').addEventListener('click', async () => {
    const name = $('#settingDeviceName').value.trim();
    if (!name) {
      showToast('请输入设备名称');
      return;
    }
    await clipSync.setDeviceName(name);
    showToast('设备名称已更新');
  });

  $('#clearHistoryBtn').addEventListener('click', async () => {
    await clipSync.clearHistory();
    history = [];
    renderHistory();
    showToast('历史记录已清空');
  });
}

function setupEventListeners() {
  clipSync.onDeviceOnline((device) => {
    const idx = devices.findIndex(d => d.id === device.id);
    if (idx >= 0) {
      devices[idx] = device;
    } else {
      devices.push(device);
    }
    renderDevices();
    renderSyncTargets();
  });

  clipSync.onDeviceOffline((device) => {
    const idx = devices.findIndex(d => d.id === device.id);
    if (idx >= 0) {
      devices[idx].online = false;
    }
    renderDevices();
    renderSyncTargets();
  });

  clipSync.onDeviceUpdated((device) => {
    const idx = devices.findIndex(d => d.id === device.id);
    if (idx >= 0) {
      devices[idx] = { ...devices[idx], ...device };
      renderDevices();
      renderSyncTargets();
    }
  });

  clipSync.onHistoryUpdated((items) => {
    history = items;
    renderHistory();
  });

  clipSync.onClipboardUpdated((entry) => {
    showToast(`收到来自 ${entry.sourceDevice} 的${entry.type === 'text' ? '文本' : '图片'}`);
  });
}

async function loadInitialData() {
  try {
    devices = await clipSync.getDevices();
    history = await clipSync.getHistory();
    const deviceInfo = await clipSync.getDeviceInfo();
    const pwdStatus = await clipSync.getPasswordStatus();

    if (deviceInfo) {
      $('#settingDeviceId').textContent = deviceInfo.id.slice(0, 12) + '...';
      $('#settingDeviceName').value = deviceInfo.name;
      isReady = true;
      $('#statusBadge').textContent = '已就绪';
      $('#statusBadge').classList.add('online');
    }

    if (pwdStatus && pwdStatus.enabled) {
      $('#enableEncryption').checked = true;
      $('#passwordRow').style.display = 'flex';
      $('#savePasswordBtn').style.display = 'inline-block';
    }

    renderDevices();
    renderHistory();
    renderSyncTargets();
  } catch (e) {
    console.error('Failed to load initial data:', e);
  }
}

function renderDevices() {
  const list = $('#deviceList');
  const count = devices.length;
  const onlineCount = devices.filter(d => d.online).length;
  $('#deviceCount').textContent = `${count} 台设备 (${onlineCount} 在线)`;

  if (count === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <path d="M8 21h8M12 17v4"/>
        </svg>
        <p>正在搜索局域网设备...</p>
      </div>`;
    return;
  }

  list.innerHTML = devices.map(device => `
    <div class="device-card" data-id="${device.id}">
      <div class="device-info">
        <div class="device-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <path d="M8 21h8M12 17v4"/>
          </svg>
        </div>
        <div>
          <div class="device-name">${escapeHtml(device.name)}</div>
          <div class="device-id">${device.id.slice(0, 16)}</div>
        </div>
      </div>
      <div class="device-status">
        <span class="status-dot ${device.online ? 'online' : 'offline'}"></span>
        <span>${device.online ? '在线' : '离线'}</span>
      </div>
    </div>
  `).join('');
}

function _statusLabel(status) {
  switch (status) {
    case 'sent': return '已发送';
    case 'delivered': return '已送达';
    case 'failed': return '失败';
    default: return status || '未知';
  }
}

function _renderSentTargets(item) {
  const targets = item.targets || [];
  if (targets.length === 0) return '';

  const sentCount = targets.filter(t => t.status === 'sent').length;
  const deliveredCount = targets.filter(t => t.status === 'delivered').length;
  const failedCount = targets.filter(t => t.status === 'failed').length;

  const tagsHtml = targets.map(t => `
    <span class="delivery-tag status-${t.status}" title="${t.reason || ''}">
      <span class="delivery-dot"></span>
      ${escapeHtml(t.deviceName || t.deviceId.slice(0, 8))}
      ${_statusLabel(t.status)}
    </span>
  `).join('');

  const failedTargets = targets.filter(t => t.status === 'failed' && t.reason);
  const reasonsHtml = failedTargets.map(t => `
    <div class="delivery-reason">${escapeHtml(t.deviceName || t.deviceId.slice(0, 8))}: ${escapeHtml(t.reason)}</div>
  `).join('');

  const summaryHtml = `
    <div class="delivery-summary">
      ${deliveredCount > 0 ? `<span><span class="delivery-dot" style="background:var(--green)"></span>${deliveredCount} 送达</span>` : ''}
      ${sentCount > 0 ? `<span><span class="delivery-dot" style="background:var(--accent)"></span>${sentCount} 已发</span>` : ''}
      ${failedCount > 0 ? `<span><span class="delivery-dot" style="background:var(--red)"></span>${failedCount} 失败</span>` : ''}
    </div>
  `;

  return `
    <div class="delivery-tags">${tagsHtml}</div>
    ${reasonsHtml}
    ${summaryHtml}
  `;
}

function _renderReceivedStatus(item) {
  const status = item.status || 'delivered';
  const icon = status === 'delivered' ? '✓' : '✗';
  const label = status === 'delivered' ? '已写入剪贴板' : '写入失败';
  let html = `<div class="receive-status status-${status}">${icon} ${label}</div>`;
  if (item.reason) {
    html += `<div class="delivery-reason">${escapeHtml(item.reason)}</div>`;
  }
  return html;
}

function renderHistory() {
  const list = $('#historyList');

  if (history.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        <p>暂无同步记录</p>
      </div>`;
    return;
  }

  list.innerHTML = history.map(item => {
    const timeStr = formatTime(item.timestamp);
    const isText = item.type === 'text';
    const contentHtml = isText
      ? `<div class="history-content">${escapeHtml(item.content || '')}</div>`
      : `<img class="history-content image-thumb" src="${item.content}" alt="图片">`;

    const isSent = item.direction === 'sent';
    const hasTargets = isSent && item.targets && item.targets.length > 0;
    const hasDetails = hasTargets || (!isSent && (item.status || item.reason));
    const isExpanded = expandedItems.has(item.id);

    let detailHtml = '';
    if (isSent) {
      detailHtml = _renderSentTargets(item);
    } else {
      detailHtml = _renderReceivedStatus(item);
    }

    return `
      <div class="history-item ${isExpanded ? 'expanded' : ''}" data-id="${item.id}">
        <div class="history-type-icon ${item.type}">
          ${isText ? 'T' : '🖼'}
        </div>
        <div class="history-body">
          ${contentHtml}
          <div class="history-meta">
            <span class="history-direction ${item.direction}">
              ${isSent ? '发送' : '接收'}
            </span>
            <span>${escapeHtml(item.sourceDevice || '未知')}</span>
            <span>${timeStr}</span>
            ${hasDetails ? `<button class="expand-toggle" data-id="${item.id}">${isExpanded ? '收起' : '详情'}</button>` : ''}
          </div>
          ${hasDetails ? `<div class="history-item-expand ${isExpanded ? 'visible' : ''}">${detailHtml}</div>` : ''}
        </div>
        <div class="history-actions-inline">
          <button class="btn-icon apply-btn" title="应用到剪贴板" data-id="${item.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
              <rect x="8" y="2" width="8" height="4" rx="1"/>
            </svg>
          </button>
          <button class="btn-icon delete-btn" title="删除" data-id="${item.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.expand-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (expandedItems.has(id)) {
        expandedItems.delete(id);
      } else {
        expandedItems.add(id);
      }
      renderHistory();
    });
  });

  list.querySelectorAll('.apply-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const item = history.find(h => h.id === id);
      if (item) {
        await clipSync.applyClipboard(item);
        showToast('已应用到剪贴板');
      }
    });
  });

  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const newHistory = await clipSync.deleteHistoryItem(id);
      history = newHistory;
      renderHistory();
    });
  });
}

function renderSyncTargets() {
  const list = $('#syncTargetList');
  const onlineDevices = devices.filter(d => d.online);

  if (onlineDevices.length === 0) {
    list.innerHTML = '<p class="empty-hint">暂无在线设备</p>';
    return;
  }

  list.innerHTML = onlineDevices.map(device => `
    <div class="sync-target-item">
      <label>
        <input type="checkbox" data-device-id="${device.id}" ${selectedTargets.has(device.id) ? 'checked' : ''}>
        <span class="status-dot online"></span>
        ${escapeHtml(device.name)}
      </label>
    </div>
  `).join('');

  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const deviceId = cb.dataset.deviceId;
      if (cb.checked) {
        selectedTargets.add(deviceId);
      } else {
        selectedTargets.delete(deviceId);
      }
      const targetIds = Array.from(selectedTargets);
      await clipSync.setSyncTargets(targetIds);
      if (targetIds.length > 0) {
        showToast(`选择性同步：${targetIds.length} 台设备`);
      } else {
        showToast('同步所有设备');
      }
    });
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + time;
}

function escapeHtml(str) {
  if (!str) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, c => map[c]);
}

let toastTimer = null;
function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

document.addEventListener('DOMContentLoaded', init);
