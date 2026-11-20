// Persistent Background Service Worker for Mouse Without Borders
// Supports BOTH Local LAN WebSockets (ws://) AND Global Internet Cloud Relay (mwb://<roomId>)

importScripts('mqtt.min.js');

const CLOUD_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';

let bgWs = null;
let bgMqtt = null;
let bgState = {
  connected: false,
  transport: 'none', // 'lan' | 'cloud'
  targetUrl: '',
  roomId: '',
  hostInfo: null,
  latencyMs: null,
  activeScreen: 'client',
  peerStatus: 'No device connected yet',
  lastError: ''
};
let reconnectTimer = null;
let pingInterval = null;
const clientId = 'mwb_user_' + Math.random().toString(36).substring(2, 8);

/**
 * Extracts either a Cloud Relay Room ID (from mwb://mwb-xxxx, wss://mwb-xxxx.loca.lt, or mwb-xxxx)
 * or a direct WebSocket URL (ws://192.168.1.x:8765).
 */
function parseConnectionTarget(connectionType, hostIp, hostPort, internetUrl) {
  if (connectionType === 'internet') {
    let raw = (internetUrl || '').trim();
    if (!raw) return null;

    // Extract roomId if user pasted mwb://mwb-xxxx, wss://mwb-xxxx.loca.lt, or bare mwb-xxxx
    let roomId = raw
      .replace(/^mwb:\/\//i, '')
      .replace(/^wss?:\/\//i, '')
      .replace(/^https?:\/\//i, '')
      .replace(/\.loca\.lt.*$/i, '')
      .replace(/\/+$/, '')
      .trim();

    // If it's a custom non-loca.lt domain with a dot (e.g. my-tunnel.ngrok.app), use direct WebSocket
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

function broadcastStateToViews(extraEvent = null) {
  chrome.runtime.sendMessage({
    type: 'BG_STATE_UPDATE',
    state: bgState,
    event: extraEvent
  }).catch(() => {});
}

function cleanupTransports() {
  clearInterval(pingInterval);
  if (bgWs) {
    try {
      bgWs.onclose = null;
      bgWs.close();
    } catch {}
    bgWs = null;
  }
  if (bgMqtt) {
    try {
      bgMqtt.end(true);
    } catch {}
    bgMqtt = null;
  }
}

function handleIncomingHostMessage(msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'host_info') {
    bgState.hostInfo = msg;
    const updates = {};
    if (msg.publicWsUrl) updates.generatedHostLink = msg.publicWsUrl;
    if (msg.lanWsUrl) updates.generatedLanLink = msg.lanWsUrl;
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
    broadcastStateToViews(msg);
  } else if (msg.type === 'auth_ok') {
    bgState.connected = true;
    bgState.peerStatus = `Connected to Host "${msg.hostname}"`;
    broadcastStateToViews(msg);
  } else if (msg.type === 'peer_connection_event') {
    if (msg.status === 'connecting') {
      bgState.peerStatus = `⏳ Incoming connection attempt from ${msg.peerName}...`;
    } else if (msg.status === 'connected') {
      bgState.peerStatus = `🟢 ${msg.peerName} connected (${msg.transport})`;
    } else if (msg.status === 'rejected') {
      bgState.peerStatus = `🔴 Connection rejected for ${msg.peerName} (${msg.reason})`;
    } else if (msg.status === 'disconnected') {
      bgState.peerStatus = `⚪ ${msg.peerName} disconnected`;
    }
    broadcastStateToViews(msg);
  } else if (msg.type === 'pong') {
    bgState.latencyMs = Math.max(1, Date.now() - msg.ts);
    if (msg.hostname && !bgState.hostInfo) {
      bgState.hostInfo = {
        hostname: msg.hostname,
        screenWidth: msg.screenWidth,
        screenHeight: msg.screenHeight
      };
    }
    broadcastStateToViews();
  } else if (msg.type === 'return_to_client') {
    bgState.activeScreen = 'client';
    broadcastStateToViews(msg);
  } else if (msg.type === 'screen_switched') {
    bgState.activeScreen = msg.activeScreen;
    broadcastStateToViews(msg);
  } else {
    broadcastStateToViews(msg);
  }
}

async function ensurePersistentConnection(forceReconnect = false) {
  const stored = await chrome.storage.local.get([
    'deviceRole',
    'connectionType',
    'hostPosition',
    'hostIp',
    'hostPort',
    'internetUrl',
    'generatedHostLink',
    'pin'
  ]);

  let target = parseConnectionTarget(
    stored.connectionType || 'internet',
    stored.hostIp || '127.0.0.1',
    stored.hostPort || '8765',
    stored.internetUrl || stored.generatedHostLink || ''
  );

  // If this PC is in Host mode, connect to the local Host daemon AND/OR cloud room
  if (stored.deviceRole === 'host' && (!target || !stored.internetUrl)) {
    const roomLink = stored.generatedHostLink || '';
    if (roomLink) {
      target = parseConnectionTarget('internet', '127.0.0.1', '8765', roomLink);
    } else {
      target = { mode: 'ws', wsUrl: 'ws://127.0.0.1:8765', label: 'ws://127.0.0.1:8765' };
    }
  }

  if (!target) return;

  if (
    !forceReconnect &&
    bgState.connected &&
    bgState.targetUrl === target.label
  ) {
    return;
  }

  cleanupTransports();
  bgState.targetUrl = target.label;
  bgState.connected = false;
  broadcastStateToViews();

  if (target.mode === 'cloud' && typeof mqtt !== 'undefined') {
    bgState.transport = 'cloud';
    bgState.roomId = target.roomId;
    const toHostTopic = `mwb/v1/${target.roomId}/to_host`;
    const toClientTopic = `mwb/v1/${target.roomId}/to_client`;

    bgMqtt = mqtt.connect(CLOUD_BROKER_URL, {
      reconnectPeriod: 2000,
      connectTimeout: 8000
    });

    bgMqtt.on('connect', () => {
      bgState.connected = true;
      bgState.lastError = '';
      bgMqtt.subscribe(toClientTopic, { qos: 0 });
      // If browser itself is in Host Mode (e.g., before or alongside local server), also listen to toHostTopic so Host UI always sees incoming User connection attempts!
      bgMqtt.subscribe(toHostTopic, { qos: 0 });

      // Announce connection attempt to Host
      sendToHost({
        type: 'hello',
        clientId,
        deviceName: stored.deviceRole === 'host' ? 'Host Dashboard' : 'User Device (Chrome)',
        transport: 'Internet Cloud Link',
        pin: stored.pin || ''
      });

      if (stored.hostPosition) {
        sendToHost({ type: 'set_layout', hostPosition: stored.hostPosition });
      }
      broadcastStateToViews();

      clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        sendToHost({ type: 'ping', clientId, ts: Date.now() });
      }, 3000);
    });

    bgMqtt.on('message', (topic, payloadBuf) => {
      try {
        const msg = JSON.parse(payloadBuf.toString());
        if (topic === toClientTopic) {
          handleIncomingHostMessage(msg);
        } else if (topic === toHostTopic && msg.clientId !== clientId) {
          // Even if the user only opened Host Mode in Chrome, show when the 2nd device tries to connect or moves its mouse!
          if (msg.type === 'hello' || msg.type === 'auth') {
            bgState.peerStatus = `🟢 ${msg.deviceName || '2nd Device'} connected via Internet Link!`;
            broadcastStateToViews({
              type: 'peer_connection_event',
              status: 'connected',
              peerName: msg.deviceName || '2nd Device (User Mode)',
              transport: 'Internet Cloud Link'
            });
          } else if (msg.type === 'enter_host' || msg.type === 'mousemove' || msg.type === 'keydown') {
            broadcastStateToViews(msg);
          }
        }
      } catch {}
    });

    bgMqtt.on('close', () => {
      bgState.connected = false;
      broadcastStateToViews({ type: 'ws_closed' });
    });

    return;
  }

  // Direct LAN WebSocket mode
  bgState.transport = 'lan';
  try {
    bgWs = new WebSocket(target.wsUrl);
  } catch (err) {
    bgState.lastError = err.message;
    broadcastStateToViews();
    return;
  }

  bgWs.onopen = () => {
    bgState.connected = true;
    bgState.lastError = '';
    sendToHost({
      type: 'hello',
      clientId,
      deviceName: stored.deviceRole === 'host' ? 'Host Dashboard' : 'User Device (LAN)',
      transport: 'LAN WebSocket',
      pin: stored.pin || ''
    });
    if (stored.hostPosition) {
      sendToHost({ type: 'set_layout', hostPosition: stored.hostPosition });
    }
    broadcastStateToViews();

    clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      sendToHost({ type: 'ping', clientId, ts: Date.now() });
    }, 3000);
  };

  bgWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleIncomingHostMessage(msg);
    } catch {}
  };

  bgWs.onclose = () => {
    bgState.connected = false;
    clearInterval(pingInterval);
    broadcastStateToViews({ type: 'ws_closed' });

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      ensurePersistentConnection(false);
    }, 2500);
  };

  bgWs.onerror = () => {
    bgState.connected = false;
  };
}

