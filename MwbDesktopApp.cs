using System;
using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Diagnostics;
using System.Windows.Forms;
using System.Runtime.InteropServices;

// Custom GDI+ Interactive Display Arrangement Canvas
public class MonitorCanvasPanel : Panel {
    public string EdgePosition = "right"; // right, left, top, bottom
    public string ActiveScreen = "client"; // client, host
    public string LocalHostname = "THIS PC";
    public string RemoteHostname = "REMOTE PC";
    public event Action<string> OnEdgeChanged;

    private Rectangle rectLocal;
    private Rectangle rectRemote;

    public MonitorCanvasPanel() {
        this.DoubleBuffered = true;
        this.BackColor = Color.FromArgb(14, 14, 17);
        this.Cursor = Cursors.Hand;
    }

    protected override void OnMouseDown(MouseEventArgs e) {
        base.OnMouseDown(e);
        // Click around the center display to snap the 2nd display to that edge
        int cx = this.Width / 2;
        int cy = this.Height / 2;
        int dx = e.X - cx;
        int dy = e.Y - cy;

        string nextEdge = EdgePosition;
        if (Math.Abs(dx) > Math.Abs(dy)) {
            nextEdge = dx >= 0 ? "right" : "left";
        } else {
            nextEdge = dy >= 0 ? "bottom" : "top";
        }

        if (nextEdge != EdgePosition) {
            EdgePosition = nextEdge;
            this.Invalidate();
            if (OnEdgeChanged != null) OnEdgeChanged(EdgePosition);
        }
    }

    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        int w = this.Width;
        int h = this.Height;

        // Subtle outer border & dot matrix background
        using (Pen borderPen = new Pen(Color.FromArgb(32, 32, 38), 1f)) {
            g.DrawRectangle(borderPen, 0, 0, w - 1, h - 1);
        }
        using (SolidBrush dotBrush = new SolidBrush(Color.FromArgb(26, 26, 32))) {
            for (int x = 18; x < w - 12; x += 20) {
                for (int y = 18; y < h - 12; y += 20) {
                    g.FillRectangle(dotBrush, x, y, 2, 2);
                }
            }
        }

        int monW = 112;
        int monH = 68;
        int gap = 8;
        int cx = w / 2;
        int cy = h / 2 - 4;

        if (EdgePosition == "right") {
            rectLocal = new Rectangle(cx - monW - gap / 2, cy - monH / 2, monW, monH);
            rectRemote = new Rectangle(cx + gap / 2, cy - monH / 2, monW, monH);
        } else if (EdgePosition == "left") {
            rectRemote = new Rectangle(cx - monW - gap / 2, cy - monH / 2, monW, monH);
            rectLocal = new Rectangle(cx + gap / 2, cy - monH / 2, monW, monH);
        } else if (EdgePosition == "top") {
            monW = 104;
            monH = 56;
            rectRemote = new Rectangle(cx - monW / 2, cy - monH - gap / 2, monW, monH);
            rectLocal = new Rectangle(cx - monW / 2, cy + gap / 2, monW, monH);
        } else {
            monW = 104;
            monH = 56;
            rectLocal = new Rectangle(cx - monW / 2, cy - monH - gap / 2, monW, monH);
            rectRemote = new Rectangle(cx - monW / 2, cy + gap / 2, monW, monH);
        }

        bool isRemoteActive = (ActiveScreen == "host");

        DrawMonitorTile(g, rectLocal, "01", "THIS PC", !isRemoteActive, false);
        DrawMonitorTile(g, rectRemote, "02", "REMOTE", isRemoteActive, true);

        // Draw active seam line between the two monitors
        using (Pen seamPen = new Pen(Color.FromArgb(217, 119, 6), 2.5f)) {
            if (EdgePosition == "right") {
                int sx = rectLocal.Right + gap / 2;
                g.DrawLine(seamPen, sx, rectLocal.Top + 8, sx, rectLocal.Bottom - 8);
            } else if (EdgePosition == "left") {
                int sx = rectRemote.Right + gap / 2;
                g.DrawLine(seamPen, sx, rectRemote.Top + 8, sx, rectRemote.Bottom - 8);
            } else if (EdgePosition == "top") {
                int sy = rectRemote.Bottom + gap / 2;
                g.DrawLine(seamPen, rectRemote.Left + 10, sy, rectRemote.Right - 10, sy);
            } else {
                int sy = rectLocal.Bottom + gap / 2;
                g.DrawLine(seamPen, rectLocal.Left + 10, sy, rectLocal.Right - 10, sy);
            }
        }

