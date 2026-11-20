const { WebSocketServer, WebSocket } = require('ws');
const { spawn } = require('child_process');
const os = require('os');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mqtt = require('mqtt');

const PORT = Number(process.env.PORT || 8765);
const CLOUD_BROKER_URL = process.env.MWB_BROKER_URL || 'wss://broker.emqx.io:8084/mqtt';

const CONFIG_PATH = path.join(__dirname, 'host-config.json');
const EXTENSION_DIR = path.join(__dirname, '..', 'chrome-extension');

function getOrCreateHostConfig(forceNew = false) {
  let existing = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}

  if (!forceNew && existing.roomId && existing.publicWsUrl && existing.pairingPin) {
    return existing;
  }

  const randomId = crypto.randomBytes(6).toString('hex');
  const roomId = `mwb-${randomId}`;
  const pairingPin = process.env.PIN || existing.pairingPin || String(Math.floor(100000 + Math.random() * 900000));
  const cfg = {
    roomId,
    publicWsUrl: `mwb://${roomId}`,
    pairingPin,
    deviceRole: existing.deviceRole || 'receiver', // 'controller' | 'receiver'
    hostPosition: existing.hostPosition || 'right',
    clipboardSync: existing.clipboardSync !== false,
    createdAt: new Date().toISOString()
  };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {}
  return cfg;
}

function saveHostConfig(updates) {
  hostConfig = { ...hostConfig, ...updates };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(hostConfig, null, 2), 'utf8');
  } catch {}
}

let hostConfig = getOrCreateHostConfig(false);
let publicWsUrl = hostConfig.publicWsUrl;
let PAIR_PIN = process.env.PIN || hostConfig.pairingPin || '';

// Derive AES-256-GCM key from normalized roomId + pairingPin for authenticated E2EE over public internet relay
function normalizeRoomId(roomId) {
  return String(roomId || '')
    .trim()
    .toLowerCase()
    .replace(/^mwb:\/\//, '')
    .replace(/\/+$/, '');
}

function normalizePin(pin) {
  return String(pin || '').trim();
}

// Cache derived PBKDF2 AES-256-GCM keys in memory so we NEVER run 10,000 PBKDF2 iterations on high-frequency mouse packets!
const derivedKeyCache = new Map();

function deriveSessionKey(roomId, pin) {
  const normRoom = normalizeRoomId(roomId);
  const normPin = normalizePin(pin) || '000000';
  const cacheKey = `${normRoom}:${normPin}`;
  let cached = derivedKeyCache.get(cacheKey);
  if (!cached) {
    cached = crypto.pbkdf2Sync(normPin, `mwb-v2-salt:${normRoom}`, 10000, 32, 'sha256');
    derivedKeyCache.set(cacheKey, cached);
  }
  return cached;
}

function encryptEnvelope(payloadObj, roomId, pin) {
  const key = deriveSessionKey(roomId, pin);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    _mwb_enc: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: encrypted.toString('base64')
  });
}

