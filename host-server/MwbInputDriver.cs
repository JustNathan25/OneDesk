using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Threading;
using System.Diagnostics;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class CursorOverlayForm : Form {
    private bool isVisibleCursor = false;

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;

    public CursorOverlayForm() {
        this.FormBorderStyle = FormBorderStyle.None;
        this.ShowInTaskbar = false;
        this.TopMost = true;
        this.Width = 36;
        this.Height = 36;
        this.BackColor = Color.Magenta;
        this.TransparencyKey = Color.Magenta;
        this.DoubleBuffered = true;
        this.StartPosition = FormStartPosition.Manual;
        this.Location = new Point(-100, -100);
    }

    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            // WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
            cp.ExStyle |= 0x00080000 | 0x00000020 | 0x00000008 | 0x00000080 | 0x08000000;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation {
        get { return true; }
    }

    public void MoveOverlay(int x, int y) {
        isVisibleCursor = true;
        SetWindowPos(this.Handle, HWND_TOPMOST, x, y, 36, 36, SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }

    public void HideOverlay() {
        isVisibleCursor = false;
        SetWindowPos(this.Handle, HWND_TOPMOST, -100, -100, 36, 36, SWP_NOSIZE | SWP_NOACTIVATE);
    }

    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        if (!isVisibleCursor) return;
        Graphics g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;

        Point[] arrow = new Point[] {
            new Point(2, 2),
            new Point(2, 24),
            new Point(8, 19),
            new Point(13, 29),
            new Point(17, 27),
            new Point(12, 17),
            new Point(20, 17)
        };

        using (SolidBrush fillBrush = new SolidBrush(Color.White)) {
            g.FillPolygon(fillBrush, arrow);
        }
        using (Pen borderPen = new Pen(Color.FromArgb(15, 23, 42), 2.2f)) {
            g.DrawPolygon(borderPen, arrow);
        }
        using (SolidBrush badgeBrush = new SolidBrush(Color.FromArgb(56, 189, 248))) {
            g.FillEllipse(badgeBrush, 16, 20, 10, 10);
        }
        using (Pen badgePen = new Pen(Color.White, 1.5f)) {
            g.DrawEllipse(badgePen, 16, 20, 10, 10);
        }
    }
}