        // Bottom caption inside canvas
        string hint = "CLICK CANVAS TO ARRANGE SEAM  ·  ACTIVE EDGE: " + EdgePosition.ToUpper();
        using (Font fHint = new Font("Consolas", 7.8f, FontStyle.Regular))
        using (SolidBrush bHint = new SolidBrush(Color.FromArgb(113, 113, 122))) {
            SizeF sf = g.MeasureString(hint, fHint);
            g.DrawString(hint, fHint, bHint, (w - sf.Width) / 2f, h - 22);
        }
    }

    private void DrawMonitorTile(Graphics g, Rectangle r, string indexTag, string label, bool isFocused, bool isRemote) {
        Color fill = isFocused ? Color.FromArgb(24, 24, 29) : Color.FromArgb(18, 18, 22);
        Color border = isFocused
            ? (isRemote ? Color.FromArgb(16, 185, 129) : Color.FromArgb(228, 228, 231))
            : Color.FromArgb(46, 46, 54);

        using (SolidBrush bFill = new SolidBrush(fill)) {
            g.FillRectangle(bFill, r);
        }
        using (Pen pBorder = new Pen(border, isFocused ? 1.6f : 1f)) {
            g.DrawRectangle(pBorder, r);
        }

        using (Font fIndex = new Font("Consolas", 8f, FontStyle.Bold))
        using (SolidBrush bIndex = new SolidBrush(isFocused ? border : Color.FromArgb(113, 113, 122))) {
            g.DrawString(indexTag, fIndex, bIndex, r.X + 8, r.Y + 7);
        }

        if (isFocused) {
            using (SolidBrush dot = new SolidBrush(isRemote ? Color.FromArgb(16, 185, 129) : Color.FromArgb(217, 119, 6))) {
                g.FillEllipse(dot, r.Right - 14, r.Y + 9, 6, 6);
            }
        }

        using (Font fLabel = new Font("Segoe UI Semibold", 8.5f, FontStyle.Bold))
        using (SolidBrush bLabel = new SolidBrush(isFocused ? Color.FromArgb(244, 244, 245) : Color.FromArgb(161, 161, 170))) {
            SizeF sf = g.MeasureString(label, fLabel);
            g.DrawString(label, fLabel, bLabel, r.X + (r.Width - sf.Width) / 2f, r.Y + (r.Height - sf.Height) / 2f + 4);
        }
    }
}

public class MwbDesktopAppForm : Form {
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    private Process serverProcess;
    private NotifyIcon trayIcon;
    private ContextMenuStrip trayMenu;

    // Palette — Carbon Obsidian & Warm Amber Studio Aesthetic
    private static readonly Color BgRoot = Color.FromArgb(10, 10, 12);
    private static readonly Color BgSurface = Color.FromArgb(17, 17, 20);
    private static readonly Color BgInput = Color.FromArgb(12, 12, 15);
    private static readonly Color BorderSubtle = Color.FromArgb(34, 34, 40);
    private static readonly Color TextPrimary = Color.FromArgb(244, 244, 245);
    private static readonly Color TextMuted = Color.FromArgb(141, 141, 150);
    private static readonly Color AccentAmber = Color.FromArgb(217, 119, 6);
    private static readonly Color AccentEmerald = Color.FromArgb(16, 185, 129);

    // Header & Role Tabs
    private Label lblStatusDot;
    private Label lblStatusText;
    private Button btnAutoUpdate;
    private Button btnTabReceiver;
    private Button btnTabController;
    private Panel tabIndicator;

    // Interactive Display Canvas
    private MonitorCanvasPanel monitorCanvas;
    private Button[] edgeButtons = new Button[4];

    // Receiver Card
    private Panel receiverPanel;
    private TextBox txtSessionLink;
    private TextBox txtSessionPin;
    private Label lblLanHint;
    private Button btnCopySession;
    private Button btnNewSession;

    // Controller Card
    private Panel controllerPanel;
    private Button btnModeCloud;
    private Button btnModeLan;
    private TextBox txtTargetLink;
    private TextBox txtTargetPin;
    private CheckBox chkOsHooks;
    private CheckBox chkClipboard;
    private Button btnConnect;
    private Button btnDisconnect;

    // Minimalist Footer Bar
    private Label lblFooterStatus;

    private string currentRole = "receiver";
    private string currentTransportMode = "internet";
    private string currentEdge = "right";
    private string promptedPendingClientId = "";
    private bool approvalDialogOpen = false;
    private System.Windows.Forms.Timer pollTimer;
    private System.Windows.Forms.Timer gitCheckTimer;
    private string baseDir;

    public MwbDesktopAppForm() {
        baseDir = Directory.GetCurrentDirectory();
        if (!File.Exists(Path.Combine(baseDir, "MwbDesktopApp.cs"))) {
            baseDir = AppDomain.CurrentDomain.BaseDirectory;
        }
        this.Text = "OneDesk";
        this.Size = new Size(560, 620);
        this.MinimumSize = new Size(560, 620);
        this.MaximumSize = new Size(560, 620);
        this.FormBorderStyle = FormBorderStyle.FixedSingle;
        this.MaximizeBox = false;
        this.StartPosition = FormStartPosition.CenterScreen;
        this.BackColor = BgRoot;
        this.ForeColor = TextPrimary;
        this.Font = new Font("Segoe UI", 9f, FontStyle.Regular);

        // Enable native Windows 11 dark titlebar
        try {
            int useDark = 1;
            DwmSetWindowAttribute(this.Handle, 20, ref useDark, sizeof(int));
        } catch {}

        string iconPath = Path.Combine(baseDir, "chrome-extension", "icons", "icon128.png");
        if (File.Exists(iconPath)) {
            try {
                using (Bitmap bmp = new Bitmap(iconPath)) {
                    this.Icon = Icon.FromHandle(bmp.GetHicon());
                }
            } catch {}
        }

        BuildUI();
        BuildTrayIcon();
        EnsureBackendServiceRunning();

        pollTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        pollTimer.Tick += (s, e) => RefreshServiceTelemetry();
        pollTimer.Start();
        RefreshServiceTelemetry();

        gitCheckTimer = new System.Windows.Forms.Timer { Interval = 45000 };
        gitCheckTimer.Tick += (s, e) => CheckForGitHubUpdatesAsync();
        gitCheckTimer.Start();
        CheckForGitHubUpdatesAsync();
    }