function decryptEnvelope(rawBufferOrStr, roomId, pin) {
  const str = rawBufferOrStr.toString();
  const parsed = JSON.parse(str);
  if (!parsed || !parsed._mwb_enc) {
    return parsed;
  }
  const key = deriveSessionKey(roomId, pin);
  const iv = Buffer.from(parsed.iv, 'base64');
  const tag = Buffer.from(parsed.tag, 'base64');
  const ct = Buffer.from(parsed.ct, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

let cloudClient = null;
let cloudReady = false;
const cloudPeers = new Map();
const pendingApprovals = new Map(); // clientId -> { clientId, peerName, transport, replyFn, authContext, ts }
let lastConnectionEvent = { status: 'idle', peerName: '', reason: '', ts: 0 };
const diagnosticLogs = [];

function pushDiagLog(category, text) {
  const ts = new Date().toTimeString().split(' ')[0];
  const line = `[${ts}] [${category}] ${text}`;
  console.log(line);
  diagnosticLogs.push(line);
  if (diagnosticLogs.length > 50) {
    diagnosticLogs.shift();
  }
}

// Native Controller Outbound Transport State (when this desktop app acts as Controller)
let controllerTransport = 'none'; // 'cloud' | 'lan' | 'none'
let controllerRoomId = '';
let controllerPin = '';
let controllerLanUrl = '';
let controllerWs = null;
let controllerMqtt = null;
let controllerConnected = false;
let controllerStatus = 'idle'; // 'idle' | 'connecting' | 'waiting_approval' | 'connected' | 'rejected'
let controllerStatusDetail = 'Ready to pair';
let controllerPeerHostname = '';
let controllerPeerScreen = { width: 1920, height: 1080 };
let controllerLatencyMs = null;
let controllerSensitivity = 1.4;
let controllerCaptureArmed = false;
let controllerPingInterval = null;
let controllerHelloRetryInterval = null;
const myControllerId = 'mwb_native_' + crypto.randomBytes(3).toString('hex');

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

/**
 * Native Windows Input Capture & Injection Driver
 * - Runs compiled MwbInputDriver.exe directly (or falls back to PowerShell compilation if .exe is missing).
 * - Provides global OS-level low-level mouse/keyboard hooks (WH_MOUSE_LL / WH_KEYBOARD_LL) for Controller mode.
 * - Provides DPI-aware SetCursorPos, mouse_event, keybd_event, visible cursor overlay, and fail-safe stuck-key release for Receiver mode.
 * - Provides bidirectional OS clipboard synchronization.
 */
class WindowsMwbDriver {
  constructor(callbacks) {
    this.proc = null;
    this.ready = false;
    this.hooksOk = false;
    this.callbacks = callbacks || {};

    this.screenWidth = 1920;
    this.screenHeight = 1080;
    this.cursorX = 960;
    this.cursorY = 540;

    this.activeScreen = 'client'; // 'client' (local) | 'host' (remote)
    this.hostPosition = hostConfig.hostPosition || 'right';
    this.osCaptureEnabled = false;

    this.accDx = 0;
    this.accDy = 0;
    this.moveTimer = null;

    this.init();
  }

  ReturnEdgeForHostPosition() {
    switch (this.hostPosition) {
      case 'right': return 'left';
      case 'left': return 'right';
      case 'bottom': return 'top';
      case 'top': return 'bottom';
      default: return 'left';
    }
  }

  init() {
    if (os.platform() !== 'win32') {
      this.ready = true;
      return;
    }

    // Always run MwbInputDriver.cs in-memory inside Microsoft's signed powershell.exe host
    // so Windows 11 Smart App Control (SAC) never blocks an unsigned .exe binary on disk.
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    const csPath = path.join(__dirname, 'MwbInputDriver.cs').replace(/\\/g, '\\\\');
    const bootstrapPs = `
$csCode = [System.IO.File]::ReadAllText("${csPath}")
Add-Type -TypeDefinition $csCode -ReferencedAssemblies System.Windows.Forms, System.Drawing -Language CSharp
[Program]::Main()
`;
    this.proc.stdin.write(bootstrapPs + '\n');

    let stdoutRemainder = '';
    this.proc.stdout.on('data', (data) => {
      stdoutRemainder += data.toString();
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop();
      for (const line of lines) {
        this.handleDriverOutput(line.trim());
      }
    });

    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', () => {
      this.ready = false;
      this.hooksOk = false;
      setTimeout(() => this.init(), 1000);
    });
  }

  handleDriverOutput(msg) {
    if (!msg) return;

    if (msg.startsWith('SCREEN_INFO:')) {
      const parts = msg.split(':');
      this.screenWidth = parseInt(parts[1], 10) || 1920;
      this.screenHeight = parseInt(parts[2], 10) || 1080;
      this.cursorX = parseInt(parts[3], 10) || Math.round(this.screenWidth / 2);
      this.cursorY = parseInt(parts[4], 10) || Math.round(this.screenHeight / 2);
      console.log(`[Screen] Native DPI-Aware Display: ${this.screenWidth}x${this.screenHeight}`);
    } else if (msg.startsWith('HOOK_STATUS:')) {
      this.hooksOk = msg.endsWith(':OK');
      console.log(`[Driver] Global OS Input Hooks: ${this.hooksOk ? 'INSTALLED (WH_MOUSE_LL + WH_KEYBOARD_LL)' : 'UNAVAILABLE'}`);
    } else if (msg.includes('DRIVER_READY')) {
      this.ready = true;
      if (this.osCaptureEnabled) {
        this.setOsCapture(true, this.hostPosition);
      }
      console.log('[Driver] Native Desktop Input & Cursor Overlay Service Ready.');
      if (this.callbacks.onStatusChanged) this.callbacks.onStatusChanged();
    } else if (msg.startsWith('CAPTURE_STATE:')) {
      const parts = msg.split(':');
      this.osCaptureEnabled = parts[1] === 'ENABLED';
      if (this.callbacks.onStatusChanged) this.callbacks.onStatusChanged();
    } else if (msg.startsWith('HOOK_EDGE:')) {
      // Physical cursor on Controller reached the configured OS monitor edge!
      const parts = msg.split(':');
      const edge = parts[1];
      const normX = parseFloat(parts[2]) || 0.5;
      const normY = parseFloat(parts[3]) || 0.5;
      this.activeScreen = 'host';
      if (this.callbacks.onControllerEdgeEnter) {
        this.callbacks.onControllerEdgeEnter({ edge, normX, normY });
      }
    } else if (msg.startsWith('HOOK_RETURN:')) {
      const reason = msg.substring('HOOK_RETURN:'.length);
      this.activeScreen = 'client';
      if (this.callbacks.onControllerLocalReturn) {
        this.callbacks.onControllerLocalReturn(reason);
      }
    } else if (msg.startsWith('HOOK_MOVE:')) {
      const parts = msg.split(':');
      const dx = (parseInt(parts[1], 10) || 0) * controllerSensitivity;
      const dy = (parseInt(parts[2], 10) || 0) * controllerSensitivity;
      this.accDx += dx;
      this.accDy += dy;
      if (!this.moveTimer) {
        this.moveTimer = setTimeout(() => {
          this.moveTimer = null;
          const sendX = Math.round(this.accDx);
          const sendY = Math.round(this.accDy);
          this.accDx -= sendX;
          this.accDy -= sendY;
          if ((sendX !== 0 || sendY !== 0) && this.callbacks.onControllerInput) {
            this.callbacks.onControllerInput({ t: 'm', x: sendX, y: sendY });
          }
        }, 12);
      }
    } else if (msg.startsWith('HOOK_BTN:')) {
      const parts = msg.split(':');
      const button = parseInt(parts[1], 10) || 0;
      const isDown = parts[2] === '1';
      if (this.callbacks.onControllerInput) {
        this.callbacks.onControllerInput({
          type: isDown ? 'mousedown' : 'mouseup',
          clientId: myControllerId,
          button
        });
      }
    } else if (msg.startsWith('HOOK_WHEEL:')) {
      const parts = msg.split(':');
      const dx = parseInt(parts[1], 10) || 0;
      const dy = parseInt(parts[2], 10) || 0;
      if (this.callbacks.onControllerInput) {
        this.callbacks.onControllerInput({
          type: 'wheel',
          clientId: myControllerId,
          dx,
          dy
        });
      }
    } else if (msg.startsWith('HOOK_KEY:')) {
      const parts = msg.split(':');
      const vk = parseInt(parts[1], 10) || 0;
      const isDown = parts[2] === '1';
      if (this.callbacks.onControllerInput) {
        this.callbacks.onControllerInput({
          type: isDown ? 'keydown' : 'keyup',
          clientId: myControllerId,
          keyCode: vk,
          code: `VK_${vk}`
        });
      }
    } else if (msg.startsWith('CLIPBOARD_CHANGED:')) {
      const b64 = msg.substring('CLIPBOARD_CHANGED:'.length).trim();
      if (hostConfig.clipboardSync && this.callbacks.onLocalClipboardChanged) {
        this.callbacks.onLocalClipboardChanged(b64);
      }
    }
  }

  sendRaw(line) {
    if (this.proc && this.ready && this.proc.stdin.writable) {
      this.proc.stdin.write(line + '\n');
    }
  }

  setOsCapture(enabled, edge) {
    this.osCaptureEnabled = Boolean(enabled);
    if (edge && ['left', 'right', 'top', 'bottom'].includes(edge)) {
      this.hostPosition = edge;
    }
    this.sendRaw(`C ${this.osCaptureEnabled ? 1 : 0} ${this.hostPosition}`);
  }

  forceControllerEnterRemote(edge) {
    this.activeScreen = 'host';
    this.sendRaw(`E ${edge || this.hostPosition}`);
  }

  releaseControllerCapture(normX = 0.5, normY = 0.5) {
    this.activeScreen = 'client';
    this.sendRaw(`U ${Number(normX).toFixed(4)} ${Number(normY).toFixed(4)}`);
  }

  failSafeReset() {
    this.activeScreen = 'client';
    this.sendRaw('R');
  }

  setRemoteClipboard(b64) {
    if (!b64 || !hostConfig.clipboardSync) return;
    this.sendRaw(`S ${b64}`);
  }

  enterHostScreen(normX, normY) {
    this.activeScreen = 'host';
    const margin = 10;

    if (this.hostPosition === 'right') {
      this.cursorX = margin;
      this.cursorY = Math.round(normY * this.screenHeight);
    } else if (this.hostPosition === 'left') {
      this.cursorX = this.screenWidth - margin;
      this.cursorY = Math.round(normY * this.screenHeight);
    } else if (this.hostPosition === 'bottom') {
      this.cursorX = Math.round(normX * this.screenWidth);
      this.cursorY = margin;
    } else if (this.hostPosition === 'top') {
      this.cursorX = Math.round(normX * this.screenWidth);
      this.cursorY = this.screenHeight - margin;
    }

    this.cursorX = Math.max(2, Math.min(this.screenWidth - 2, this.cursorX));
    this.cursorY = Math.max(2, Math.min(this.screenHeight - 2, this.cursorY));
    this.sendRaw(`M ${this.cursorX} ${this.cursorY}`);
  }

  leaveHostScreen() {
    this.activeScreen = 'client';
    this.sendRaw('R');
  }

  moveRelative(dx, dy) {
    if (this.activeScreen !== 'host') {
      this.activeScreen = 'host';
    }

    const x = Math.round(dx);
    const y = Math.round(dy);
    if (x === 0 && y === 0) return null;

    this.cursorX += x;
    this.cursorY += y;

    const returnEdge = this.ReturnEdgeForHostPosition();

    if (returnEdge === 'left' && this.cursorX <= 0) {
      this.cursorX = 0;
      return this.triggerReturnToClient('left');
    }
    if (returnEdge === 'right' && this.cursorX >= this.screenWidth - 1) {
      this.cursorX = this.screenWidth - 1;
      return this.triggerReturnToClient('right');
    }
    if (returnEdge === 'top' && this.cursorY <= 0) {
      this.cursorY = 0;
      return this.triggerReturnToClient('top');
    }
    if (returnEdge === 'bottom' && this.cursorY >= this.screenHeight - 1) {
      this.cursorY = this.screenHeight - 1;
      return this.triggerReturnToClient('bottom');
    }

    this.cursorX = Math.max(0, Math.min(this.screenWidth - 1, this.cursorX));
    this.cursorY = Math.max(0, Math.min(this.screenHeight - 1, this.cursorY));

    this.sendRaw(`M ${this.cursorX} ${this.cursorY}`);

    return {
      x: this.cursorX,
      y: this.cursorY,
      normX: this.cursorX / this.screenWidth,
      normY: this.cursorY / this.screenHeight
    };
  }

  triggerReturnToClient(crossedHostEdge) {
    this.activeScreen = 'client';
    this.sendRaw('R');
    const normX = Math.max(0, Math.min(1, this.cursorX / this.screenWidth));
    const normY = Math.max(0, Math.min(1, this.cursorY / this.screenHeight));

    if (this.callbacks.onReceiverEdgeCrossed) {
      this.callbacks.onReceiverEdgeCrossed({
        crossedHostEdge,
        normX,
        normY
      });
    }
    return null;
  }

  mouseButton(button, isDown) {
    let flag = 0;
    if (button === 0) flag = isDown ? 0x0002 : 0x0004;
    else if (button === 1) flag = isDown ? 0x0020 : 0x0040;
    else if (button === 2) flag = isDown ? 0x0008 : 0x0010;
    if (flag !== 0) {
      this.sendRaw(`B ${flag} ${button} ${isDown ? 1 : 0}`);
    }
  }

  scroll(deltaX, deltaY) {
    if (deltaY !== 0) {
      const amount = Math.round(-deltaY);
      this.sendRaw(`W 2048 ${amount}`);
    }
    if (deltaX !== 0) {
      const amount = Math.round(deltaX);
      this.sendRaw(`W 4096 ${amount}`);
    }
  }

  keyEvent(vkCode, isDown) {
    if (!vkCode || vkCode < 0 || vkCode > 255) return;
    const flags = isDown ? 0 : 2;
    this.sendRaw(`K ${vkCode} ${flags}`);
  }
}

