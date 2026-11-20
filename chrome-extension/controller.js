const CLOUD_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';

// Storage & Runtime shim so the same UI runs seamlessly in a Native Desktop Window (http://127.0.0.1:8765) OR Chrome Extension
const isChromeExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
const AppStorage = {
  async get(keys) {
    if (isChromeExt) {
      return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
    }
    const out = {};
    for (const k of keys) {
      const raw = localStorage.getItem('mwb_' + k);
      if (raw !== null) {
        try { out[k] = JSON.parse(raw); } catch { out[k] = raw; }
      }
    }
    return out;
  },
  async set(obj) {
    if (isChromeExt) {
      return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
    }
    for (const [k, v] of Object.entries(obj)) {
      localStorage.setItem('mwb_' + k, JSON.stringify(v));
    }
  }
};

function sendExtensionMessage(msg) {
  if (isChromeExt && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
}

function parseConnectionTarget(connectionType, hostIp, hostPort, internetUrl) {
  if (connectionType === 'internet') {
    let raw = (internetUrl || '').trim();
    if (!raw) return null;

    let roomId = raw
      .replace(/^mwb:\/\//i, '')
      .replace(/^wss?:\/\//i, '')
      .replace(/^https?:\/\//i, '')
      .replace(/\.loca\.lt.*$/i, '')
      .replace(/\/+$/, '')
      .trim();

    if (roomId.includes('.') && !raw.includes('.loca.lt') && !raw.startsWith('mwb://')) {
      const wsUrl = raw.startsWith('ws') ? raw : `wss://${roomId}`;
      return { mode: 'ws', wsUrl, label: wsUrl };
    }

    return { mode: 'cloud', roomId, label: `mwb://${roomId}` };
  }

  const ip = (hostIp || '127.0.0.1').trim();
  const port = (hostPort || '8765').trim();
  return {
    mode: 'ws',
    wsUrl: `ws://${ip}:${port}`,
    label: `ws://${ip}:${port}`
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const wsDot = document.getElementById('wsDot');
  const wsStatus = document.getElementById('wsStatus');
  const activeScreenBadge = document.getElementById('activeScreenBadge');

  const osHookBadge = document.getElementById('osHookBadge');
  const osGlobalCaptureToggle = document.getElementById('osGlobalCaptureToggle');
  const clipboardSyncToggle = document.getElementById('clipboardSyncToggle');

  const wsRoleHostBtn = document.getElementById('wsRoleHostBtn');
  const wsRoleClientBtn = document.getElementById('wsRoleClientBtn');
  const wsGenerateLinkBtn = document.getElementById('wsGenerateLinkBtn');

  const wsModeLanBtn = document.getElementById('wsModeLanBtn');
  const wsModeInternetBtn = document.getElementById('wsModeInternetBtn');
  const wsLanGroup = document.getElementById('wsLanGroup');
  const wsInternetGroup = document.getElementById('wsInternetGroup');

  const wsIp = document.getElementById('wsIp');
  const wsPort = document.getElementById('wsPort');
  const wsInternetUrl = document.getElementById('wsInternetUrl');
  const wsPin = document.getElementById('wsPin');
  const connectBtn = document.getElementById('connectBtn');
  const githubUpdateBtn = document.getElementById('githubUpdateBtn');
  const hostNameMetric = document.getElementById('hostNameMetric');
  const latencyMetric = document.getElementById('latencyMetric');
  const wsSensitivity = document.getElementById('wsSensitivity');
  const wsSensitivityVal = document.getElementById('wsSensitivityVal');

  const discoveredTunnelUrl = document.getElementById('discoveredTunnelUrl');
  const discoveredPairingPin = document.getElementById('discoveredPairingPin');
  const copyTunnelBtn = document.getElementById('copyTunnelBtn');
  const discoveredLanUrl = document.getElementById('discoveredLanUrl');
  const copyLanUrlBtn = document.getElementById('copyLanUrlBtn');

  const peerConnectionCard = document.getElementById('peerConnectionCard');
  const peerStatusDot = document.getElementById('peerStatusDot');
  const peerStatusTitle = document.getElementById('peerStatusTitle');
  const peerStatusSub = document.getElementById('peerStatusSub');

  const capturePad = document.getElementById('capturePad');
  const captureTitle = document.getElementById('captureTitle');
  const captureSub = document.getElementById('captureSub');
  const activeEdgeLabel = document.getElementById('activeEdgeLabel');

  const monitorsArena = document.getElementById('monitorsArena');
  const clientMonitorBox = document.getElementById('clientMonitorBox');
  const hostMonitorBox = document.getElementById('hostMonitorBox');
  const clientResLabel = document.getElementById('clientResLabel');
  const hostResLabel = document.getElementById('hostResLabel');
  const clientRadarDot = document.getElementById('clientRadarDot');
  const hostRadarDot = document.getElementById('hostRadarDot');

  const hostXYVal = document.getElementById('hostXYVal');
  const lastKeyVal = document.getElementById('lastKeyVal');
  const eventLog = document.getElementById('eventLog');

  const edgePortals = {
    left: document.getElementById('edgePortalLeft'),
    right: document.getElementById('edgePortalRight'),
    top: document.getElementById('edgePortalTop'),
    bottom: document.getElementById('edgePortalBottom')
  };
  const layoutChips = document.querySelectorAll('.layout-chip');

  let ws = null;
  let localDaemonWs = null;
  let localDaemonReady = false;
  let mqttClient = null;
  let activeTransport = 'none'; // 'native_daemon' | 'ws' | 'cloud'
  let activeRoomId = '';
  let pingTimer = null;
  let autoReconnectTimer = null;
  let deviceRole = 'client';
  let connectionType = 'internet';
  let hostPosition = 'right';
  let activeScreen = 'client';
  let sensitivity = 1.4;
  let returnCooldownUntil = 0;
  let hostVirtualX = 960;
  let hostVirtualY = 540;
  const myClientId = 'mwb_ctrl_' + Math.random().toString(36).substring(2, 8);

  function logEvent(text) {
    const row = document.createElement('div');
    row.className = 'log-item';
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    row.textContent = `[${time}] ${text}`;
    eventLog.prepend(row);
    while (eventLog.children.length > 40) {
      eventLog.removeChild(eventLog.lastChild);
    }
  }

  function updatePeerTelemetryCard(status, titleText, subText) {
    peerConnectionCard.className = `peer-status-card ${status}`;
    if (status === 'connecting') {
      peerStatusDot.className = 'status-dot connecting';
    } else if (status === 'connected') {
      peerStatusDot.className = 'status-dot online';
    } else if (status === 'rejected') {
      peerStatusDot.className = 'status-dot offline';
    } else {
      peerStatusDot.className = 'status-dot';
    }
    peerStatusTitle.textContent = titleText;
    peerStatusSub.textContent = subText;
  }

  // Connect to the Local Native Desktop Companion Service (ws://127.0.0.1:8765) for OS-level hooks & E2EE transport
  function connectLocalNativeService() {
    if (localDaemonWs && (localDaemonWs.readyState === WebSocket.OPEN || localDaemonWs.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      localDaemonWs = new WebSocket('ws://127.0.0.1:8765');
    } catch {
      return;
    }

    localDaemonWs.onopen = () => {
      localDaemonReady = true;
      if (osHookBadge) {
        osHookBadge.textContent = 'Native OS Service Active (AES-256-GCM)';
        osHookBadge.style.background = 'rgba(34, 197, 94, 0.2)';
        osHookBadge.style.color = '#22c55e';
      }
      logEvent('Connected to local Native OS Input Service (127.0.0.1:8765)');
    };

    localDaemonWs.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'native_controller_screen') {
          updateActiveScreenUI(msg.activeScreen);
          if (msg.activeScreen === 'host') {
            logEvent(`OS Edge Hook crossed (${msg.edge.toUpperCase()}) -> Controlling Receiver`);
          } else {
            logEvent(`Returned to local PC (${msg.reason || 'Border return'})`);
          }
          return;
        }
        if (msg.type === 'clipboard_event') {
          logEvent('📋 Synchronized OS Clipboard with remote device');
          return;
        }
        handleIncomingPacket(msg);
      } catch {}
    };

    localDaemonWs.onclose = () => {
      localDaemonReady = false;
      if (osHookBadge) {
        osHookBadge.textContent = 'Browser Fallback Mode (Start Native Service)';
        osHookBadge.style.background = 'rgba(245, 158, 11, 0.2)';
        osHookBadge.style.color = '#f59e0b';
      }
      setTimeout(connectLocalNativeService, 3000);
    };

    localDaemonWs.onerror = () => {};
  }

  connectLocalNativeService();

  if (osGlobalCaptureToggle) {
    osGlobalCaptureToggle.addEventListener('change', () => {
      if (localDaemonReady && localDaemonWs) {
        localDaemonWs.send(JSON.stringify({
          type: 'native_set_os_capture',
          enabled: osGlobalCaptureToggle.checked,
          hostPosition
        }));
        logEvent(`OS-Wide Global Edge & Hook Capture: ${osGlobalCaptureToggle.checked ? 'ENABLED' : 'DISABLED'}`);
      }
    });
  }

  if (clipboardSyncToggle) {
    clipboardSyncToggle.addEventListener('change', () => {
      if (localDaemonReady && localDaemonWs) {
        localDaemonWs.send(JSON.stringify({
          type: 'native_set_clipboard_sync',
          enabled: clipboardSyncToggle.checked
        }));
        logEvent(`Bidirectional OS Clipboard Sync: ${clipboardSyncToggle.checked ? 'ENABLED' : 'DISABLED'}`);
      }
    });
  }

  function setDeviceRoleUI(role) {
    deviceRole = role || 'client';
    if (deviceRole === 'host') {
      wsRoleHostBtn.classList.add('active');
      wsRoleClientBtn.classList.remove('active');
      captureTitle.textContent = '🖥️ Receiver (Host) Mode Active — Waiting for Controller';
      captureSub.textContent =
        'Copy the Session Link & 6-digit Pairing PIN above and enter them on your Controller PC. Input is end-to-end encrypted (AES-256-GCM).';
    } else {
      wsRoleClientBtn.classList.add('active');
      wsRoleHostBtn.classList.remove('active');
      updateActiveScreenUI(activeScreen);
    }
    AppStorage.set({ deviceRole });
  }

  function updateLayoutUI(pos) {
    hostPosition = pos || 'right';
    monitorsArena.dataset.layout = hostPosition;
    if (activeEdgeLabel) activeEdgeLabel.textContent = hostPosition.toUpperCase();

    Object.keys(edgePortals).forEach((edge) => {
      edgePortals[edge].classList.toggle('enabled', edge === hostPosition);
    });

    layoutChips.forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.pos === hostPosition);
    });

    AppStorage.set({ hostPosition });
    sendPacket({ type: 'set_layout', hostPosition });
    if (localDaemonReady && localDaemonWs && osGlobalCaptureToggle) {
      localDaemonWs.send(JSON.stringify({
        type: 'native_set_os_capture',
        enabled: osGlobalCaptureToggle.checked && deviceRole === 'client',
        hostPosition
      }));
    }
  }

  function updateActiveScreenUI(screen) {
    activeScreen = screen;
    if (screen === 'host') {
      activeScreenBadge.textContent = 'Active: Receiver Device (Monitor 2)';
      activeScreenBadge.classList.add('on-host');
      clientMonitorBox.classList.remove('active-monitor');
      hostMonitorBox.classList.add('active-monitor');
      clientRadarDot.style.display = 'none';
      hostRadarDot.style.display = 'block';
      capturePad.classList.add('locked');
      captureTitle.textContent = 'Mouse & Keyboard Controlling Receiver (Monitor 2)';
      captureSub.textContent =
        'Your local cursor is parked. All OS-wide mouse movements, clicks, scroll wheel, and keystrokes are controlling the Receiver PC. Slide back across the Receiver border or press Ctrl+Alt+Q to return!';
    } else {
      activeScreenBadge.textContent = 'Active: Controller PC (Monitor 1)';
      activeScreenBadge.classList.remove('on-host');
      hostMonitorBox.classList.remove('active-monitor');
      clientMonitorBox.classList.add('active-monitor');
      hostRadarDot.style.display = 'none';
      clientRadarDot.style.display = 'block';
      capturePad.classList.remove('locked');
      if (deviceRole === 'client') {
        captureTitle.textContent = 'Controller Mode — Move Cursor to Physical Screen Edge';
        captureSub.innerHTML = `Move your physical mouse across the <strong>${hostPosition.toUpperCase()} edge</strong> of your monitor (even outside this window when Native OS Hooks are enabled) to seamlessly control the 2nd computer!`;
      }
    }
  }

  function setConnectionTypeUI(type) {
    connectionType = type;
    if (type === 'internet') {
      wsModeInternetBtn.classList.add('active');
      wsModeLanBtn.classList.remove('active');
      wsLanGroup.style.display = 'none';
      wsInternetGroup.style.display = 'flex';
    } else {
      wsModeLanBtn.classList.add('active');
      wsModeInternetBtn.classList.remove('active');
      wsLanGroup.style.display = 'flex';
      wsInternetGroup.style.display = 'none';
    }
  }

  const stored = await AppStorage.get([
    'deviceRole',
    'connectionType',
    'hostPosition',
    'hostIp',
    'hostPort',
    'internetUrl',
    'generatedHostLink',
    'generatedLanLink',
    'sensitivity',
    'pin'
  ]);
  setConnectionTypeUI(stored.connectionType || 'internet');
  updateLayoutUI(stored.hostPosition || 'right');
  setDeviceRoleUI(stored.deviceRole || 'client');

  wsIp.value = stored.hostIp || '127.0.0.1';
  wsPort.value = stored.hostPort || '8765';
  wsPin.value = stored.pin || '';

  let cachedHostLink = stored.generatedHostLink || '';
  let cachedLanLink = stored.generatedLanLink || 'ws://127.0.0.1:8765';
  let cachedPin = stored.pin || '';

  discoveredTunnelUrl.value = cachedHostLink;
  if (discoveredPairingPin) discoveredPairingPin.value = cachedPin;
  discoveredLanUrl.value = cachedLanLink;
  wsInternetUrl.value = stored.internetUrl || cachedHostLink;

  sensitivity = parseFloat(stored.sensitivity || 1.4);
  wsSensitivity.value = sensitivity;
  wsSensitivityVal.textContent = `${sensitivity.toFixed(1)}x`;
  clientResLabel.textContent = `${window.screen.width} × ${window.screen.height}`;

  wsRoleHostBtn.addEventListener('click', () => {
    setDeviceRoleUI('host');
    if (localDaemonReady && localDaemonWs) {
      localDaemonWs.send(JSON.stringify({ type: 'native_controller_disconnect' }));
    }
    fetchOrGenerateHostLink(false);
  });

  wsRoleClientBtn.addEventListener('click', () => {
    setDeviceRoleUI('client');
    connectTransport(false);
  });

  async function fetchOrGenerateHostLink(forceNew = false) {
    wsGenerateLinkBtn.disabled = true;
    wsGenerateLinkBtn.textContent = forceNew ? '⏳ Generating...' : '⏳ Syncing...';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const url = forceNew
        ? 'http://127.0.0.1:8765/generate-link?force=true'
        : 'http://127.0.0.1:8765/generate-link';
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();

      if (data.publicWsUrl) {
        cachedHostLink = data.publicWsUrl;
        discoveredTunnelUrl.value = cachedHostLink;
        wsInternetUrl.value = cachedHostLink;
      }
      if (data.pairingPin) {
        cachedPin = data.pairingPin;
        if (discoveredPairingPin) discoveredPairingPin.value = cachedPin;
        if (!wsPin.value || forceNew) wsPin.value = cachedPin;
      }
      if (data.lanWsUrl) {
        cachedLanLink = data.lanWsUrl;
        discoveredLanUrl.value = cachedLanLink;
      }

      logEvent(`Synced Session: ${cachedHostLink} (PIN: ${cachedPin})`);

      await AppStorage.set({
        generatedHostLink: cachedHostLink,
        generatedLanLink: cachedLanLink,
        internetUrl: cachedHostLink,
        pin: wsPin.value
      });
    } catch (err) {
      if (forceNew) {
        const newId = Math.random().toString(36).substring(2, 10).toLowerCase();
        cachedHostLink = `mwb://mwb-${newId}`;
        wsInternetUrl.value = cachedHostLink;
        await AppStorage.set({
          generatedHostLink: cachedHostLink,
          internetUrl: cachedHostLink
        });
      }
      discoveredTunnelUrl.value = cachedHostLink;
      discoveredLanUrl.value = cachedLanLink;
    } finally {
      wsGenerateLinkBtn.disabled = false;
      wsGenerateLinkBtn.textContent = '🔄 New Session & PIN';
      connectTransport(false);
    }
  }

  wsGenerateLinkBtn.addEventListener('click', () => fetchOrGenerateHostLink(true));

  copyTunnelBtn.addEventListener('click', async () => {
    if (!discoveredTunnelUrl.value) return;
    const pinStr = discoveredPairingPin && discoveredPairingPin.value ? ` (PIN: ${discoveredPairingPin.value})` : '';
    await navigator.clipboard.writeText(`${discoveredTunnelUrl.value}${pinStr}`);
    copyTunnelBtn.textContent = 'Copied!';
    setTimeout(() => (copyTunnelBtn.textContent = 'Copy Link + PIN'), 1500);
  });

  copyLanUrlBtn.addEventListener('click', async () => {
    if (!discoveredLanUrl.value) return;
    await navigator.clipboard.writeText(discoveredLanUrl.value);
    copyLanUrlBtn.textContent = 'Copied!';
    setTimeout(() => (copyLanUrlBtn.textContent = 'Copy'), 1500);
  });

  layoutChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      updateLayoutUI(chip.dataset.pos);
      logEvent(`Monitor Layout: Receiver placed on ${chip.dataset.pos.toUpperCase()} edge`);
    });
  });

  wsModeLanBtn.addEventListener('click', () => {
    setConnectionTypeUI('lan');
    AppStorage.set({ connectionType: 'lan' });
  });

  wsModeInternetBtn.addEventListener('click', () => {
    setConnectionTypeUI('internet');
    AppStorage.set({ connectionType: 'internet' });
  });

  wsSensitivity.addEventListener('input', () => {
    sensitivity = parseFloat(wsSensitivity.value);
    wsSensitivityVal.textContent = `${sensitivity.toFixed(1)}x`;
    AppStorage.set({ sensitivity });
  });

  function sendPacket(payload) {
    if (localDaemonReady && localDaemonWs && localDaemonWs.readyState === WebSocket.OPEN) {
      localDaemonWs.send(JSON.stringify(payload));
      return;
    }
    if (activeTransport === 'cloud' && mqttClient && mqttClient.connected && activeRoomId) {
      mqttClient.publish(`mwb/v1/${activeRoomId}/to_host`, JSON.stringify(payload));
      return;
    }
    if (activeTransport === 'ws' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return;
    }
    sendExtensionMessage({ action: 'BG_SEND_PACKET', payload });
  }

  function handleIncomingPacket(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'peer_connection_event') {
      if (msg.status === 'connecting') {
        updatePeerTelemetryCard(
          'connecting',
          `⏳ ${msg.peerName} is trying to connect...`,
          `Verifying PIN & AES-256-GCM handshake via ${msg.transport || 'Internet Link'}`
        );
        logEvent(`🔔 Connection attempt from ${msg.peerName} (${msg.transport})`);
      } else if (msg.status === 'connected') {
        updatePeerTelemetryCard(
          'connected',
          `🟢 ${msg.peerName} Connected!`,
          `Link active via ${msg.transport || 'Network'} • Ready for seamless edge pass-through`
        );
        logEvent(`✅ ${msg.peerName} authenticated via ${msg.transport}`);
      } else if (msg.status === 'rejected') {
        updatePeerTelemetryCard(
          'rejected',
          `🔴 Connection Rejected: ${msg.peerName}`,
          `Reason: ${msg.reason || 'Authentication failed'}`
        );
        logEvent(`❌ Rejected connection from ${msg.peerName}: ${msg.reason}`);
      } else if (msg.status === 'disconnected') {
        if (activeScreen === 'host') {
          transitionToClientScreen(0.5, 0.5, 'Peer Disconnected (Fail-Safe Released)');
        }
        updatePeerTelemetryCard(
          'idle',
          `⚪ ${msg.peerName} Disconnected`,
          'Fail-safe released all keys & buttons. Waiting for reconnect...'
        );
        logEvent(`⚪ ${msg.peerName} disconnected — fail-safe input reset complete`);
      }
      return;
    }

    if (msg.type === 'auth_ok') {
      wsDot.className = 'status-dot online';
      wsStatus.textContent = 'Authenticated (E2EE)';
      connectBtn.textContent = 'Connected';
      hostNameMetric.textContent = `${msg.hostname} (${msg.screenWidth || 1920}×${msg.screenHeight || 1080})`;
      hostResLabel.textContent = `${msg.hostname} • ${msg.screenWidth || 1920}×${msg.screenHeight || 1080}`;
      updatePeerTelemetryCard(
        'connected',
        `🟢 Paired with Receiver "${msg.hostname}"`,
        'Move your physical mouse across the configured monitor edge to control Receiver!'
      );
      logEvent(`✅ Authenticated E2EE session with Receiver "${msg.hostname}"`);
      return;
    }

    if (msg.type === 'host_info') {
      const resText = msg.screenWidth ? `${msg.screenWidth} × ${msg.screenHeight}` : msg.platform;
      clientResLabel.textContent = `${msg.hostname} • ${resText}`;

      if (msg.controllerConnected && msg.controllerPeerHostname) {
        wsDot.className = 'status-dot online';
        wsStatus.textContent = 'Paired (E2EE)';
        hostNameMetric.textContent = `${msg.controllerPeerHostname} (${msg.controllerPeerScreen.width}×${msg.controllerPeerScreen.height})`;
        hostResLabel.textContent = `${msg.controllerPeerHostname} • ${msg.controllerPeerScreen.width}×${msg.controllerPeerScreen.height}`;
      } else if (deviceRole === 'host') {
        wsDot.className = 'status-dot online';
        wsStatus.textContent = 'Receiver Ready';
        hostNameMetric.textContent = `${msg.hostname} (${resText})`;
      }

      if (osHookBadge && msg.driverReady !== undefined) {
        if (msg.osHooksInstalled) {
          osHookBadge.textContent = msg.osCaptureEnabled
            ? '🟢 Global OS Hooks Armed (WH_MOUSE_LL + WH_KEYBOARD_LL)'
            : '🟢 Global OS Hooks Ready';
          osHookBadge.style.background = 'rgba(34, 197, 94, 0.2)';
          osHookBadge.style.color = '#22c55e';
        } else {
          osHookBadge.textContent = '⚠️ OS Hooks Pending Permission';
        }
      }

      if (msg.publicWsUrl) {
        cachedHostLink = msg.publicWsUrl;
        discoveredTunnelUrl.value = cachedHostLink;
        AppStorage.set({ generatedHostLink: cachedHostLink });
      }
      if (msg.pairingPin) {
        cachedPin = msg.pairingPin;
        if (discoveredPairingPin) discoveredPairingPin.value = cachedPin;
        if (!wsPin.value) wsPin.value = cachedPin;
      }
      if (msg.lanWsUrl) {
        cachedLanLink = msg.lanWsUrl;
        discoveredLanUrl.value = cachedLanLink;
        AppStorage.set({ generatedLanLink: cachedLanLink });
      }
      return;
    }

    if (msg.type === 'pong') {
      const rtt = Math.max(1, Math.round(Date.now() - msg.ts));
      latencyMetric.textContent = `${rtt} ms`;
      if (msg.hostname) {
        hostNameMetric.textContent = `${msg.hostname}`;
      }
      return;
    }

    if (msg.type === 'host_cursor') {
      hostXYVal.textContent = `${msg.x}, ${msg.y}`;
      hostRadarDot.style.display = 'block';
      hostRadarDot.style.left = `${Math.round((msg.normX || 0.5) * 86 + 7)}%`;
      hostRadarDot.style.top = `${Math.round((msg.normY || 0.5) * 76 + 12)}%`;
      return;
    }

    if (msg.type === 'host_keydown') {
      lastKeyVal.textContent = msg.code || 'Key';
      logEvent(`Remote Key: ${msg.code}`);
      return;
    }

    if (msg.type === 'host_mousedown') {
      logEvent(`Remote Mouse Click (Button ${msg.button})`);
      return;
    }

    if (msg.type === 'return_to_client') {
      transitionToClientScreen(
        msg.normX,
        msg.normY,
        `Crossed Receiver ${msg.crossedHostEdge.toUpperCase()} border`
      );
      return;
    }

    if (msg.type === 'auth_err') {
      updatePeerTelemetryCard('rejected', '🔴 Authentication Failed', msg.message);
      logEvent(`Auth Error: ${msg.message}`);
      wsDot.className = 'status-dot offline';
      wsStatus.textContent = 'Auth Failed';
    }
  }

  async function transitionToHostScreen(normX, normY, triggerSource) {
    if (activeScreen === 'host') return;
    if (performance.now() < returnCooldownUntil) return;
    const isConnected =
      localDaemonReady ||
      (activeTransport === 'cloud' && mqttClient && mqttClient.connected) ||
      (activeTransport === 'ws' && ws && ws.readyState === WebSocket.OPEN);

    if (!isConnected) {
      logEvent('Not connected to Receiver yet. Paste the Session Link & PIN above and click Connect.');
      return;
    }

    try {
      await capturePad.requestPointerLock();
      updateActiveScreenUI('host');
      sendPacket({
        type: 'enter_host',
        clientId: myClientId,
        hostPosition,
        normX: Math.max(0, Math.min(1, normX)),
        normY: Math.max(0, Math.min(1, normY))
      });
      logEvent(`Mouse passed to Receiver via ${triggerSource}`);
    } catch (e) {
      logEvent('Physical screen edge hooks are active via Native Service, or click workspace once for browser pointer lock.');
    }
  }

  function transitionToClientScreen(normX, normY, reason) {
    returnCooldownUntil = performance.now() + 450;
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    updateActiveScreenUI('client');
    hostXYVal.textContent = 'On Monitor 1';

    if (typeof normX === 'number' && typeof normY === 'number') {
      clientRadarDot.style.left = `${Math.round(normX * 88 + 6)}%`;
      clientRadarDot.style.top = `${Math.round(normY * 78 + 10)}%`;
    }
    logEvent(`Mouse returned to Controller PC — ${reason}`);
  }

  Object.keys(edgePortals).forEach((edge) => {
    const portal = edgePortals[edge];
    portal.addEventListener('mouseenter', (e) => {
      if (edge !== hostPosition || activeScreen === 'host') return;
      const normX = e.clientX / window.innerWidth;
      const normY = e.clientY / window.innerHeight;
      transitionToHostScreen(normX, normY, `${edge.toUpperCase()} border crossing`);
    });

    portal.addEventListener('click', (e) => {
      const normX = e.clientX / window.innerWidth;
      const normY = e.clientY / window.innerHeight;
      transitionToHostScreen(normX, normY, `${edge.toUpperCase()} border click`);
    });
  });

  hostMonitorBox.addEventListener('click', (e) => {
    const rect = hostMonitorBox.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;
    transitionToHostScreen(normX, normY, 'Monitor 2 map click');
  });

  document.addEventListener('mousemove', (e) => {
    if (activeScreen === 'client') {
      const normX = e.clientX / window.innerWidth;
      const normY = e.clientY / window.innerHeight;
      clientRadarDot.style.left = `${Math.round(normX * 86 + 7)}%`;
      clientRadarDot.style.top = `${Math.round(normY * 76 + 12)}%`;

      const atRight = hostPosition === 'right' && e.clientX >= window.innerWidth - 6;
      const atLeft = hostPosition === 'left' && e.clientX <= 6;
      const atTop = hostPosition === 'top' && e.clientY <= 6;
      const atBottom = hostPosition === 'bottom' && e.clientY >= window.innerHeight - 6;

      if (atRight || atLeft || atTop || atBottom) {
        transitionToHostScreen(normX, normY, `${hostPosition.toUpperCase()} screen edge`);
      }
      return;
    }

    if (activeScreen === 'host' && document.pointerLockElement === capturePad) {
      accDx += e.movementX * sensitivity;
      accDy += e.movementY * sensitivity;
      if (!moveFlushScheduled) {
        moveFlushScheduled = true;
        setTimeout(flushMouseDeltas, 8);
      }
    }
  });

  let accDx = 0;
  let accDy = 0;
  let moveFlushScheduled = false;

  function flushMouseDeltas() {
    moveFlushScheduled = false;
    if (accDx === 0 && accDy === 0) return;
    const sendX = Math.round(accDx);
    const sendY = Math.round(accDy);
    accDx -= sendX;
    accDy -= sendY;
    if (sendX !== 0 || sendY !== 0) {
      sendPacket({ t: 'm', x: sendX, y: sendY });
    }
  }

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === capturePad;
    if (!locked && activeScreen === 'host') {
      sendPacket({ type: 'leave_host', clientId: myClientId });
      transitionToClientScreen(0.5, 0.5, 'ESC / Pointer Released');
    }
  });

  function cleanupSockets() {
    clearInterval(pingTimer);
    if (ws) {
      try {
        ws.onclose = null;
        ws.close();
      } catch {}
      ws = null;
    }
    if (mqttClient) {
      try {
        mqttClient.end(true);
      } catch {}
      mqttClient = null;
    }
  }

  function connectTransport(isAutoRetry = false) {
    clearTimeout(autoReconnectTimer);

    const ip = wsIp.value.trim() || '127.0.0.1';
    const port = wsPort.value.trim() || '8765';
    const internetUrl = wsInternetUrl.value.trim() || cachedHostLink;
    const pin = wsPin.value.trim() || cachedPin;

    AppStorage.set({
      deviceRole,
      connectionType,
      hostPosition,
      hostIp: ip,
      hostPort: port,
      internetUrl,
      pin
    });

    // When connected to the local Native Desktop Companion Service, delegate encrypted E2EE transport & OS-level hook capture directly to the native daemon!
    if (localDaemonReady && localDaemonWs && localDaemonWs.readyState === WebSocket.OPEN) {
      activeTransport = 'native_daemon';
      if (deviceRole === 'client') {
        wsDot.className = 'status-dot connecting';
        wsStatus.textContent = 'Pairing (E2EE)...';
        localDaemonWs.send(JSON.stringify({
          type: 'native_controller_connect',
          connectionType,
          hostIp: ip,
          hostPort: port,
          internetUrl,
          pin,
          hostPosition,
          sensitivity,
          enableOsCapture: osGlobalCaptureToggle ? osGlobalCaptureToggle.checked : true
        }));
        logEvent(`Native OS Controller connecting to ${connectionType === 'internet' ? internetUrl : ip + ':' + port} (AES-256-GCM)...`);
      } else {
        wsDot.className = 'status-dot online';
        wsStatus.textContent = 'Receiver Active';
        localDaemonWs.send(JSON.stringify({
          type: 'native_set_pin',
          pin
        }));
      }
      return;
    }

    sendExtensionMessage({ action: 'BG_CONNECT' });

    const target = parseConnectionTarget(connectionType, ip, port, internetUrl);
    if (!target) {
      wsDot.className = 'status-dot offline';
      wsStatus.textContent = 'Paste Link';
      return;
    }

    cleanupSockets();
    wsDot.className = 'status-dot connecting';
    wsStatus.textContent = 'Connecting...';
    if (!isAutoRetry) {
      logEvent(`Connecting to ${target.label}...`);
    }

    activeTransport = 'ws';
    try {
      ws = new WebSocket(target.mode === 'ws' ? target.wsUrl : 'ws://127.0.0.1:8765');
    } catch (err) {
      wsDot.className = 'status-dot offline';
      wsStatus.textContent = 'Error';
      return;
    }

    ws.onopen = () => {
      wsDot.className = 'status-dot online';
      wsStatus.textContent = 'Linked';
      connectBtn.textContent = 'Connected';
      sendPacket({
        type: 'hello',
        clientId: myClientId,
        deviceName: deviceRole === 'host' ? 'Host Dashboard' : 'Controller Device',
        transport: 'LAN WebSocket',
        pin
      });
      sendPacket({ type: 'set_layout', hostPosition });

      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        sendPacket({ type: 'ping', clientId: myClientId, ts: Date.now() });
      }, 2500);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleIncomingPacket(msg);
      } catch {}
    };

    ws.onclose = () => {
      wsDot.className = 'status-dot connecting';
      wsStatus.textContent = 'Reconnecting...';
      clearInterval(pingTimer);

      clearTimeout(autoReconnectTimer);
      autoReconnectTimer = setTimeout(() => {
        connectTransport(true);
      }, 2000);
    };

    ws.onerror = () => {};
  }

  connectBtn.addEventListener('click', () => connectTransport(false));

  if (githubUpdateBtn) {
    githubUpdateBtn.addEventListener('click', async () => {
      githubUpdateBtn.disabled = true;
      githubUpdateBtn.textContent = '⏳ Updating...';
      logEvent('⬇️ Triggering GitHub Auto-Update from https://github.com/JustNathan25/OneDesk.git...');
      try {
        await fetch('http://127.0.0.1:8765/github-update');
        logEvent('✅ Pulling latest commits, recompiling, and restarting service...');
      } catch (err) {
        logEvent('Update request sent — waiting for service to restart...');
      } finally {
        setTimeout(() => {
          githubUpdateBtn.disabled = false;
          githubUpdateBtn.textContent = '🔄 Auto-Update';
        }, 4000);
      }
    });
  }

  if (isChromeExt && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'BG_STATE_UPDATE' && message.event) {
        handleIncomingPacket(message.event);
      }
    });
  }

  capturePad.addEventListener('mousedown', (e) => {
    if (activeScreen !== 'host') return;
    e.preventDefault();
    sendPacket({ type: 'mousedown', clientId: myClientId, button: e.button });
  });

  capturePad.addEventListener('mouseup', (e) => {
    if (activeScreen !== 'host') return;
    e.preventDefault();
    sendPacket({ type: 'mouseup', clientId: myClientId, button: e.button });
  });

  capturePad.addEventListener('contextmenu', (e) => {
    if (activeScreen === 'host') e.preventDefault();
  });

  capturePad.addEventListener('wheel', (e) => {
    if (activeScreen !== 'host') return;
    e.preventDefault();
    sendPacket({
      type: 'wheel',
      clientId: myClientId,
      dx: Math.round(e.deltaX),
      dy: Math.round(e.deltaY)
    });
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (activeScreen !== 'host') return;

    if (e.code === 'Escape' || (e.ctrlKey && e.altKey && e.code === 'KeyQ')) {
      sendPacket({ type: 'leave_host', clientId: myClientId });
      transitionToClientScreen(0.5, 0.5, 'Hotkey Return');
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    lastKeyVal.textContent = e.code;
    sendPacket({
      type: 'keydown',
      clientId: myClientId,
      code: e.code,
      key: e.key,
      keyCode: e.keyCode
    });
  }, true);

  window.addEventListener('keyup', (e) => {
    if (activeScreen !== 'host') return;
    if (e.code === 'Escape') return;

    e.preventDefault();
    e.stopPropagation();
    sendPacket({
      type: 'keyup',
      clientId: myClientId,
      code: e.code,
      key: e.key,
      keyCode: e.keyCode
    });
  }, true);

  document.querySelectorAll('.key-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const vk = btn.dataset.vk ? parseInt(btn.dataset.vk, 10) : null;
      const combo = btn.dataset.combo;

      if (vk) {
        sendPacket({ type: 'keydown', clientId: myClientId, keyCode: vk });
        setTimeout(() => sendPacket({ type: 'keyup', clientId: myClientId, keyCode: vk }), 40);
        logEvent(`Sent VK ${vk} to Receiver`);
      } else if (combo === 'alt-tab') {
        sendPacket({ type: 'keydown', clientId: myClientId, code: 'AltLeft', keyCode: 0xA4 });
        sendPacket({ type: 'keydown', clientId: myClientId, code: 'Tab', keyCode: 0x09 });
        setTimeout(() => {
          sendPacket({ type: 'keyup', clientId: myClientId, code: 'Tab', keyCode: 0x09 });
          sendPacket({ type: 'keyup', clientId: myClientId, code: 'AltLeft', keyCode: 0xA4 });
        }, 60);
        logEvent('Sent Alt + Tab to Receiver');
      } else if (combo === 'ctrl-c') {
        sendPacket({ type: 'keydown', clientId: myClientId, code: 'ControlLeft', keyCode: 0xA2 });
        sendPacket({ type: 'keydown', clientId: myClientId, code: 'KeyC', keyCode: 0x43 });
        setTimeout(() => {
          sendPacket({ type: 'keyup', clientId: myClientId, code: 'KeyC', keyCode: 0x43 });
          sendPacket({ type: 'keyup', clientId: myClientId, code: 'ControlLeft', keyCode: 0xA2 });
        }, 50);
        logEvent('Sent Ctrl + C to Receiver');
      } else if (combo === 'ctrl-v') {
        sendPacket({ type: 'keydown', clientId: myClientId, code: 'ControlLeft', keyCode: 0xA2 });
        sendPacket({ type: 'keydown', clientId: myClientId, code: 'KeyV', keyCode: 0x56 });
        setTimeout(() => {
          sendPacket({ type: 'keyup', clientId: myClientId, code: 'KeyV', keyCode: 0x56 });
          sendPacket({ type: 'keyup', clientId: myClientId, code: 'ControlLeft', keyCode: 0xA2 });
        }, 50);
        logEvent('Sent Ctrl + V to Receiver');
      }
    });
  });

  fetchOrGenerateHostLink(false);
});