    private Button CreateFlatButton(string text, Point loc, Size size, Color bg, Color fg, Color borderCol) {
        Button b = new Button {
            Text = text,
            Location = loc,
            Size = size,
            BackColor = bg,
            ForeColor = fg,
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI Semibold", 8.8f, FontStyle.Bold),
            Cursor = Cursors.Hand
        };
        b.FlatAppearance.BorderColor = borderCol;
        b.FlatAppearance.BorderSize = borderCol == Color.Empty ? 0 : 1;
        b.FlatAppearance.MouseOverBackColor = ControlPaint.Light(bg, 0.08f);
        return b;
    }

    private void BuildUI() {
        // 1. Minimalist Top Bar
        Panel topBar = new Panel {
            Dock = DockStyle.Top,
            Height = 56,
            BackColor = BgRoot
        };

        Label brand = new Label {
            Text = "ONEDESK",
            Font = new Font("Segoe UI", 11.5f, FontStyle.Bold),
            ForeColor = TextPrimary,
            AutoSize = true,
            Location = new Point(24, 18)
        };

        lblStatusDot = new Label {
            Text = "●",
            Font = new Font("Segoe UI", 9f, FontStyle.Bold),
            ForeColor = AccentEmerald,
            AutoSize = true,
            Location = new Point(112, 20)
        };

        lblStatusText = new Label {
            Text = "OS HOOKS READY",
            Font = new Font("Consolas", 8f, FontStyle.Regular),
            ForeColor = TextMuted,
            AutoSize = true,
            Location = new Point(128, 22)
        };

        btnAutoUpdate = CreateFlatButton(
            "GIT SYNC",
            new Point(414, 14),
            new Size(106, 28),
            BgSurface,
            TextMuted,
            BorderSubtle
        );
        btnAutoUpdate.Font = new Font("Consolas", 8f, FontStyle.Bold);
        btnAutoUpdate.Click += (s, e) => TriggerGitHubAutoUpdate();

        topBar.Controls.AddRange(new Control[] { brand, lblStatusDot, lblStatusText, btnAutoUpdate });
        this.Controls.Add(topBar);

        // 2. Clean Segmented Role Switcher
        Panel roleContainer = new Panel {
            Location = new Point(24, 60),
            Size = new Size(496, 40),
            BackColor = BgSurface
        };

        btnTabReceiver = CreateFlatButton(
            "RECEIVER  (SHARE SCREEN)",
            new Point(0, 0),
            new Size(248, 38),
            BgSurface,
            TextPrimary,
            Color.Empty
        );
        btnTabController = CreateFlatButton(
            "CONTROLLER  (SEND INPUT)",
            new Point(248, 0),
            new Size(248, 38),
            BgSurface,
            TextMuted,
            Color.Empty
        );

        tabIndicator = new Panel {
            Location = new Point(0, 38),
            Size = new Size(248, 2),
            BackColor = AccentAmber
        };

        btnTabReceiver.Click += (s, e) => SwitchRole("receiver");
        btnTabController.Click += (s, e) => SwitchRole("controller");

        roleContainer.Controls.AddRange(new Control[] { btnTabReceiver, btnTabController, tabIndicator });
        this.Controls.Add(roleContainer);

        // 3. Interactive Visual Display Canvas (Top Middle)
        monitorCanvas = new MonitorCanvasPanel {
            Location = new Point(24, 112),
            Size = new Size(496, 168)
        };
        monitorCanvas.OnEdgeChanged += (edge) => {
            SetEdgeSelection(edge, true);
        };
        this.Controls.Add(monitorCanvas);

        // 4. Compact Edge Pill Selector Row
        string[] edgeKeys = new string[] { "left", "right", "top", "bottom" };
        string[] edgeLabels = new string[] { "← LEFT SEAM", "RIGHT SEAM →", "↑ TOP SEAM", "↓ BOTTOM SEAM" };
        for (int i = 0; i < 4; i++) {
            string k = edgeKeys[i];
            Button eb = CreateFlatButton(
                edgeLabels[i],
                new Point(24 + i * 126, 288),
                new Size(118, 28),
                BgSurface,
                k == "right" ? AccentAmber : TextMuted,
                k == "right" ? AccentAmber : BorderSubtle
            );
            eb.Font = new Font("Consolas", 7.8f, FontStyle.Bold);
            eb.Tag = k;
            eb.Click += (s, e) => SetEdgeSelection((string)((Button)s).Tag, true);
            edgeButtons[i] = eb;
            this.Controls.Add(eb);
        }

        // 5A. Receiver Panel (Minimalist Session Credentials Card)
        receiverPanel = new Panel {
            Location = new Point(24, 328),
            Size = new Size(496, 206),
            BackColor = BgSurface
        };
        receiverPanel.Paint += (s, e) => {
            using (Pen p = new Pen(BorderSubtle, 1f)) {
                e.Graphics.DrawRectangle(p, 0, 0, receiverPanel.Width - 1, receiverPanel.Height - 1);
            }
        };

        Label lblRecHeader = new Label {
            Text = "SESSION CREDENTIALS",
            Font = new Font("Consolas", 8f, FontStyle.Bold),
            ForeColor = TextMuted,
            Location = new Point(20, 18),
            AutoSize = true
        };

        Label lblSessionId = new Label {
            Text = "Session Endpoint",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = TextMuted,
            Location = new Point(20, 44),
            AutoSize = true
        };

        txtSessionLink = new TextBox {
            Location = new Point(20, 66),
            Size = new Size(318, 28),
            ReadOnly = true,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = BgInput,
            ForeColor = TextPrimary,
            Font = new Font("Consolas", 10.5f, FontStyle.Bold)
        };

        Label lblPinTitle = new Label {
            Text = "Pairing Key",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = TextMuted,
            Location = new Point(352, 44),
            AutoSize = true
        };

        txtSessionPin = new TextBox {
            Location = new Point(352, 66),
            Size = new Size(124, 28),
            ReadOnly = true,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = BgInput,
            ForeColor = AccentAmber,
            TextAlign = HorizontalAlignment.Center,
            Font = new Font("Consolas", 10.5f, FontStyle.Bold)
        };

        btnCopySession = CreateFlatButton(
            "COPY PAIRING KEY",
            new Point(20, 110),
            new Size(318, 38),
            AccentAmber,
            Color.FromArgb(10, 10, 12),
            Color.Empty
        );
        btnCopySession.Click += (s, e) => {
            if (!string.IsNullOrEmpty(txtSessionLink.Text)) {
                Clipboard.SetText(txtSessionLink.Text + " (PIN: " + txtSessionPin.Text + ")");
                btnCopySession.Text = "COPIED TO CLIPBOARD";
                SetFooter("Copied session endpoint & 6-digit pairing key.");
                System.Windows.Forms.Timer t = new System.Windows.Forms.Timer { Interval = 1500 };
                t.Tick += (ts, te) => {
                    btnCopySession.Text = "COPY PAIRING KEY";
                    t.Stop();
                    t.Dispose();
                };
                t.Start();
            }
        };

        btnNewSession = CreateFlatButton(
            "ROTATE KEY",
            new Point(352, 110),
            new Size(124, 38),
            BgInput,
            TextPrimary,
            BorderSubtle
        );
        btnNewSession.Click += (s, e) => RegenerateSessionLink();

        lblLanHint = new Label {
            Text = "LAN DIRECT  ·  ws://127.0.0.1:8765",
            Font = new Font("Consolas", 8f),
            ForeColor = TextMuted,
            Location = new Point(20, 166),
            AutoSize = true
        };

        receiverPanel.Controls.AddRange(new Control[] {
            lblRecHeader, lblSessionId, txtSessionLink, lblPinTitle, txtSessionPin,
            btnCopySession, btnNewSession, lblLanHint
        });
        this.Controls.Add(receiverPanel);

        // 5B. Controller Panel (Minimalist Pairing & OS Hook Card)
        controllerPanel = new Panel {
            Location = new Point(24, 328),
            Size = new Size(496, 206),
            BackColor = BgSurface,
            Visible = false
        };
        controllerPanel.Paint += (s, e) => {
            using (Pen p = new Pen(BorderSubtle, 1f)) {
                e.Graphics.DrawRectangle(p, 0, 0, controllerPanel.Width - 1, controllerPanel.Height - 1);
            }
        };

        Label lblCtrlHeader = new Label {
            Text = "TARGET CONNECTION",
            Font = new Font("Consolas", 8f, FontStyle.Bold),
            ForeColor = TextMuted,
            Location = new Point(20, 16),
            AutoSize = true
        };

        btnModeCloud = CreateFlatButton(
            "CLOUD RELAY",
            new Point(310, 12),
            new Size(82, 22),
            BgInput,
            AccentAmber,
            AccentAmber
        );
        btnModeCloud.Font = new Font("Consolas", 7.2f, FontStyle.Bold);

        btnModeLan = CreateFlatButton(
            "DIRECT LAN",
            new Point(396, 12),
            new Size(80, 22),
            BgInput,
            TextMuted,
            BorderSubtle
        );
        btnModeLan.Font = new Font("Consolas", 7.2f, FontStyle.Bold);

        btnModeCloud.Click += (s, e) => SetTransportMode("internet");
        btnModeLan.Click += (s, e) => SetTransportMode("lan");

        Label lblTargetEndpoint = new Label {
            Text = "Remote Session Endpoint or IP",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = TextMuted,
            Location = new Point(20, 42),
            AutoSize = true
        };

        txtTargetLink = new TextBox {
            Location = new Point(20, 64),
            Size = new Size(318, 28),
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = BgInput,
            ForeColor = TextPrimary,
            Font = new Font("Consolas", 10f)
        };
        txtTargetLink.TextChanged += (s, e) => {
            string raw = txtTargetLink.Text;
            int pinIdx = raw.IndexOf("(PIN:", StringComparison.OrdinalIgnoreCase);
            if (pinIdx >= 0) {
                string linkPart = raw.Substring(0, pinIdx).Trim();
                string pinPart = raw.Substring(pinIdx + 5).Replace(")", "").Trim();
                txtTargetLink.Text = linkPart;
                if (!string.IsNullOrEmpty(pinPart)) {
                    txtTargetPin.Text = pinPart;
                }
            }
        };

        Label lblTargetKey = new Label {
            Text = "Pairing Key",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = TextMuted,
            Location = new Point(352, 42),
            AutoSize = true
        };

        txtTargetPin = new TextBox {
            Location = new Point(352, 64),
            Size = new Size(124, 28),
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = BgInput,
            ForeColor = AccentAmber,
            TextAlign = HorizontalAlignment.Center,
            Font = new Font("Consolas", 10f, FontStyle.Bold)
        };

        chkOsHooks = new CheckBox {
            Text = "OS Edge Capture",
            Location = new Point(20, 102),
            AutoSize = true,
            Checked = true,
            ForeColor = TextPrimary,
            Font = new Font("Segoe UI", 8.5f)
        };

        chkClipboard = new CheckBox {
            Text = "Shared Clipboard",
            Location = new Point(165, 102),
            AutoSize = true,
            Checked = true,
            ForeColor = TextPrimary,
            Font = new Font("Segoe UI", 8.5f)
        };

        Label lblEscHint = new Label {
            Text = "ESC / Ctrl+Alt+Q returns cursor",
            Location = new Point(310, 104),
            AutoSize = true,
            ForeColor = TextMuted,
            Font = new Font("Consolas", 7.5f)
        };

        btnConnect = CreateFlatButton(
            "LINK & ARM EDGE",
            new Point(20, 136),
            new Size(318, 38),
            AccentEmerald,
            Color.FromArgb(10, 10, 12),
            Color.Empty
        );
        btnConnect.Click += (s, e) => ConnectFromNativeDesktop();

        btnDisconnect = CreateFlatButton(
            "DISCONNECT",
            new Point(352, 136),
            new Size(124, 38),
            BgInput,
            TextMuted,
            BorderSubtle
        );
        btnDisconnect.Click += (s, e) => DisconnectFromNativeDesktop();

        controllerPanel.Controls.AddRange(new Control[] {
            lblCtrlHeader, btnModeCloud, btnModeLan, lblTargetEndpoint, txtTargetLink,
            lblTargetKey, txtTargetPin, chkOsHooks, chkClipboard, lblEscHint, btnConnect, btnDisconnect
        });
        this.Controls.Add(controllerPanel);

        // 6. Single-Line Minimalist Status Footer
        lblFooterStatus = new Label {
            Text = "AES-256-GCM END-TO-END ENCRYPTED  ·  READY",
            Font = new Font("Consolas", 8f),
            ForeColor = TextMuted,
            Location = new Point(24, 548),
            Size = new Size(496, 20),
            TextAlign = ContentAlignment.MiddleLeft
        };
        this.Controls.Add(lblFooterStatus);
    }