const CODE_TO_VK = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0D, NumpadEnter: 0x0D,
  ShiftLeft: 0xA0, ShiftRight: 0xA1, ControlLeft: 0xA2, ControlRight: 0xA3,
  AltLeft: 0xA4, AltRight: 0xA5, Pause: 0x13, CapsLock: 0x14, Escape: 0x1B,
  Space: 0x20, PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24,
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  PrintScreen: 0x2C, Insert: 0x2D, Delete: 0x2E,
  Digit0: 0x30, Digit1: 0x31, Digit2: 0x32, Digit3: 0x33, Digit4: 0x34,
  Digit5: 0x35, Digit6: 0x36, Digit7: 0x37, Digit8: 0x38, Digit9: 0x39,
  KeyA: 0x41, KeyB: 0x42, KeyC: 0x43, KeyD: 0x44, KeyE: 0x45, KeyF: 0x46,
  KeyG: 0x47, KeyH: 0x48, KeyI: 0x49, KeyJ: 0x4A, KeyK: 0x4B, KeyL: 0x4C,
  KeyM: 0x4D, KeyN: 0x4E, KeyO: 0x4F, KeyP: 0x50, KeyQ: 0x51, KeyR: 0x52,
  KeyS: 0x53, KeyT: 0x54, KeyU: 0x55, KeyV: 0x56, KeyW: 0x57, KeyX: 0x58,
  KeyY: 0x59, KeyZ: 0x5A,
  MetaLeft: 0x5B, MetaRight: 0x5C, ContextMenu: 0x5D,
  Numpad0: 0x60, Numpad1: 0x61, Numpad2: 0x62, Numpad3: 0x63, Numpad4: 0x64,
  Numpad5: 0x65, Numpad6: 0x66, Numpad7: 0x67, Numpad8: 0x68, Numpad9: 0x69,
  NumpadMultiply: 0x6A, NumpadAdd: 0x6B, NumpadSubtract: 0x6D, NumpadDecimal: 0x6E, NumpadDivide: 0x6F,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75,
  F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7A, F12: 0x7B,
  NumLock: 0x90, ScrollLock: 0x91,
  Semicolon: 0xBA, Equal: 0xBB, Comma: 0xBC, Minus: 0xBD, Period: 0xBE,
  Slash: 0xBF, Backquote: 0xC0, BracketLeft: 0xDB, Backslash: 0xDC,
  BracketRight: 0xDD, Quote: 0xDE
};

const clients = new Set();

function broadcastToLocalViews(obj) {
  const payload = JSON.stringify(obj);
  for (const client of clients) {
    if (client.readyState === 1 && client.isLocalDashboard) {
      client.send(payload);
    }
  }
}

function broadcastToClients(obj, skipCloud = false) {
  const payload = JSON.stringify(obj);
  for (const client of clients) {
    if (client.readyState === 1 && (client.authenticated || client.isLocalDashboard)) {
      client.send(payload);
    }
  }
  if (!skipCloud && cloudClient && cloudReady) {
    try {
      const enc = encryptEnvelope(obj, hostConfig.roomId, PAIR_PIN);
      cloudClient.publish(`mwb/v1/${hostConfig.roomId}/to_client`, enc);
    } catch {}
  }
}

function sendFromNativeController(payloadObj, allowPreAuth = false) {
  if (!controllerConnected && !allowPreAuth) return false;
  // Omit redundant clientId on high-frequency mouse delta packets ('m') to keep encrypted packet minimal
  if (payloadObj && typeof payloadObj === 'object' && !payloadObj.clientId && payloadObj.t !== 'm') {
    payloadObj.clientId = myControllerId;
  }
  if (controllerTransport === 'cloud' && controllerMqtt && controllerMqtt.connected && controllerRoomId) {
    try {
      const enc = encryptEnvelope(payloadObj, controllerRoomId, controllerPin);
      controllerMqtt.publish(`mwb/v1/${controllerRoomId}/to_host`, enc);
      if (payloadObj.type === 'hello') {
        controllerMqtt.publish(`mwb/v1/${controllerRoomId}/to_host`, JSON.stringify({
          type: 'connection_attempt_announce',
          clientId: payloadObj.clientId,
          deviceName: payloadObj.deviceName,
          transport: payloadObj.transport
        }));
      }
      return true;
    } catch {
      return false;
    }
  }
  if (controllerTransport === 'lan' && controllerWs && controllerWs.readyState === WebSocket.OPEN) {
    controllerWs.send(JSON.stringify(payloadObj));
    return true;
  }
  return false;
}

const driver = new WindowsMwbDriver({
  onReceiverEdgeCrossed: (edgeInfo) => {
    console.log(`[MWB] Cursor crossed Receiver ${edgeInfo.crossedHostEdge.toUpperCase()} border -> Returning control to Controller!`);
    broadcastToClients({
      type: 'return_to_client',
      crossedHostEdge: edgeInfo.crossedHostEdge,
      normX: edgeInfo.normX,
      normY: edgeInfo.normY,
      activeScreen: 'client'
    });
  },
  onControllerEdgeEnter: ({ edge, normX, normY }) => {
    console.log(`[MWB Native Controller] Physical cursor crossed local ${edge.toUpperCase()} monitor edge -> Controlling Receiver!`);
    sendFromNativeController({
      type: 'enter_host',
      clientId: myControllerId,
      hostPosition: edge,
      normX,
      normY
    });
    broadcastToLocalViews({
      type: 'native_controller_screen',
      activeScreen: 'host',
      edge,
      normX,
      normY
    });
  },
  onControllerLocalReturn: (reason) => {
    console.log(`[MWB Native Controller] Returned control to local PC (${reason})`);
    sendFromNativeController({
      type: 'leave_host',
      clientId: myControllerId
    });
    broadcastToLocalViews({
      type: 'native_controller_screen',
      activeScreen: 'client',
      reason
    });
  },
  onControllerInput: (pkt) => {
    sendFromNativeController(pkt);
    if (pkt.type === 'keydown') {
      broadcastToLocalViews({ type: 'host_keydown', code: pkt.code });
    }
  },
  onLocalClipboardChanged: (b64) => {
    // Share clipboard with paired peer (either as Controller or as Receiver)
    if (controllerConnected) {
      sendFromNativeController({ type: 'clipboard_sync', clientId: myControllerId, b64 });
    } else if (clients.size > 0 || cloudPeers.size > 0) {
      broadcastToClients({ type: 'clipboard_sync', b64 });
    }
  },
  onStatusChanged: () => {
    broadcastHostStatus();
  }
});