function sendToHost(payload) {
  if (bgState.transport === 'cloud' && bgMqtt && bgMqtt.connected && bgState.roomId) {
    bgMqtt.publish(`mwb/v1/${bgState.roomId}/to_host`, JSON.stringify(payload));
    return true;
  }
  if (bgWs && bgWs.readyState === WebSocket.OPEN) {
    bgWs.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

// Keep service worker alive with Chrome Alarms
chrome.alarms.create('mwb_keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'mwb_keepalive') {
    if (!bgState.connected) {
      ensurePersistentConnection(false);
    } else {
      sendToHost({ type: 'ping', clientId, ts: Date.now() });
    }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['connectionType', 'generatedHostLink'], (res) => {
    const defaults = {};
    if (!res.connectionType) {
      defaults.deviceRole = 'client';
      defaults.connectionType = 'internet';
      defaults.hostPosition = 'right';
      defaults.hostIp = '127.0.0.1';
      defaults.hostPort = '8765';
      defaults.internetUrl = '';
      defaults.sensitivity = 1.4;
      defaults.pin = '';
    }
    if (!res.generatedHostLink || res.generatedHostLink.includes('.loca.lt')) {
      const fixedId = Math.random().toString(36).substring(2, 10).toLowerCase();
      defaults.generatedHostLink = `mwb://mwb-${fixedId}`;
      defaults.generatedLanLink = 'ws://127.0.0.1:8765';
    }
    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults);
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_CONTROLLER') {
    const controllerUrl = chrome.runtime.getURL('controller.html');
    chrome.tabs.query({ url: controllerUrl }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: controllerUrl });
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'BG_GET_STATE') {
    ensurePersistentConnection(false);
    sendResponse({ state: bgState });
    return true;
  }

  if (message.action === 'BG_CONNECT') {
    ensurePersistentConnection(true);
    sendResponse({ ok: true, state: bgState });
    return true;
  }

  if (message.action === 'BG_SEND_PACKET') {
    const sent = sendToHost(message.payload);
    sendResponse({ ok: sent });
    return true;
  }
});

ensurePersistentConnection(false);