public class Program {
    // --- Win32 P/Invoke Declarations ---
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern bool ClipCursor(ref RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool ClipCursor(IntPtr lpRect);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    public delegate IntPtr LowLevelProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;

    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;

    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_RBUTTONUP = 0x0205;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_MBUTTONUP = 0x0208;
    private const int WM_MOUSEWHEEL = 0x020A;
    private const int WM_MOUSEHWHEEL = 0x020E;

    private const uint LLMHF_INJECTED = 0x00000001;
    private const uint LLKHF_INJECTED = 0x00000010;

    private static CursorOverlayForm overlay;
    private static IntPtr mouseHookId = IntPtr.Zero;
    private static IntPtr kbdHookId = IntPtr.Zero;
    private static LowLevelProc mouseProcDelegate;
    private static LowLevelProc kbdProcDelegate;

    // Controller OS-level state
    private static volatile bool captureEnabled = false;
    private static volatile bool remoteCaptureActive = false;
    private static volatile string activeEdge = "right"; // left | right | top | bottom
    private static int screenW = 1920;
    private static int screenH = 1080;
    private static int anchorX = 960;
    private static int anchorY = 540;
    private static long cooldownUntilTicks = 0;

    // Receiver safety tracking for stuck-key / stuck-button prevention
    private static readonly HashSet<byte> pressedKeys = new HashSet<byte>();
    private static readonly HashSet<int> pressedButtons = new HashSet<int>();
    private static readonly object stateLock = new object();
    private static readonly object consoleLock = new object();

    private static string lastClipboardText = "";

    private static void EmitLine(string text) {
        lock (consoleLock) {
            Console.WriteLine(text);
            Console.Out.Flush();
        }
    }

    private static void ReleaseAllInjectedInputs() {
        lock (stateLock) {
            foreach (byte vk in pressedKeys) {
                try { keybd_event(vk, 0, 2, 0); } catch {}
            }
            pressedKeys.Clear();

            foreach (int btn in pressedButtons) {
                try {
                    if (btn == 0) mouse_event(0x0004, 0, 0, 0, 0); // LEFTUP
                    else if (btn == 1) mouse_event(0x0040, 0, 0, 0, 0); // MIDDLEUP
                    else if (btn == 2) mouse_event(0x0010, 0, 0, 0, 0); // RIGHTUP
                } catch {}
            }
            pressedButtons.Clear();
        }
    }

    private static void EnterRemoteCapture(int entryX, int entryY, string edge) {
        if (remoteCaptureActive) return;

        // Park anchor slightly inside the screen edge so local cursor stays still
        if (edge == "right") {
            anchorX = screenW - 4;
            anchorY = Math.Max(4, Math.Min(screenH - 4, entryY));
        } else if (edge == "left") {
            anchorX = 4;
            anchorY = Math.Max(4, Math.Min(screenH - 4, entryY));
        } else if (edge == "top") {
            anchorX = Math.Max(4, Math.Min(screenW - 4, entryX));
            anchorY = 4;
        } else {
            anchorX = Math.Max(4, Math.Min(screenW - 4, entryX));
            anchorY = screenH - 4;
        }

        remoteCaptureActive = true;
        SetCursorPos(anchorX, anchorY);

        RECT clipRect = new RECT {
            Left = anchorX,
            Top = anchorY,
            Right = anchorX + 1,
            Bottom = anchorY + 1
        };
        ClipCursor(ref clipRect);

        double normX = Math.Max(0.0, Math.Min(1.0, (double)entryX / Math.Max(1, screenW)));
        double normY = Math.Max(0.0, Math.Min(1.0, (double)entryY / Math.Max(1, screenH)));
        EmitLine(string.Format(System.Globalization.CultureInfo.InvariantCulture,
            "HOOK_EDGE:{0}:{1:F4}:{2:F4}", edge, normX, normY));
    }

    private static void ExitRemoteCapture(double normX, double normY, string reason) {
        bool wasActive = remoteCaptureActive;
        remoteCaptureActive = false;
        cooldownUntilTicks = DateTime.UtcNow.AddMilliseconds(350).Ticks;
        ClipCursor(IntPtr.Zero);

        if (normX >= 0 && normY >= 0) {
            int targetX = (int)Math.Round(normX * screenW);
            int targetY = (int)Math.Round(normY * screenH);
            if (activeEdge == "right") targetX = screenW - 14;
            else if (activeEdge == "left") targetX = 14;
            else if (activeEdge == "top") targetY = 14;
            else if (activeEdge == "bottom") targetY = screenH - 14;

            targetX = Math.Max(2, Math.Min(screenW - 2, targetX));
            targetY = Math.Max(2, Math.Min(screenH - 2, targetY));
            SetCursorPos(targetX, targetY);
        }

        if (wasActive) {
            EmitLine("HOOK_RETURN:" + reason);
        }
    }

    private static int pendingMoveDx = 0;
    private static int pendingMoveDy = 0;

    private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && captureEnabled) {
            int msg = wParam.ToInt32();
            MSLLHOOKSTRUCT hookStruct = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));

            // Do not intercept synthetic events injected by our own receiver driver on this machine
            bool isInjected = (hookStruct.flags & LLMHF_INJECTED) != 0;

            if (!remoteCaptureActive && !isInjected) {
                if (msg == WM_MOUSEMOVE) {
                    if (DateTime.UtcNow.Ticks >= cooldownUntilTicks) {
                        int x = hookStruct.pt.X;
                        int y = hookStruct.pt.Y;
                        string edge = activeEdge;
                        if (edge == "right" && x >= screenW - 4) {
                            EnterRemoteCapture(x, y, "right");
                            return new IntPtr(1);
                        } else if (edge == "left" && x <= 3) {
                            EnterRemoteCapture(x, y, "left");
                            return new IntPtr(1);
                        } else if (edge == "top" && y <= 3) {
                            EnterRemoteCapture(x, y, "top");
                            return new IntPtr(1);
                        } else if (edge == "bottom" && y >= screenH - 4) {
                            EnterRemoteCapture(x, y, "bottom");
                            return new IntPtr(1);
                        }
                    }
                }
            } else if (remoteCaptureActive) {
                if (msg == WM_MOUSEMOVE) {
                    int dx = hookStruct.pt.X - anchorX;
                    int dy = hookStruct.pt.Y - anchorY;
                    if (dx != 0 || dy != 0) {
                        Interlocked.Add(ref pendingMoveDx, dx);
                        Interlocked.Add(ref pendingMoveDy, dy);
                    }
                    // Returning 1 swallows the OS cursor move so the cursor stays pinned at (anchorX, anchorY) without calling SetCursorPos!
                    return new IntPtr(1);
                } else if (msg == WM_LBUTTONDOWN) {
                    EmitLine("HOOK_BTN:0:1");
                    return new IntPtr(1);
                } else if (msg == WM_LBUTTONUP) {
                    EmitLine("HOOK_BTN:0:0");
                    return new IntPtr(1);
                } else if (msg == WM_RBUTTONDOWN) {
                    EmitLine("HOOK_BTN:2:1");
                    return new IntPtr(1);
                } else if (msg == WM_RBUTTONUP) {
                    EmitLine("HOOK_BTN:2:0");
                    return new IntPtr(1);
                } else if (msg == WM_MBUTTONDOWN) {
                    EmitLine("HOOK_BTN:1:1");
                    return new IntPtr(1);
                } else if (msg == WM_MBUTTONUP) {
                    EmitLine("HOOK_BTN:1:0");
                    return new IntPtr(1);
                } else if (msg == WM_MOUSEWHEEL) {
                    short wheelDelta = (short)((hookStruct.mouseData >> 16) & 0xFFFF);
                    EmitLine("HOOK_WHEEL:0:" + (-wheelDelta));
                    return new IntPtr(1);
                } else if (msg == WM_MOUSEHWHEEL) {
                    short hWheelDelta = (short)((hookStruct.mouseData >> 16) & 0xFFFF);
                    EmitLine("HOOK_WHEEL:" + hWheelDelta + ":0");
                    return new IntPtr(1);
                }
            }
        }
        return CallNextHookEx(mouseHookId, nCode, wParam, lParam);
    }

    private static IntPtr KbdHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0 && captureEnabled && remoteCaptureActive) {
            int msg = wParam.ToInt32();
            KBDLLHOOKSTRUCT hookStruct = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            bool isInjected = (hookStruct.flags & LLKHF_INJECTED) != 0;
            if (!isInjected) {
                uint vk = hookStruct.vkCode;
                bool isDown = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
                bool isUp = (msg == WM_KEYUP || msg == WM_SYSKEYUP);

                // Emergency hotkey return: Ctrl + Alt + Q (0x51) or Escape (0x1B)
                if (isDown && (vk == 0x51 || vk == 0x1B)) {
                    bool ctrlDown = (GetAsyncKeyState(0x11) & 0x8000) != 0;
                    bool altDown = (GetAsyncKeyState(0x12) & 0x8000) != 0;
                    if (vk == 0x1B || (ctrlDown && altDown)) {
                        ExitRemoteCapture(0.5, 0.5, "hotkey_return");
                        return new IntPtr(1);
                    }
                }

                if (isDown) {
                    EmitLine("HOOK_KEY:" + vk + ":1");
                    return new IntPtr(1);
                } else if (isUp) {
                    EmitLine("HOOK_KEY:" + vk + ":0");
                    return new IntPtr(1);
                }
            }
        }
        return CallNextHookEx(kbdHookId, nCode, wParam, lParam);
    }

    [STAThread]
    public static void Main() {
        try { SetProcessDPIAware(); } catch {}

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        overlay = new CursorOverlayForm();
        overlay.Show();
        overlay.HideOverlay();

        screenW = GetSystemMetrics(0);
        screenH = GetSystemMetrics(1);
        POINT p;
        GetCursorPos(out p);

        // Install global low-level OS hooks on UI message loop thread
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule) {
            IntPtr hMod = GetModuleHandle(curModule.ModuleName);
            mouseProcDelegate = new LowLevelProc(MouseHookCallback);
            kbdProcDelegate = new LowLevelProc(KbdHookCallback);
            mouseHookId = SetWindowsHookEx(WH_MOUSE_LL, mouseProcDelegate, hMod, 0);
            kbdHookId = SetWindowsHookEx(WH_KEYBOARD_LL, kbdProcDelegate, hMod, 0);
        }

        bool hooksOk = (mouseHookId != IntPtr.Zero && kbdHookId != IntPtr.Zero);
        EmitLine("SCREEN_INFO:" + screenW + ":" + screenH + ":" + p.X + ":" + p.Y);
        EmitLine("HOOK_STATUS:" + (hooksOk ? "OK" : "FAILED"));
        EmitLine("DRIVER_READY");

        // High-frequency lock-free mouse delta flusher thread (eliminates Console.WriteLine blocking inside the Win32 WH_MOUSE_LL callback!)
        Thread moveFlusherThread = new Thread(() => {
            while (true) {
                Thread.Sleep(6);
                if (!remoteCaptureActive) continue;
                int dx = Interlocked.Exchange(ref pendingMoveDx, 0);
                int dy = Interlocked.Exchange(ref pendingMoveDy, 0);
                if (dx != 0 || dy != 0) {
                    EmitLine("HOOK_MOVE:" + dx + ":" + dy);
                }
            }
        });
        moveFlusherThread.IsBackground = true;
        moveFlusherThread.Start();

        // Periodic clipboard monitor on UI STA thread
        System.Windows.Forms.Timer clipTimer = new System.Windows.Forms.Timer();
        clipTimer.Interval = 900;
        clipTimer.Tick += (sender, args) => {
            try {
                if (Clipboard.ContainsText()) {
                    string txt = Clipboard.GetText();
                    if (!string.IsNullOrEmpty(txt) && txt != lastClipboardText && txt.Length <= 65536) {
                        lastClipboardText = txt;
                        string b64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(txt));
                        EmitLine("CLIPBOARD_CHANGED:" + b64);
                    }
                }
            } catch {}
        };
        clipTimer.Start();

        // Background command reader thread:
        // Coalesces queued M (Mouse Move) commands in the stdin pipe so the cursor always jumps immediately to the latest coordinate with zero queue lag!
        Thread readerThread = new Thread(() => {
            string line;
            long lastOverlayTick = 0;
            while ((line = Console.ReadLine()) != null) {
                if (line.Length == 0) continue;
                char cmd = line[0];
                try {
                    if (cmd == 'M') {
                        string[] parts = line.Split(' ');
                        int x = int.Parse(parts[1]);
                        int y = int.Parse(parts[2]);
                        SetCursorPos(x, y);
                        long nowTicks = DateTime.UtcNow.Ticks;
                        // Throttle WinForms overlay window movement to 60Hz (16ms) so BeginInvoke never floods the Windows UI message queue
                        if (nowTicks - lastOverlayTick >= 160000 && overlay != null && overlay.IsHandleCreated) {
                            lastOverlayTick = nowTicks;
                            overlay.BeginInvoke((MethodInvoker)delegate {
                                overlay.MoveOverlay(x, y);
                            });
                        }
                    } else if (cmd == 'H') {
                        if (overlay != null && overlay.IsHandleCreated) {
                            overlay.BeginInvoke((MethodInvoker)delegate {
                                overlay.HideOverlay();
                            });
                        }
                    } else if (cmd == 'B') {
                        string[] parts = line.Split(' ');
                        uint flag = uint.Parse(parts[1]);
                        if (parts.Length >= 4) {
                            int btn = int.Parse(parts[2]);
                            bool isDown = parts[3] == "1";
                            lock (stateLock) {
                                if (isDown) pressedButtons.Add(btn);
                                else pressedButtons.Remove(btn);
                            }
                        }
                        mouse_event(flag, 0, 0, 0, 0);
                    } else if (cmd == 'W') {
                        string[] parts = line.Split(' ');
                        uint flag = uint.Parse(parts[1]);
                        int amt = int.Parse(parts[2]);
                        mouse_event(flag, 0, 0, amt, 0);
                    } else if (cmd == 'K') {
                        string[] parts = line.Split(' ');
                        byte vk = byte.Parse(parts[1]);
                        uint flag = uint.Parse(parts[2]);
                        lock (stateLock) {
                            if (flag == 0) pressedKeys.Add(vk);
                            else pressedKeys.Remove(vk);
                        }
                        keybd_event(vk, 0, flag, 0);
                    } else if (cmd == 'R') {
                        ReleaseAllInjectedInputs();
                        ExitRemoteCapture(-1, -1, "reset");
                        if (overlay != null && overlay.IsHandleCreated) {
                            overlay.BeginInvoke((MethodInvoker)delegate {
                                overlay.HideOverlay();
                            });
                        }
                    } else if (cmd == 'C') {
                        string[] parts = line.Split(' ');
                        bool en = parts[1] == "1";
                        if (parts.Length >= 3) {
                            activeEdge = parts[2].ToLowerInvariant();
                        }
                        captureEnabled = en;
                        if (!en && remoteCaptureActive) {
                            ExitRemoteCapture(-1, -1, "capture_disabled");
                        }
                        EmitLine("CAPTURE_STATE:" + (captureEnabled ? "ENABLED" : "DISABLED") + ":" + activeEdge);
                    } else if (cmd == 'E') {
                        string[] parts = line.Split(' ');
                        string edge = parts.Length >= 2 ? parts[1] : activeEdge;
                        activeEdge = edge;
                        POINT curPt;
                        GetCursorPos(out curPt);
                        EnterRemoteCapture(curPt.X, curPt.Y, edge);
                    } else if (cmd == 'U') {
                        string[] parts = line.Split(' ');
                        double nx = parts.Length >= 2 ? double.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture) : 0.5;
                        double ny = parts.Length >= 3 ? double.Parse(parts[2], System.Globalization.CultureInfo.InvariantCulture) : 0.5;
                        ExitRemoteCapture(nx, ny, "remote_border_return");
                    } else if (cmd == 'S') {
                        string b64 = line.Substring(2).Trim();
                        string text = Encoding.UTF8.GetString(Convert.FromBase64String(b64));
                        if (overlay != null && overlay.IsHandleCreated) {
                            overlay.BeginInvoke((MethodInvoker)delegate {
                                try {
                                    lastClipboardText = text;
                                    Clipboard.SetText(text);
                                } catch {}
                            });
                        }
                    }
                } catch {}
            }
            ReleaseAllInjectedInputs();
            ClipCursor(IntPtr.Zero);
            Application.Exit();
        });
        readerThread.IsBackground = true;
        readerThread.Start();

        Application.ApplicationExit += (s, e) => {
            ReleaseAllInjectedInputs();
            ClipCursor(IntPtr.Zero);
            if (mouseHookId != IntPtr.Zero) UnhookWindowsHookEx(mouseHookId);
            if (kbdHookId != IntPtr.Zero) UnhookWindowsHookEx(kbdHookId);
        };

        Application.Run();
    }
}