// Connect Native Desktop Controller to a Receiver (via Cloud E2EE Relay or LAN WebSocket)
function connectNativeController(opts = {}) {
  const mode = opts.connectionType || 'internet';
  const pin = opts.pin !== undefined ? String(opts.pin) : controllerPin;
  const hostPosition = opts.hostPosition || driver.hostPosition || 'right';
  controllerSensitivity = parseFloat(opts.sensitivity || controllerSensitivity || 1.4);
  controllerPin = pin;
  driver.hostPosition = hostPosition;
  saveHostConfig({ hostPosition });

  disconnectNativeController(false);

  if (mode === 'internet') {
    let raw = (opts.internetUrl || '').trim();
    const inlinePinMatch = raw.match(/\(PIN:\s*([0-9A-Za-z]+)\)/i);
    if (inlinePinMatch && !controllerPin) {
      controllerPin = inlinePinMatch[1].trim();
    }
    raw = raw.replace(/\(PIN:.*$/i, '').trim().split(/\s+/)[0] || '';
    const roomId = normalizeRoomId(
      raw
        .replace(/^mwb:\/\//i, '')
        .replace(/^wss?:\/\//i, '')
        .replace(/^https?:\/\//i, '')
        .replace(/\.loca\.lt.*$/i, '')
        .replace(/\/+$/, '')
    );
    if (!roomId) return;

    controllerTransport = 'cloud';
    controllerRoomId = roomId;
    controllerStatus = 'connecting';
    controllerStatusDetail = `Connecting to Receiver (${roomId})...`;
    pushDiagLog('CLOUD-CTRL', `Connecting to online relay room "${roomId}" with PIN (${controllerPin ? controllerPin.length + ' digits' : 'empty'})...`);
    const toClientTopic = `mwb/v1/${roomId}/to_client`;

    controllerMqtt = mqtt.connect(CLOUD_BROKER_URL, {
      reconnectPeriod: 2000,
      connectTimeout: 8000,
      wsOptions: { perMessageDeflate: false }
    });

    controllerMqtt.on('connect', () => {
      if (controllerMqtt.stream && controllerMqtt.stream.socket && controllerMqtt.stream.socket._socket && controllerMqtt.stream.socket._socket.setNoDelay) {
        controllerMqtt.stream.socket._socket.setNoDelay(true);
      }
      controllerMqtt.subscribe(toClientTopic, { qos: 0 }, () => {
        pushDiagLog('CLOUD-CTRL', `Subscribed to ${toClientTopic} -> Sending encrypted hello handshake`);
        const sendHello = () => {
          if (controllerStatus === 'connected' || controllerStatus === 'rejected') {
            clearInterval(controllerHelloRetryInterval);
            return;
          }
          sendFromNativeController({
            type: 'hello',
            clientId: myControllerId,
            deviceName: `${os.hostname()}`,
            transport: 'Online Relay (AES-256-GCM)',
            pin: controllerPin
          }, true);
        };
        sendHello();
        clearInterval(controllerHelloRetryInterval);
        controllerHelloRetryInterval = setInterval(sendHello, 3000);
        broadcastHostStatus();
      });
    });

    controllerMqtt.on('message', (topic, payloadBuf) => {
      if (topic !== toClientTopic) return;
      try {
        const msg = decryptEnvelope(payloadBuf, controllerRoomId, controllerPin);
        handleIncomingMessageFromReceiver(msg);
      } catch (err) {
        controllerStatus = 'rejected';
        controllerStatusDetail = 'PIN mismatch — failed to decrypt Receiver reply';
        pushDiagLog('CLOUD-ERR', `Failed to decrypt Receiver reply on room ${controllerRoomId} — verify PIN matches`);
        broadcastToLocalViews({
          type: 'auth_err',
          message: 'Decryption failed — verify your Pairing PIN matches the Receiver.'
        });
        broadcastHostStatus();
      }
    });

    controllerMqtt.on('close', () => {
      handleControllerDisconnect('Internet relay connection lost');
    });
    return;
  }

  // LAN WebSocket Controller connection — strip any ws://, wss://, http://, or (PIN: ...) before parsing IP:Port!
  let cleanTarget = (opts.internetUrl || opts.hostIp || '127.0.0.1')
    .trim()
    .replace(/\(PIN:.*$/i, '')
    .trim()
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .trim();

  const lastColon = cleanTarget.lastIndexOf(':');
  let ip = cleanTarget;
  let port = (opts.hostPort || '8765').trim();
  if (lastColon > 0) {
    ip = cleanTarget.substring(0, lastColon).trim();
    port = cleanTarget.substring(lastColon + 1).trim() || '8765';
  }

  controllerLanUrl = `ws://${ip}:${port}`;
  controllerTransport = 'lan';
  controllerStatus = 'connecting';
  controllerStatusDetail = `Connecting to Direct LAN ${controllerLanUrl}...`;
  pushDiagLog('LAN-CTRL', `Opening Direct LAN WebSocket to ${controllerLanUrl}...`);

  try {
    controllerWs = new WebSocket(controllerLanUrl, {
      perMessageDeflate: false,
      handshakeTimeout: 6000
    });
  } catch (err) {
    controllerStatus = 'rejected';
    controllerStatusDetail = `Invalid LAN address (${controllerLanUrl}): ${err.message}`;
    pushDiagLog('LAN-ERR', controllerStatusDetail);
    broadcastHostStatus();
    return;
  }

  controllerWs.on('open', () => {
    if (controllerWs._socket && controllerWs._socket.setNoDelay) {
      controllerWs._socket.setNoDelay(true);
    }
    pushDiagLog('LAN-CTRL', `TCP/WebSocket connected to ${controllerLanUrl} -> Sending hello handshake`);
    const sendLanHello = () => {
      if (controllerStatus === 'connected' || controllerStatus === 'rejected') {
        clearInterval(controllerHelloRetryInterval);
        return;
      }
      sendFromNativeController({
        type: 'hello',
        clientId: myControllerId,
        deviceName: `${os.hostname()}`,
        transport: 'Direct LAN (Sub-1ms)',
        pin: controllerPin
      }, true);
    };
    sendLanHello();
    clearInterval(controllerHelloRetryInterval);
    controllerHelloRetryInterval = setInterval(sendLanHello, 2500);
    broadcastHostStatus();
  });

  controllerWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleIncomingMessageFromReceiver(msg);
    } catch {}
  });

  controllerWs.on('close', () => {
    if (controllerStatus !== 'rejected') {
      pushDiagLog('LAN-CTRL', `LAN WebSocket closed (${controllerLanUrl})`);
      handleControllerDisconnect(`LAN WebSocket closed (${controllerLanUrl})`);
    }
  });

  controllerWs.on('error', (err) => {
    const code = err.code || err.message || 'UNKNOWN';
    controllerStatus = 'rejected';
    if (code === 'ECONNREFUSED') {
      controllerStatusDetail = `LAN Connection Refused (${ip}:${port}) — Ensure OneDesk is running on Receiver PC`;
    } else if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') {
      controllerStatusDetail = `LAN Timeout (${ip}:${port}) — Blocked by Receiver Windows Firewall or different subnet/AP isolation`;
    } else {
      controllerStatusDetail = `LAN Error (${ip}:${port}): ${err.message}`;
    }
    pushDiagLog('LAN-ERR', controllerStatusDetail);
    broadcastHostStatus();
  });
}

function getInverseEdge(edge) {
  switch (edge) {
    case 'right': return 'left';
    case 'left': return 'right';
    case 'top': return 'bottom';
    case 'bottom': return 'top';
    default: return 'left';
  }
}

function handleIncomingMessageFromReceiver(msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'set_layout') {
    if (['right', 'left', 'top', 'bottom'].includes(msg.hostPosition)) {
      driver.hostPosition = msg.hostPosition;
      saveHostConfig({ hostPosition: msg.hostPosition });
      if (controllerCaptureArmed && controllerConnected) {
        driver.setOsCapture(true, msg.hostPosition);
      }
      broadcastToLocalViews(msg);
      broadcastHostStatus();
    }
    return;
  }

  if (msg.type === 'auth_pending') {
    controllerStatus = 'waiting_approval';
    controllerStatusDetail = `Waiting for "${msg.hostname || 'Receiver'}" to click Accept...`;
    pushDiagLog('CTRL', `Receiver "${msg.hostname || 'Receiver'}" received request -> Waiting for user to click ACCEPT`);
    broadcastToLocalViews(msg);
    broadcastHostStatus();
  } else if (msg.type === 'auth_ok') {
    clearInterval(controllerHelloRetryInterval);
    controllerConnected = true;
    controllerStatus = 'connected';
    controllerPeerHostname = msg.hostname || 'Receiver PC';
    controllerStatusDetail = `Accepted & Paired with ${controllerPeerHostname}`;
    pushDiagLog('CTRL', `PAIRED with Receiver "${controllerPeerHostname}" (${msg.screenWidth}x${msg.screenHeight})! OS Edge armed: ${driver.hostPosition.toUpperCase()}`);
    controllerPeerScreen = {
      width: msg.screenWidth || 1920,
      height: msg.screenHeight || 1080
    };
    sendFromNativeController({ type: 'set_layout', hostPosition: driver.hostPosition });
    if (controllerCaptureArmed) {
      driver.setOsCapture(true, driver.hostPosition);
    }
    clearInterval(controllerPingInterval);
    controllerPingInterval = setInterval(() => {
      if (controllerConnected) {
        sendFromNativeController({ type: 'ping', clientId: myControllerId, ts: Date.now() });
      }
    }, 2500);
    broadcastToLocalViews(msg);
    broadcastHostStatus();
  } else if (msg.type === 'auth_err') {
    clearInterval(controllerHelloRetryInterval);
    controllerConnected = false;
    controllerStatus = 'rejected';
    controllerStatusDetail = msg.message || 'Connection declined by Receiver';
    pushDiagLog('CTRL-ERR', `Rejected by Receiver: ${controllerStatusDetail}`);
    driver.setOsCapture(false, driver.hostPosition);
    broadcastToLocalViews(msg);
    broadcastHostStatus();
  } else if (msg.type === 'pong') {
    controllerLatencyMs = Math.max(1, Date.now() - msg.ts);
    broadcastToLocalViews(msg);
  } else if (msg.type === 'return_to_client') {
    driver.releaseControllerCapture(msg.normX ?? 0.5, msg.normY ?? 0.5);
    broadcastToLocalViews(msg);
  } else if (msg.type === 'host_cursor') {
    broadcastToLocalViews(msg);
  } else if (msg.type === 'clipboard_sync' && msg.b64) {
    driver.setRemoteClipboard(msg.b64);
    broadcastToLocalViews({ type: 'clipboard_event', direction: 'received' });
  } else {
    broadcastToLocalViews(msg);
  }
}