    private void SwitchRole(string role) {
        currentRole = role;
        bool isRec = (role == "receiver");
        receiverPanel.Visible = isRec;
        controllerPanel.Visible = !isRec;

        btnTabReceiver.ForeColor = isRec ? TextPrimary : TextMuted;
        btnTabController.ForeColor = !isRec ? TextPrimary : TextMuted;
        tabIndicator.Location = new Point(isRec ? 0 : 248, 38);
    }

    private void SetTransportMode(string mode) {
        currentTransportMode = mode;
        bool isCloud = (mode == "internet");
        btnModeCloud.ForeColor = isCloud ? AccentAmber : TextMuted;
        btnModeCloud.FlatAppearance.BorderColor = isCloud ? AccentAmber : BorderSubtle;
        btnModeLan.ForeColor = !isCloud ? AccentAmber : TextMuted;
        btnModeLan.FlatAppearance.BorderColor = !isCloud ? AccentAmber : BorderSubtle;
    }

    private void SetEdgeSelection(string edge, bool notifyBackend) {
        currentEdge = edge;
        monitorCanvas.EdgePosition = edge;
        monitorCanvas.Invalidate();

        for (int i = 0; i < edgeButtons.Length; i++) {
            bool active = ((string)edgeButtons[i].Tag == edge);
            edgeButtons[i].ForeColor = active ? AccentAmber : TextMuted;
            edgeButtons[i].FlatAppearance.BorderColor = active ? AccentAmber : BorderSubtle;
        }

        if (notifyBackend) {
            SetFooter("Active screen seam set to " + edge.ToUpper() + " edge.");
        }
    }

