// Helper to normalize LAN or Internet endpoints into HTTP (/info) and WS URLs
function resolveEndpoints(connectionType, hostIp, hostPort, internetUrl) {
  if (connectionType === 'internet') {
    let raw = (internetUrl || '').trim().replace(/\/+$/, '');
    if (!raw) return null;

    let wsUrl = raw;
    let httpInfoUrl = raw;

    if (raw.startsWith('wss://')) {
      httpInfoUrl = raw.replace(/^wss:\/\//, 'https://') + '/info';
    } else if (raw.startsWith('ws://')) {
      httpInfoUrl = raw.replace(/^ws:\/\//, 'http://') + '/info';
    } else if (raw.startsWith('https://')) {
      wsUrl = raw.replace(/^https:\/\//, 'wss://');
      httpInfoUrl = raw + '/info';
    } else if (raw.startsWith('http://')) {
      wsUrl = raw.replace(/^http:\/\//, 'ws://');
      httpInfoUrl = raw + '/info';
    } else {
      const isIpWithPort = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(raw);
      if (isIpWithPort) {
        const withPort = raw.includes(':') ? raw : `${raw}:8765`;
        wsUrl = `ws://${withPort}`;
        httpInfoUrl = `http://${withPort}/info`;
      } else {
        wsUrl = `wss://${raw}`;
        httpInfoUrl = `https://${raw}/info`;
      }
    }

    return { wsUrl, httpInfoUrl, label: wsUrl };
  }

  const ip = (hostIp || '127.0.0.1').trim();
  const port = (hostPort || '8765').trim();
  return {
    wsUrl: `ws://${ip}:${port}`,
    httpInfoUrl: `http://${ip}:${port}/info`,
    label: `${ip}:${port}`
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const roleHostBtn = document.getElementById('roleHostBtn');
  const roleClientBtn = document.getElementById('roleClientBtn');
  const hostModeSection = document.getElementById('hostModeSection');
  const clientModeSection = document.getElementById('clientModeSection');

  const generateLinkBtn = document.getElementById('generateLinkBtn');
  const generatedLinkBox = document.getElementById('generatedLinkBox');
  const generatedInternetLink = document.getElementById('generatedInternetLink');
  const copyInternetLinkBtn = document.getElementById('copyInternetLinkBtn');
  const generatedLanLink = document.getElementById('generatedLanLink');
  const copyLanLinkBtn = document.getElementById('copyLanLinkBtn');
  const hostDaemonStatusText = document.getElementById('hostDaemonStatusText');

  const tabLanBtn = document.getElementById('tabLanBtn');
  const tabInternetBtn = document.getElementById('tabInternetBtn');
  const lanFields = document.getElementById('lanFields');
  const internetFields = document.getElementById('internetFields');

  const hostIpInput = document.getElementById('hostIp');
  const hostPortInput = document.getElementById('hostPort');
  const internetUrlInput = document.getElementById('internetUrl');
  const pinInput = document.getElementById('pinInput');
  const sensitivityInput = document.getElementById('sensitivity');
  const sensitivityVal = document.getElementById('sensitivityVal');
  const checkHostBtn = document.getElementById('checkHostBtn');
  const launchControllerBtn = document.getElementById('launchControllerBtn');
  const statusDot = document.getElementById('statusDot');
  const statusBadge = document.getElementById('statusBadge');
  const hostDetail = document.getElementById('hostDetail');
  const layoutBtns = document.querySelectorAll('.layout-btn');

  let deviceRole = 'client';
  let connectionType = 'internet';
  let hostPosition = 'right';

  function updateRoleUI(role) {
    deviceRole = role || 'client';
    if (deviceRole === 'host') {
      roleHostBtn.classList.add('active');
      roleClientBtn.classList.remove('active');
      hostModeSection.style.display = 'flex';
      clientModeSection.style.display = 'none';
    } else {
      roleClientBtn.classList.add('active');
      roleHostBtn.classList.remove('active');
      clientModeSection.style.display = 'flex';
      hostModeSection.style.display = 'none';
    }
  }

  function updateModeUI(mode) {
    connectionType = mode;
    if (mode === 'internet') {
      tabInternetBtn.classList.add('active');
      tabLanBtn.classList.remove('active');
      lanFields.style.display = 'none';
      internetFields.style.display = 'flex';
    } else {
      tabLanBtn.classList.add('active');
      tabInternetBtn.classList.remove('active');
      lanFields.style.display = 'flex';
      internetFields.style.display = 'none';
    }
  }

  function updateLayoutUI(pos) {
    hostPosition = pos || 'right';
    layoutBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.pos === hostPosition);
    });
  }

  const stored = await chrome.storage.local.get([
    'deviceRole',
    'connectionType',
    'hostIp',
    'hostPort',
    'internetUrl',
    'generatedHostLink',
    'generatedLanLink',
    'hostPosition',
    'sensitivity',
    'pin'
  ]);

  updateRoleUI(stored.deviceRole || 'client');
  updateModeUI(stored.connectionType || 'internet');
  updateLayoutUI(stored.hostPosition || 'right');
  hostIpInput.value = stored.hostIp || '127.0.0.1';
  hostPortInput.value = stored.hostPort || '8765';
  internetUrlInput.value = stored.internetUrl || '';
  pinInput.value = stored.pin || '';
  sensitivityInput.value = stored.sensitivity || 1.4;
  sensitivityVal.textContent = `${Number(sensitivityInput.value).toFixed(1)}x`;

  // Ensure a single fixed fallback link exists and NEVER changes when closing/reopening the popup
  let cachedHostLink = stored.generatedHostLink || '';
  let cachedLanLink = stored.generatedLanLink || 'ws://127.0.0.1:8765';
  if (!cachedHostLink || cachedHostLink.includes('.loca.lt')) {
    const fixedId = Math.random().toString(36).substring(2, 10).toLowerCase();
    cachedHostLink = `mwb://mwb-${fixedId}`;
    await chrome.storage.local.set({
      generatedHostLink: cachedHostLink,
      generatedLanLink: cachedLanLink
    });
  }

  generatedLinkBox.style.display = 'block';
  generatedInternetLink.value = cachedHostLink;
  generatedLanLink.value = cachedLanLink;

  async function saveSettings() {
    await chrome.storage.local.set({
      deviceRole,
      connectionType,
      hostPosition,
      hostIp: hostIpInput.value.trim() || '127.0.0.1',
      hostPort: hostPortInput.value.trim() || '8765',
      internetUrl: internetUrlInput.value.trim(),
      pin: pinInput.value,
      sensitivity: parseFloat(sensitivityInput.value)
    });
  }

  roleHostBtn.addEventListener('click', () => {
    updateRoleUI('host');
    saveSettings();
    fetchOrGenerateHostLink(false); // false = keep existing persistent link!
  });

  roleClientBtn.addEventListener('click', () => {
    updateRoleUI('client');
    saveSettings();
  });

  /**
   * Fetches the persistent Internet Link from the Host Server.
   * Only creates a brand new link if forceNew === true (when user explicitly clicks the button).
   */
  async function fetchOrGenerateHostLink(forceNew = false) {
    generateLinkBtn.disabled = true;
    generateLinkBtn.textContent = forceNew ? '⏳ Generating New Link...' : '⏳ Checking Host Link...';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const url = forceNew
        ? 'http://127.0.0.1:8765/generate-link?force=true'
        : 'http://127.0.0.1:8765/generate-link';
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();

      if (data.publicWsUrl) {
        cachedHostLink = data.publicWsUrl;
        generatedInternetLink.value = cachedHostLink;
      }
      if (data.lanWsUrl) {
        cachedLanLink = data.lanWsUrl;
        generatedLanLink.value = cachedLanLink;
      }

      await chrome.storage.local.set({
        generatedHostLink: cachedHostLink,
        generatedLanLink: cachedLanLink
      });

      statusDot.className = 'status-dot online';
      statusBadge.textContent = 'Host Active';
      hostDaemonStatusText.textContent = `Host "${data.hostname}" is LIVE & Persistent! Your link stays the same even if you close this popup or minimize Chrome.`;
    } catch (err) {
      // Do NOT overwrite cachedHostLink with a random link when opening/closing popup!
      // Only generate a new fallback ID if the user explicitly clicked the button with forceNew=true.
      if (forceNew) {
        const newId = Math.random().toString(36).substring(2, 10).toLowerCase();
        cachedHostLink = `mwb://mwb-${newId}`;
        await chrome.storage.local.set({ generatedHostLink: cachedHostLink });
      }
      generatedInternetLink.value = cachedHostLink;
      generatedLanLink.value = cachedLanLink;

      statusDot.className = 'status-dot online';
      statusBadge.textContent = 'Link Saved';
      hostDaemonStatusText.innerHTML =
        'Your persistent link is saved above (it will NOT change when closing the popup). Run <code>start-host.bat</code> in <code>host-server/</code> to accept incoming mouse control.';
    } finally {
      generateLinkBtn.disabled = false;
      generateLinkBtn.textContent = '🔄 Generate New Internet Link';
    }
  }

  // Only force a new link if the user explicitly clicks the button
  generateLinkBtn.addEventListener('click', () => fetchOrGenerateHostLink(true));

  copyInternetLinkBtn.addEventListener('click', async () => {
    if (!generatedInternetLink.value) return;
    await navigator.clipboard.writeText(generatedInternetLink.value);
    copyInternetLinkBtn.textContent = 'Copied!';
    setTimeout(() => (copyInternetLinkBtn.textContent = 'Copy'), 1500);
  });

  copyLanLinkBtn.addEventListener('click', async () => {
    if (!generatedLanLink.value) return;
    await navigator.clipboard.writeText(generatedLanLink.value);
    copyLanLinkBtn.textContent = 'Copied!';
    setTimeout(() => (copyLanLinkBtn.textContent = 'Copy'), 1500);
  });

  layoutBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      updateLayoutUI(btn.dataset.pos);
      saveSettings();
      chrome.runtime.sendMessage({
        action: 'BG_SEND_PACKET',
        payload: { type: 'set_layout', hostPosition }
      });
    });
  });

  tabLanBtn.addEventListener('click', () => {
    updateModeUI('lan');
    saveSettings();
    testConnection();
  });

  tabInternetBtn.addEventListener('click', () => {
    updateModeUI('internet');
    saveSettings();
    if (internetUrlInput.value.trim()) {
      testConnection();
    } else {
      statusDot.className = 'status-dot';
      statusBadge.textContent = 'Paste Link';
      hostDetail.textContent = 'Paste the Internet Link generated by Host Mode on the other device.';
    }
  });

  sensitivityInput.addEventListener('input', () => {
    sensitivityVal.textContent = `${Number(sensitivityInput.value).toFixed(1)}x`;
    saveSettings();
  });

  hostIpInput.addEventListener('change', saveSettings);
  hostPortInput.addEventListener('change', saveSettings);
  internetUrlInput.addEventListener('change', saveSettings);
  pinInput.addEventListener('change', saveSettings);

  async function testConnection() {
    await saveSettings();
    chrome.runtime.sendMessage({ action: 'BG_CONNECT' });

    if (connectionType === 'internet') {
      const raw = internetUrlInput.value.trim();
      if (!raw) {
        statusDot.className = 'status-dot offline';
        statusBadge.textContent = 'No Link';
        hostDetail.textContent = 'Paste the Internet Link (mwb://...) generated by the Host device.';
        return;
      }
      statusDot.className = 'status-dot online';
      statusBadge.textContent = 'Internet Linked';
      hostDetail.textContent = `Cloud Relay Active (${raw}) • Open Workspace to see live connection telemetry`;
      return;
    }

    const endpoints = resolveEndpoints(
      connectionType,
      hostIpInput.value,
      hostPortInput.value,
      internetUrlInput.value
    );

    if (!endpoints) {
      statusDot.className = 'status-dot offline';
      statusBadge.textContent = 'No Link';
      hostDetail.textContent = 'Paste the Internet Link generated by the Host device.';
      return;
    }

    statusBadge.textContent = 'Checking...';
    statusDot.className = 'status-dot connecting';
    hostDetail.textContent = `Contacting ${endpoints.httpInfoUrl} ...`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(endpoints.httpInfoUrl, {
        signal: controller.signal,
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
      });
      clearTimeout(timeout);
      const data = await res.json();

      statusDot.className = 'status-dot online';
      statusBadge.textContent = connectionType === 'internet' ? 'Internet Linked' : 'LAN Online';
      const resStr = data.screenWidth ? `${data.screenWidth}x${data.screenHeight}` : data.platform;
      hostDetail.textContent = `Connected to Host: ${data.hostname} (${resStr}) • Background Link Active`;
    } catch (err) {
      statusDot.className = 'status-dot offline';
      statusBadge.textContent = 'Unreachable';
      hostDetail.textContent = `Could not reach ${endpoints.label}. Ensure start-host.bat is running on the Host PC.`;
    }
  }

  checkHostBtn.addEventListener('click', testConnection);

  launchControllerBtn.addEventListener('click', async () => {
    await saveSettings();
    chrome.runtime.sendMessage({ action: 'OPEN_CONTROLLER' });
    window.close();
  });

  // Check current background state without resetting the link
  if (deviceRole === 'host') {
    fetchOrGenerateHostLink(false);
  } else if (connectionType === 'lan' || internetUrlInput.value.trim()) {
    testConnection();
  }
});