function handleControllerDisconnect(reason) {
  const wasConnected = controllerConnected;
  controllerConnected = false;
  controllerStatus = 'idle';
  controllerStatusDetail = reason || 'Disconnected';
  clearInterval(controllerPingInterval);
  clearInterval(controllerHelloRetryInterval);
  // Fail-safe: unclip local cursor and stop OS hook capture immediately
  driver.releaseControllerCapture(0.5, 0.5);
  if (wasConnected) {
    broadcastToLocalViews({
      type: 'peer_connection_event',
      status: 'disconnected',
      peerName: controllerPeerHostname || 'Receiver PC',
      reason
    });
    broadcastHostStatus();
  }
}

function disconnectNativeController(disableArmed = true) {
  clearInterval(controllerPingInterval);
  clearInterval(controllerHelloRetryInterval);
  if (disableArmed) {
    controllerCaptureArmed = false;
    driver.setOsCapture(false, driver.hostPosition);
  }
  driver.releaseControllerCapture(0.5, 0.5);
  controllerConnected = false;
  controllerStatus = 'idle';
  controllerStatusDetail = 'Ready to pair';
  if (controllerWs) {
    try {
      controllerWs.removeAllListeners();
      controllerWs.close();
    } catch {}
    controllerWs = null;
  }
  if (controllerMqtt) {
    try {
      controllerMqtt.end(true);
    } catch {}
    controllerMqtt = null;
  }
}

function getHostInfoPayload() {
  const ips = getLocalIPs();
  const lanWsUrl = ips.length > 0 ? `ws://${ips[0].address}:${PORT}` : `ws://127.0.0.1:${PORT}`;
  const firstPending = pendingApprovals.size > 0 ? Array.from(pendingApprovals.values())[0] : null;
  let activeReceiverPeer = '';
  for (const p of cloudPeers.values()) {
    if (p.authenticated) {
      activeReceiverPeer = p.peerName;
      break;
    }
  }
  return {
    type: 'host_info',
    hostname: os.hostname(),
    platform: os.platform(),
    screenWidth: driver.screenWidth,
    screenHeight: driver.screenHeight,
    hostPosition: driver.hostPosition,
    activeScreen: driver.activeScreen,
    driverReady: driver.ready,
    osHooksInstalled: driver.hooksOk,
    osCaptureEnabled: driver.osCaptureEnabled,
    controllerCaptureArmed,
    controllerConnected,
    controllerStatus,
    controllerStatusDetail,
    controllerPeerHostname,
    controllerPeerScreen,
    controllerLatencyMs,
    activeReceiverPeer,
    pendingClientId: firstPending ? firstPending.clientId : '',
    pendingPeerName: firstPending ? firstPending.peerName : '',
    pendingTransport: firstPending ? firstPending.transport : '',
    lastEventStatus: lastConnectionEvent.status,
    lastEventPeer: lastConnectionEvent.peerName,
    lastEventReason: lastConnectionEvent.reason,
    clipboardSync: hostConfig.clipboardSync !== false,
    connectedClients: Array.from(clients).filter((c) => !c.isLocalDashboard && c.authenticated).length + cloudPeers.size,
    lanWsUrl,
    ips,
    roomId: hostConfig.roomId,
    pairingPin: PAIR_PIN,
    publicWsUrl: publicWsUrl,
    cloudReady,
    encryption: 'AES-256-GCM (PBKDF2-SHA256)',
    recentLogs: diagnosticLogs.slice(-18).join('\\n')
  };
}

function broadcastHostStatus() {
  broadcastToClients(getHostInfoPayload());
}

// Fail-safe watchdog: if an internet controller drops without sending leave_host, release stuck keys/buttons after 20s of silence
setInterval(() => {
  const now = Date.now();
  for (const [id, peer] of cloudPeers.entries()) {
    if (now - peer.lastSeen > 20000) {
      cloudPeers.delete(id);
      console.log(`[Watchdog] Peer ${peer.peerName} (${id}) timed out -> Releasing all pressed keys & mouse buttons!`);
      driver.failSafeReset();
      broadcastToClients({
        type: 'peer_connection_event',
        status: 'disconnected',
        peerName: peer.peerName,
        transport: 'Internet Relay (Timeout)',
        connectedClients: cloudPeers.size
      });
      broadcastHostStatus();
    }
  }
}, 3000);