    private void SetFooter(string text) {
        if (lblFooterStatus.InvokeRequired) {
            lblFooterStatus.BeginInvoke((MethodInvoker)delegate { SetFooter(text); });
            return;
        }
        lblFooterStatus.Text = text.ToUpper();
    }

    private void BuildTrayIcon() {
        trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("Open OneDesk", null, (s, e) => {
            this.Show();
            this.WindowState = FormWindowState.Normal;
            this.Activate();
        });
        trayMenu.Items.Add("Sync Update from GitHub", null, (s, e) => TriggerGitHubAutoUpdate());
        trayMenu.Items.Add("-");
        trayMenu.Items.Add("Quit", null, (s, e) => CleanupAndExit());

        trayIcon = new NotifyIcon {
            Text = "OneDesk — Seamless Multi-PC Input",
            Icon = this.Icon ?? SystemIcons.Application,
            ContextMenuStrip = trayMenu,
            Visible = true
        };
        trayIcon.DoubleClick += (s, e) => {
            this.Show();
            this.WindowState = FormWindowState.Normal;
            this.Activate();
        };
    }

    private void EnsureBackendServiceRunning() {
        try {
            using (var wc = new System.Net.WebClient()) {
                string info = wc.DownloadString("http://127.0.0.1:8765/info");
                if (!string.IsNullOrEmpty(info)) {
                    SetFooter("Connected to local OS input service (127.0.0.1:8765)");
                    return;
                }
            }
        } catch {}

        string serverScript = Path.Combine(baseDir, "host-server", "server.js");
        if (!File.Exists(serverScript)) {
            serverScript = Path.Combine(baseDir, "server.js");
        }
        if (!File.Exists(serverScript)) {
            SetFooter("Error: host-server/server.js not found");
            return;
        }

        try {
            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = "node",
                Arguments = "\"" + serverScript + "\"",
                WorkingDirectory = Path.GetDirectoryName(serverScript),
                UseShellExecute = false,
                CreateNoWindow = true
            };
            serverProcess = Process.Start(psi);
            SetFooter("Native OS input & encrypted relay service started");
        } catch (Exception ex) {
            SetFooter("Service error: " + ex.Message);
        }
    }

    private string ExtractJsonString(string json, string key) {
        string pattern = "\"" + key + "\":\"";
        int idx = json.IndexOf(pattern);
        if (idx < 0) return "";
        int start = idx + pattern.Length;
        int end = json.IndexOf("\"", start);
        if (end < 0) return "";
        return json.Substring(start, end - start);
    }

    private void ShowIncomingApprovalModal(string clientId, string peerName, string transport) {
        if (approvalDialogOpen) return;
        approvalDialogOpen = true;
        promptedPendingClientId = clientId;

        Form modal = new Form {
            Text = "OneDesk — Incoming Connection Request",
            Size = new Size(440, 230),
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            StartPosition = FormStartPosition.CenterParent,
            TopMost = true,
            BackColor = BgRoot,
            ForeColor = TextPrimary,
            Font = new Font("Segoe UI", 9f)
        };

        try {
            int useDark = 1;
            DwmSetWindowAttribute(modal.Handle, 20, ref useDark, sizeof(int));
        } catch {}

        Panel card = new Panel {
            Location = new Point(16, 14),
            Size = new Size(392, 162),
            BackColor = BgSurface
        };
        card.Paint += (s, e) => {
            using (Pen p = new Pen(AccentAmber, 1.5f)) {
                e.Graphics.DrawRectangle(p, 0, 0, card.Width - 1, card.Height - 1);
            }
        };

        Label lblBadge = new Label {
            Text = "● INCOMING PAIRING REQUEST",
            Font = new Font("Consolas", 8.5f, FontStyle.Bold),
            ForeColor = AccentAmber,
            Location = new Point(18, 16),
            AutoSize = true
        };

        Label lblPeer = new Label {
            Text = peerName + " wants to control this computer.",
            Font = new Font("Segoe UI Semibold", 10.5f, FontStyle.Bold),
            ForeColor = TextPrimary,
            Location = new Point(18, 42),
            Size = new Size(356, 24)
        };

        Label lblSub = new Label {
            Text = "Transport: " + (string.IsNullOrEmpty(transport) ? "Online Encrypted Relay" : transport) + "\nAllow this device to share mouse, keyboard, and clipboard?",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = TextMuted,
            Location = new Point(18, 68),
            Size = new Size(356, 36)
        };

        Button btnAccept = CreateFlatButton(
            "ACCEPT & PAIR",
            new Point(18, 112),
            new Size(220, 34),
            AccentEmerald,
            Color.FromArgb(10, 10, 12),
            Color.Empty
        );

        Button btnDecline = CreateFlatButton(
            "DECLINE",
            new Point(248, 112),
            new Size(126, 34),
            BgInput,
            Color.FromArgb(239, 68, 68),
            BorderSubtle
        );

        btnAccept.Click += (s, e) => {
            SendApprovalDecision(clientId, true, peerName);
            modal.Close();
        };

        btnDecline.Click += (s, e) => {
            SendApprovalDecision(clientId, false, peerName);
            modal.Close();
        };

        modal.FormClosed += (s, e) => {
            approvalDialogOpen = false;
        };

        card.Controls.AddRange(new Control[] { lblBadge, lblPeer, lblSub, btnAccept, btnDecline });
        modal.Controls.Add(card);

        if (this.WindowState == FormWindowState.Minimized || !this.Visible) {
            this.Show();
            this.WindowState = FormWindowState.Normal;
        }
        this.Activate();
        modal.Show(this);
    }

    private void SendApprovalDecision(string clientId, bool accept, string peerName) {
        try {
            string url = string.Format(
                "http://127.0.0.1:8765/approve-peer?clientId={0}&accept={1}",
                Uri.EscapeDataString(clientId),
                accept ? "1" : "0"
            );
            using (var wc = new System.Net.WebClient()) {
                wc.DownloadString(url);
            }
            SetFooter(accept
                ? ("ACCEPTED CONNECTION FROM " + peerName)
                : ("DECLINED CONNECTION FROM " + peerName));
            RefreshServiceTelemetry();
        } catch (Exception ex) {
            SetFooter("Approval error: " + ex.Message);
        }
    }

    private void RefreshServiceTelemetry() {
        try {
            using (var wc = new System.Net.WebClient()) {
                string json = wc.DownloadString("http://127.0.0.1:8765/info");
                string pubUrl = ExtractJsonString(json, "publicWsUrl");
                string pin = ExtractJsonString(json, "pairingPin");
                string lanUrl = ExtractJsonString(json, "lanWsUrl");
                string activeScreen = ExtractJsonString(json, "activeScreen");
                string peerHost = ExtractJsonString(json, "controllerPeerHostname");
                string ctrlStatus = ExtractJsonString(json, "controllerStatus");
                string ctrlDetail = ExtractJsonString(json, "controllerStatusDetail");
                string activeRecPeer = ExtractJsonString(json, "activeReceiverPeer");
                string pendingId = ExtractJsonString(json, "pendingClientId");
                string pendingName = ExtractJsonString(json, "pendingPeerName");
                string pendingTransport = ExtractJsonString(json, "pendingTransport");
                string lastEvStatus = ExtractJsonString(json, "lastEventStatus");
                string lastEvPeer = ExtractJsonString(json, "lastEventPeer");
                string lastEvReason = ExtractJsonString(json, "lastEventReason");
                bool hooksOk = json.Contains("\"osHooksInstalled\":true");
                bool ctrlConnected = json.Contains("\"controllerConnected\":true");

                if (!string.IsNullOrEmpty(pubUrl) && txtSessionLink.Text != pubUrl) {
                    txtSessionLink.Text = pubUrl;
                }
                if (!string.IsNullOrEmpty(pin) && txtSessionPin.Text != pin) {
                    txtSessionPin.Text = pin;
                }
                if (!string.IsNullOrEmpty(lanUrl)) {
                    lblLanHint.Text = "LAN DIRECT  ·  " + lanUrl;
                }

                // Trigger interactive Accept/Decline popup on Receiver when a new connection request arrives
                if (!string.IsNullOrEmpty(pendingId) && pendingId != promptedPendingClientId && !approvalDialogOpen) {
                    SetFooter("INCOMING REQUEST FROM " + pendingName + " — WAITING FOR YOUR APPROVAL");
                    ShowIncomingApprovalModal(pendingId, pendingName, pendingTransport);
                } else if (string.IsNullOrEmpty(pendingId)) {
                    promptedPendingClientId = "";
                }

                // Update live status header and footer for both Controller and Receiver modes
                if (currentRole == "controller") {
                    if (ctrlStatus == "waiting_approval") {
                        lblStatusDot.ForeColor = AccentAmber;
                        lblStatusText.Text = "WAITING FOR RECEIVER APPROVAL...";
                        btnConnect.Text = "WAITING FOR APPROVAL...";
                        SetFooter(ctrlDetail);
                    } else if (ctrlStatus == "connecting") {
                        lblStatusDot.ForeColor = AccentAmber;
                        lblStatusText.Text = "CONNECTING TO RECEIVER...";
                        SetFooter(ctrlDetail);
                    } else if (ctrlStatus == "connected" && ctrlConnected) {
                        lblStatusDot.ForeColor = AccentEmerald;
                        lblStatusText.Text = "PAIRED · " + peerHost.ToUpper();
                        btnConnect.Text = "ARMED · " + currentEdge.ToUpper() + " SEAM";
                        SetFooter("PAIRED WITH " + peerHost + " · MOVE CURSOR TO " + currentEdge.ToUpper() + " SCREEN EDGE");
                    } else if (ctrlStatus == "rejected") {
                        lblStatusDot.ForeColor = Color.FromArgb(239, 68, 68);
                        lblStatusText.Text = "CONNECTION REJECTED";
                        btnConnect.Text = "LINK & ARM EDGE";
                        SetFooter(ctrlDetail);
                    } else {
                        lblStatusDot.ForeColor = hooksOk ? AccentEmerald : AccentAmber;
                        lblStatusText.Text = hooksOk ? "OS HOOKS READY" : "STARTING DRIVER";
                    }
                } else {
                    // Receiver Mode live status
                    if (!string.IsNullOrEmpty(pendingId)) {
                        lblStatusDot.ForeColor = AccentAmber;
                        lblStatusText.Text = "APPROVAL PENDING · " + pendingName.ToUpper();
                    } else if (!string.IsNullOrEmpty(activeRecPeer)) {
                        lblStatusDot.ForeColor = AccentEmerald;
                        lblStatusText.Text = "CONNECTED · " + activeRecPeer.ToUpper();
                        SetFooter("RECEIVING LIVE ENCRYPTED INPUT FROM " + activeRecPeer);
                    } else if (lastEvStatus == "connecting") {
                        lblStatusDot.ForeColor = AccentAmber;
                        lblStatusText.Text = "INCOMING · " + lastEvPeer.ToUpper();
                        SetFooter("INCOMING CONNECTION ATTEMPT FROM " + lastEvPeer + "...");
                    } else if (lastEvStatus == "rejected") {
                        lblStatusDot.ForeColor = Color.FromArgb(239, 68, 68);
                        lblStatusText.Text = "REJECTED · " + lastEvPeer.ToUpper();
                        SetFooter("REJECTED " + lastEvPeer + " (" + lastEvReason + ")");
                    } else {
                        lblStatusDot.ForeColor = hooksOk ? AccentEmerald : AccentAmber;
                        lblStatusText.Text = hooksOk ? "RECEIVER READY" : "STARTING DRIVER";
                    }
                }

                if (monitorCanvas.ActiveScreen != activeScreen && !string.IsNullOrEmpty(activeScreen)) {
                    monitorCanvas.ActiveScreen = activeScreen;
                    monitorCanvas.Invalidate();
                }
            }
        } catch {}
    }

    private void RegenerateSessionLink() {
        try {
            using (var wc = new System.Net.WebClient()) {
                wc.DownloadString("http://127.0.0.1:8765/generate-link?force=true");
                RefreshServiceTelemetry();
                SetFooter("Rotated session endpoint & 6-digit pairing key");
            }
        } catch (Exception ex) {
            SetFooter("Rotate error: " + ex.Message);
        }
    }

    private void ConnectFromNativeDesktop() {
        string target = txtTargetLink.Text.Trim();
        string pin = txtTargetPin.Text.Trim();

        if (string.IsNullOrEmpty(target)) {
            SetFooter("Enter remote session endpoint (mwb://...) or LAN IP first");
            txtTargetLink.Focus();
            return;
        }

        try {
            string url = string.Format(
                "http://127.0.0.1:8765/native-connect?mode={0}&target={1}&pin={2}&edge={3}&osCapture={4}&clipboard={5}",
                Uri.EscapeDataString(currentTransportMode),
                Uri.EscapeDataString(target),
                Uri.EscapeDataString(pin),
                Uri.EscapeDataString(currentEdge),
                chkOsHooks.Checked ? "1" : "0",
                chkClipboard.Checked ? "1" : "0"
            );
            using (var wc = new System.Net.WebClient()) {
                wc.DownloadString(url);
            }
            btnConnect.Text = "ARMED  ·  " + currentEdge.ToUpper() + " SEAM";
            SetFooter("Linked to " + target + " · Move cursor to " + currentEdge + " screen edge");
        } catch (Exception ex) {
            SetFooter("Link failed: " + ex.Message);
        }
    }

    private void DisconnectFromNativeDesktop() {
        try {
            using (var wc = new System.Net.WebClient()) {
                wc.DownloadString("http://127.0.0.1:8765/native-disconnect");
            }
            btnConnect.Text = "LINK & ARM EDGE";
            SetFooter("Disconnected & released OS hooks");
        } catch {}
    }

    private string RunGitCommand(string args) {
        try {
            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = "git",
                Arguments = args,
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (Process p = Process.Start(psi)) {
                string output = p.StandardOutput.ReadToEnd().Trim();
                p.WaitForExit(8000);
                return output;
            }
        } catch {
            return "";
        }
    }

    private void CheckForGitHubUpdatesAsync() {
        System.Threading.ThreadPool.QueueUserWorkItem((state) => {
            try {
                RunGitCommand("fetch origin main");
                string localSha = RunGitCommand("rev-parse HEAD");
                string remoteSha = RunGitCommand("rev-parse origin/main");
                if (!string.IsNullOrEmpty(localSha) && !string.IsNullOrEmpty(remoteSha)) {
                    bool hasNew = (localSha != remoteSha);
                    this.BeginInvoke((MethodInvoker)delegate {
                        if (hasNew) {
                            string shortSha = remoteSha.Length >= 7 ? remoteSha.Substring(0, 7) : remoteSha;
                            btnAutoUpdate.Text = "UPDATE · " + shortSha;
                            btnAutoUpdate.ForeColor = AccentEmerald;
                            btnAutoUpdate.FlatAppearance.BorderColor = AccentEmerald;
                            SetFooter("New GitHub commit " + shortSha + " available — click UPDATE");
                        } else {
                            string shortSha = localSha.Length >= 7 ? localSha.Substring(0, 7) : localSha;
                            btnAutoUpdate.Text = "SYNC · " + shortSha;
                            btnAutoUpdate.ForeColor = TextMuted;
                            btnAutoUpdate.FlatAppearance.BorderColor = BorderSubtle;
                        }
                    });
                }
            } catch {}
        });
    }

    private void TriggerGitHubAutoUpdate() {
        string updaterPs1 = Path.Combine(baseDir, "Update-OneDesk.ps1");
        if (!File.Exists(updaterPs1)) return;

        SetFooter("Pulling latest commit from GitHub & restarting...");
        try {
            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + updaterPs1 + "\"",
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            Process.Start(psi);
            CleanupAndExit();
        } catch {}
    }

    private void CleanupAndExit() {
        if (trayIcon != null) {
            trayIcon.Visible = false;
            trayIcon.Dispose();
        }
        try {
            if (serverProcess != null && !serverProcess.HasExited) {
                serverProcess.Kill();
            }
        } catch {}
        Application.Exit();
    }

    protected override void OnFormClosing(FormClosingEventArgs e) {
        CleanupAndExit();
        base.OnFormClosing(e);
    }

    [STAThread]
    public static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MwbDesktopAppForm());
    }
}