let lastCursorEchoTs = 0;

function handleIncomingMessage(msg, replyFn, sourceLabel, authContext) {
  if (!msg || typeof msg !== 'object') return;

  // Native Desktop UI Control Commands (only accepted from local 127.0.0.1 desktop dashboard)
  if (authContext && authContext.isLocalDashboard) {
    if (msg.type === 'native_controller_connect') {
      controllerCaptureArmed = Boolean(msg.enableOsCapture !== false);
      connectNativeController(msg);
      replyFn(getHostInfoPayload());
      return;
    }
    if (msg.type === 'native_controller_disconnect') {
      disconnectNativeController(true);
      replyFn(getHostInfoPayload());
      return;
    }
    if (msg.type === 'native_set_os_capture') {
      controllerCaptureArmed = Boolean(msg.enabled);
      driver.setOsCapture(controllerCaptureArmed && controllerConnected, msg.hostPosition || driver.hostPosition);
      replyFn(getHostInfoPayload());
      return;
    }
    if (msg.type === 'native_set_pin') {
      PAIR_PIN = String(msg.pin || '').trim();
      saveHostConfig({ pairingPin: PAIR_PIN });
      replyFn(getHostInfoPayload());
      return;
    }
    if (msg.type === 'native_set_clipboard_sync') {
      saveHostConfig({ clipboardSync: Boolean(msg.enabled) });
      replyFn(getHostInfoPayload());
      return;
    }
  }

  // Plaintext connection attempt notice (so Receiver shows a live status alert even before decrypting)
  if (msg.type === 'connection_attempt_announce') {
    const peerName = msg.deviceName || 'Remote Controller';
    lastConnectionEvent = { status: 'connecting', peerName, reason: 'Handshaking...', ts: Date.now() };
    broadcastToLocalViews({
      type: 'peer_connection_event',
      status: 'connecting',
      peerName,
      transport: msg.transport || sourceLabel
    });
    return;
  }

  // Authentication & Interactive Approval Handshake
  if (msg.type === 'hello' || msg.type === 'auth') {
    const peerName = msg.deviceName || sourceLabel || 'Remote Controller';
    const cid = msg.clientId || ('peer_' + Date.now());
    pushDiagLog('REC-HANDSHAKE', `Incoming handshake from "${peerName}" (${cid}) via ${msg.transport || sourceLabel}`);

    if (PAIR_PIN && normalizePin(msg.pin) !== normalizePin(PAIR_PIN)) {
      if (authContext) authContext.authenticated = false;
      lastConnectionEvent = { status: 'rejected', peerName, reason: 'Wrong Pairing PIN', ts: Date.now() };
      pushDiagLog('REC-AUTH-ERR', `Rejected "${peerName}" -> Wrong PIN provided ("${msg.pin || ''}" != "${PAIR_PIN}")`);
      replyFn({ type: 'auth_err', message: 'Invalid Pairing PIN — Access Denied' });
      broadcastToClients({
        type: 'peer_connection_event',
        status: 'rejected',
        peerName,
        reason: 'Invalid Pairing PIN',
        timestamp: Date.now()
      });
      return;
    }

    // If this clientId was already approved in the current session, immediately confirm auth_ok
    if (cloudPeers.has(cid) && cloudPeers.get(cid).authenticated) {
      cloudPeers.get(cid).lastSeen = Date.now();
      if (authContext) authContext.authenticated = true;
      replyFn({
        type: 'auth_ok',
        hostname: os.hostname(),
        screenWidth: driver.screenWidth,
        screenHeight: driver.screenHeight
      });
      return;
    }

    // Hold connection in pendingApprovals and trigger Accept / Decline popup on Receiver PC!
    pendingApprovals.set(cid, {
      clientId: cid,
      peerName,
      transport: msg.transport || sourceLabel,
      replyFn,
      authContext,
      ts: Date.now()
    });
    lastConnectionEvent = { status: 'pending_approval', peerName, reason: 'Waiting for your approval...', ts: Date.now() };
    pushDiagLog('REC-APPROVAL', `PIN verified for "${peerName}" -> Showing ACCEPT / DECLINE popup on Receiver!`);

    replyFn({
      type: 'auth_pending',
      hostname: os.hostname(),
      message: 'Waiting for Receiver user to click Accept...'
    });

    broadcastToClients({
      type: 'peer_connection_event',
      status: 'pending_approval',
      clientId: cid,
      peerName,
      transport: msg.transport || sourceLabel,
      timestamp: Date.now()
    });
    broadcastHostStatus();
    return;
  }

  // Enforce strict authentication Gate before allowing ANY input injection or layout changes
  let hasAnyAuthenticatedCloudPeer = false;
  for (const peer of cloudPeers.values()) {
    if (peer.authenticated) {
      hasAnyAuthenticatedCloudPeer = true;
      peer.lastSeen = Date.now();
    }
  }

  const isPeerAuthenticated =
    (authContext && (authContext.authenticated || authContext.isLocalDashboard)) ||
    (msg.clientId && cloudPeers.has(msg.clientId) && cloudPeers.get(msg.clientId).authenticated) ||
    (!authContext && hasAnyAuthenticatedCloudPeer);

  if (!isPeerAuthenticated) {
    // If the peer is currently waiting for the user to click ACCEPT on the popup, reply with auth_pending instead of rejecting!
    if ((msg.clientId && pendingApprovals.has(msg.clientId)) || pendingApprovals.size > 0) {
      replyFn({
        type: 'auth_pending',
        hostname: os.hostname(),
        message: 'Waiting for Receiver user to click Accept...'
      });
      return;
    }
    // Since cloud packets reaching this point were ALREADY decrypted with the valid room AES-256-GCM key + PIN,
    // if a packet arrives before 'hello' (e.g. set_layout or clipboard_sync), queue it into pendingApprovals for user consent!
    if (!authContext) {
      const cid = msg.clientId || 'cloud_peer';
      const peerName = msg.deviceName || 'Remote Controller';
      pendingApprovals.set(cid, {
        clientId: cid,
        peerName,
        transport: 'Encrypted Internet Relay',
        replyFn,
        authContext: null,
        ts: Date.now()
      });
      lastConnectionEvent = { status: 'pending_approval', peerName, reason: 'Waiting for your approval...', ts: Date.now() };
      replyFn({
        type: 'auth_pending',
        hostname: os.hostname(),
        message: 'Waiting for Receiver user to click Accept...'
      });
      broadcastToClients({
        type: 'peer_connection_event',
        status: 'pending_approval',
        clientId: cid,
        peerName,
        transport: 'Encrypted Internet Relay',
        timestamp: Date.now()
      });
      broadcastHostStatus();
      return;
    }

    replyFn({
      type: 'auth_err',
      message: 'Unauthenticated input rejected. Complete PIN pairing handshake first.'
    });
    return;
  }

  // Ultra-fast compact mouse delta packet: { t: 'm', x: dx, y: dy } or { type: 'mousemove', dx, dy }
  if (msg.t === 'm' || msg.type === 'mousemove') {
    const dx = msg.x ?? msg.dx ?? 0;
    const dy = msg.y ?? msg.dy ?? 0;
    const pos = driver.moveRelative(dx, dy);
    if (pos) {
      // Only echo cursor coordinates to local Receiver views (skipCloud = true) to prevent two-way internet relay congestion!
      const now = Date.now();
      if (now - lastCursorEchoTs > 120) {
        lastCursorEchoTs = now;
        broadcastToLocalViews({
          type: 'host_cursor',
          x: pos.x,
          y: pos.y,
          normX: Number(pos.normX.toFixed(3)),
          normY: Number(pos.normY.toFixed(3))
        });
      }
    }
    return;
  }

  if (msg.type === 'ping') {
    replyFn({
      type: 'pong',
      ts: msg.ts,
      hostname: os.hostname(),
      screenWidth: driver.screenWidth,
      screenHeight: driver.screenHeight
    });
    return;
  }

  if (msg.type === 'set_layout') {
    if (['right', 'left', 'top', 'bottom'].includes(msg.hostPosition)) {
      driver.hostPosition = msg.hostPosition;
      saveHostConfig({ hostPosition: msg.hostPosition });
      if (driver.osCaptureEnabled) {
        driver.setOsCapture(true, msg.hostPosition);
      }
      broadcastHostStatus();
    }
    return;
  }

  if (msg.type === 'enter_host') {
    if (msg.hostPosition && ['right', 'left', 'top', 'bottom'].includes(msg.hostPosition)) {
      driver.hostPosition = msg.hostPosition;
    }
    driver.enterHostScreen(msg.normX ?? 0.5, msg.normY ?? 0.5);
    console.log(`[MWB] Controller mouse entered Receiver screen at (${driver.cursorX}, ${driver.cursorY})`);
    broadcastToClients({
      type: 'screen_switched',
      activeScreen: 'host',
      cursorX: driver.cursorX,
      cursorY: driver.cursorY,
      normX: driver.cursorX / driver.screenWidth,
      normY: driver.cursorY / driver.screenHeight
    });
    return;
  }

  if (msg.type === 'leave_host') {
    driver.leaveHostScreen();
    broadcastToClients({
      type: 'screen_switched',
      activeScreen: 'client'
    });
    return;
  }

  if (msg.type === 'clipboard_sync' && msg.b64) {
    driver.setRemoteClipboard(msg.b64);
    broadcastToLocalViews({ type: 'clipboard_event', direction: 'received' });
    return;
  }

  switch (msg.type) {
    case 'mousedown':
      driver.mouseButton(msg.button ?? 0, true);
      broadcastToLocalViews({ type: 'host_mousedown', button: msg.button ?? 0 });
      break;
    case 'mouseup':
      driver.mouseButton(msg.button ?? 0, false);
      break;
    case 'wheel':
      driver.scroll(msg.dx || 0, msg.dy || 0);
      break;
    case 'keydown': {
      const vk = CODE_TO_VK[msg.code] || msg.keyCode;
      driver.keyEvent(vk, true);
      broadcastToLocalViews({ type: 'host_keydown', code: msg.code || `VK_${vk}` });
      break;
    }
    case 'keyup': {
      const vk = CODE_TO_VK[msg.code] || msg.keyCode;
      driver.keyEvent(vk, false);
      break;
    }
  }
}

function startCloudInternetRelay(forceNew = false) {
  if (forceNew) {
    hostConfig = getOrCreateHostConfig(true);
    publicWsUrl = hostConfig.publicWsUrl;
    PAIR_PIN = hostConfig.pairingPin;
    cloudPeers.clear();
    driver.failSafeReset();
  }

  if (cloudClient) {
    try { cloudClient.end(true); } catch {}
    cloudClient = null;
  }

  const inTopic = `mwb/v1/${hostConfig.roomId}/to_host`;
  const outTopic = `mwb/v1/${hostConfig.roomId}/to_client`;

  cloudClient = mqtt.connect(CLOUD_BROKER_URL, {
    reconnectPeriod: 2000,
    connectTimeout: 8000,
    wsOptions: { perMessageDeflate: false }
  });

  cloudClient.on('connect', () => {
    cloudReady = true;
    if (cloudClient.stream && cloudClient.stream.socket && cloudClient.stream.socket._socket && cloudClient.stream.socket._socket.setNoDelay) {
      cloudClient.stream.socket._socket.setNoDelay(true);
    }
    cloudClient.subscribe(inTopic, { qos: 0 }, (err) => {
      if (!err) {
        console.log('====================================================');
        console.log('   ENCRYPTED INTERNET RELAY READY (AES-256-GCM)');
        console.log(`   Session Link : ${publicWsUrl}`);
        console.log(`   Pairing PIN  : ${PAIR_PIN}`);
        console.log('====================================================');
        broadcastHostStatus();
      }
    });
  });

  cloudClient.on('message', (topic, messageBuffer) => {
    if (topic !== inTopic) return;
    let msg;
    try {
      msg = decryptEnvelope(messageBuffer, hostConfig.roomId, PAIR_PIN);
    } catch (err) {
      console.log(`[Security] Rejected undecryptable or wrong-PIN packet on room ${hostConfig.roomId}`);
      lastConnectionEvent = {
        status: 'rejected',
        peerName: lastConnectionEvent.peerName || 'Remote Internet Device',
        reason: 'Wrong Pairing PIN (Decryption Failed)',
        ts: Date.now()
      };
      broadcastToLocalViews({
        type: 'peer_connection_event',
        status: 'rejected',
        peerName: lastConnectionEvent.peerName,
        reason: 'Wrong Pairing PIN (AES-256-GCM Decryption Failed)'
      });
      // Also notify the controller that authentication failed so its UI updates immediately
      if (cloudClient && cloudReady) {
        try {
          cloudClient.publish(outTopic, JSON.stringify({
            type: 'auth_err',
            message: 'Invalid Pairing PIN — Receiver could not decrypt your request.'
          }));
        } catch {}
      }
      return;
    }

    // If unencrypted packet arrived when PIN is set, only allow 'connection_attempt_announce'
    if (PAIR_PIN && msg.type !== 'connection_attempt_announce') {
      const rawParsed = JSON.parse(messageBuffer.toString());
      if (!rawParsed._mwb_enc) {
        return;
      }
    }

    handleIncomingMessage(
      msg,
      (replyObj) => {
        if (cloudClient && cloudReady) {
          try {
            const enc = encryptEnvelope(replyObj, hostConfig.roomId, PAIR_PIN);
            cloudClient.publish(outTopic, enc);
          } catch {}
        }
      },
      'Encrypted Internet Relay',
      null
    );
  });

  cloudClient.on('close', () => {
    cloudReady = false;
    driver.failSafeReset();
  });

  cloudClient.on('error', () => {});
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Bypass-Tunnel-Reminder, Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (parsedUrl.pathname === '/generate-link') {
    const forceNew = parsedUrl.searchParams.get('force') === 'true';
    const customPin = parsedUrl.searchParams.get('pin');
    if (customPin !== null && customPin.trim() !== '') {
      PAIR_PIN = customPin.trim();
      saveHostConfig({ pairingPin: PAIR_PIN });
    }
    if (forceNew || !cloudClient) {
      startCloudInternetRelay(forceNew);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getHostInfoPayload()));
    return;
  }

  if (parsedUrl.pathname === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getHostInfoPayload()));
    return;
  }

  if (parsedUrl.pathname === '/native-connect') {
    const mode = parsedUrl.searchParams.get('mode') || 'internet';
    const target = parsedUrl.searchParams.get('target') || '';
    const pin = parsedUrl.searchParams.get('pin') || '';
    const edge = parsedUrl.searchParams.get('edge') || 'right';
    const osCapture = parsedUrl.searchParams.get('osCapture') !== '0';
    const clipboard = parsedUrl.searchParams.get('clipboard') !== '0';

    const cleanLan = target
      .trim()
      .replace(/\(PIN:.*$/i, '')
      .trim()
      .replace(/^wss?:\/\//i, '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .trim();
    const lastColon = cleanLan.lastIndexOf(':');
    const parsedHostIp = lastColon > 0 ? cleanLan.substring(0, lastColon).trim() : (cleanLan || '127.0.0.1');
    const parsedHostPort = lastColon > 0 ? (cleanLan.substring(lastColon + 1).trim() || '8765') : '8765';

    saveHostConfig({ clipboardSync: clipboard, hostPosition: edge });
    controllerCaptureArmed = osCapture;
    connectNativeController({
      connectionType: mode,
      internetUrl: target,
      hostIp: parsedHostIp,
      hostPort: parsedHostPort,
      pin,
      hostPosition: edge,
      enableOsCapture: osCapture
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getHostInfoPayload()));
    return;
  }

  if (parsedUrl.pathname === '/native-disconnect') {
    disconnectNativeController(true);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getHostInfoPayload()));
    return;
  }

  if (parsedUrl.pathname === '/native-set-edge') {
    const edge = (parsedUrl.searchParams.get('edge') || 'right').toLowerCase();
    const role = (parsedUrl.searchParams.get('role') || 'controller').toLowerCase();
    if (['left', 'right', 'top', 'bottom'].includes(edge)) {
      // If user clicked the arrangement on the RECEIVER PC (e.g., placed Remote Controller on Receiver's LEFT),
      // that means the Receiver sits on the Controller's RIGHT (inverse edge).
      const canonicalHostPos = role === 'receiver' ? getInverseEdge(edge) : edge;
      driver.hostPosition = canonicalHostPos;
      saveHostConfig({ hostPosition: canonicalHostPos });

      if (controllerConnected) {
        if (controllerCaptureArmed) {
          driver.setOsCapture(true, canonicalHostPos);
        }
        sendFromNativeController({ type: 'set_layout', hostPosition: canonicalHostPos });
      } else {
        // We are the Receiver: notify any connected Controller to update its OS hook edge immediately!
        broadcastToClients({ type: 'set_layout', hostPosition: canonicalHostPos });
      }
      broadcastHostStatus();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getHostInfoPayload()));
    return;
  }

  if (parsedUrl.pathname === '/native-set-options') {
    const osCapture = parsedUrl.searchParams.get('osCapture') !== '0';
    const clipboard = parsedUrl.searchParams.get('clipboard') !== '0';
    controllerCaptureArmed = osCapture;
    saveHostConfig({ clipboardSync: clipboard });
    driver.setOsCapture(controllerCaptureArmed && controllerConnected, driver.hostPosition);
    broadcastHostStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getHostInfoPayload()));
    return;
  }

  if (parsedUrl.pathname === '/approve-peer') {
    const cid = parsedUrl.searchParams.get('clientId') || '';
    const accept = parsedUrl.searchParams.get('accept') === '1';
    const pending = pendingApprovals.get(cid);
    if (pending) {
      pendingApprovals.delete(cid);
      if (accept) {
        if (pending.authContext) pending.authContext.authenticated = true;
        cloudPeers.set(cid, {
          lastSeen: Date.now(),
          peerName: pending.peerName,
          authenticated: true
        });
        lastConnectionEvent = { status: 'connected', peerName: pending.peerName, reason: 'Approved by user', ts: Date.now() };
        pending.replyFn({
          type: 'auth_ok',
          hostname: os.hostname(),
          screenWidth: driver.screenWidth,
          screenHeight: driver.screenHeight
        });
        pending.replyFn(getHostInfoPayload());
        broadcastToClients({
          type: 'peer_connection_event',
          status: 'connected',
          peerName: pending.peerName,
          transport: pending.transport,
          connectedClients: cloudPeers.size,
          timestamp: Date.now()
        });
        console.log(`[Receiver] User ACCEPTED connection from ${pending.peerName} (${cid})`);
      } else {
        if (pending.authContext) pending.authContext.authenticated = false;
        lastConnectionEvent = { status: 'rejected', peerName: pending.peerName, reason: 'Declined by Receiver user', ts: Date.now() };
        pending.replyFn({
          type: 'auth_err',
          message: `Connection declined by user on "${os.hostname()}".`
        });
        broadcastToClients({
          type: 'peer_connection_event',
          status: 'rejected',
          peerName: pending.peerName,
          reason: 'Declined by user',
          timestamp: Date.now()
        });
        console.log(`[Receiver] User DECLINED connection from ${pending.peerName} (${cid})`);
      }
      broadcastHostStatus();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getHostInfoPayload()));
    return;
  }

  if (parsedUrl.pathname === '/github-update') {
    const updaterPs1 = path.join(__dirname, '..', 'Update-OneDesk.ps1');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Launching GitHub Auto-Updater...' }));
    setTimeout(() => {
      spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updaterPs1], {
        cwd: path.join(__dirname, '..'),
        detached: true,
        stdio: 'ignore'
      }).unref();
    }, 300);
    return;
  }

  // Serve the Desktop UI directly so the native desktop window or local browser can run without Chrome extension APIs
  let safePath = parsedUrl.pathname === '/' ? '/controller.html' : parsedUrl.pathname;
  safePath = path.normalize(safePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(EXTENSION_DIR, safePath);
  if (filePath.startsWith(EXTENSION_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Mouse Without Borders Native Desktop Service is running.\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const remoteIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const isLocalhost = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  if (ws._socket && ws._socket.setNoDelay) {
    ws._socket.setNoDelay(true);
  }
  ws.isLocalDashboard = isLocalhost;
  ws.authenticated = isLocalhost;
  clients.add(ws);

  if (!isLocalhost) {
    pushDiagLog('LAN-REC', `Incoming Direct LAN TCP connection from ${remoteIp}`);
    lastConnectionEvent = { status: 'connecting', peerName: `LAN (${remoteIp})`, reason: 'Connected to port 8765', ts: Date.now() };
  }
  ws.send(JSON.stringify(getHostInfoPayload()));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    handleIncomingMessage(
      msg,
      (replyObj) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(replyObj));
        }
      },
      `LAN (${remoteIp})`,
      ws
    );
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (!ws.isLocalDashboard) {
      // Fail-safe release all pressed keys & mouse buttons when a remote controller disconnects
      driver.failSafeReset();
      broadcastToClients({
        type: 'peer_connection_event',
        status: 'disconnected',
        peerName: `LAN Device (${remoteIp})`,
        transport: 'LAN WebSocket',
        connectedClients: cloudPeers.size,
        timestamp: Date.now()
      });
      broadcastHostStatus();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('====================================================');
  console.log('   Mouse Without Borders — Native Desktop Service');
  console.log('====================================================');
  console.log(`Hostname     : ${os.hostname()}`);
  console.log(`Desktop UI   : http://127.0.0.1:${PORT}/`);
  if (ips.length > 0) {
    ips.forEach((ip) => {
      console.log(`  LAN Link   -> ws://${ip.address}:${PORT}   (${ip.name})`);
    });
  }
  console.log(`  Session ID -> ${publicWsUrl}`);
  console.log(`  Pairing PIN-> ${PAIR_PIN}`);
  console.log('====================================================');
  pushDiagLog('SERVICE', `Listening on 0.0.0.0:${PORT} (LAN: ${ips.map(i => i.address).join(', ') || '127.0.0.1'})`);

  // Automatically ensure Windows Firewall allows inbound Direct LAN connections on TCP port 8765
  if (os.platform() === 'win32') {
    spawn('powershell.exe', [
      '-NoProfile',
      '-WindowStyle',
      'Hidden',
      '-Command',
      `netsh advfirewall firewall show rule name="OneDesk LAN Port ${PORT}" >$null 2>&1; if ($LASTEXITCODE -ne 0) { netsh advfirewall firewall add rule name="OneDesk LAN Port ${PORT}" dir=in action=allow protocol=TCP localport=${PORT} >$null 2>&1 }`
    ], { windowsHide: true, stdio: 'ignore' });
  }

  startCloudInternetRelay(false);
});
