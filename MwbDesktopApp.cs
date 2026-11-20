using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class MwbDesktopAppForm : Form {
    private Process serverProcess;
    private NotifyIcon trayIcon;
    private ContextMenuStrip trayMenu;

    private Label statusBadge;
    private Label serviceDetailLabel;
    private RadioButton radioReceiver;
    private RadioButton radioController;

    // Receiver Controls
    private Panel receiverPanel;
    private TextBox txtSessionLink;
    private TextBox txtSessionPin;
    private TextBox txtLanLink;
    private Button btnNewSession;
    private Button btnCopySession;

    // Controller Controls
    private Panel controllerPanel;
    private RadioButton radioModeInternet;
    private RadioButton radioModeLan;
    private TextBox txtTargetLink;
    private TextBox txtTargetPin;
    private ComboBox cmbEdge;
    private CheckBox chkOsHooks;
    private CheckBox chkClipboard;
    private Button btnConnect;
    private Button btnDisconnect;

    // Visual Dual-Monitor Stage
    private Panel monitorStage;
    private Panel boxMonitor1;
    private Panel boxMonitor2;
    private Label lblMonitor1;
    private Label lblMonitor2;
    private TextBox txtLog;
    private Button btnAutoUpdate;
    private System.Windows.Forms.Timer gitCheckTimer;
    private bool updateAvailable = false;

    private System.Windows.Forms.Timer pollTimer;
    private string baseDir;

    public MwbDesktopAppForm() {
        baseDir = AppDomain.CurrentDomain.BaseDirectory;
        this.Text = "Mouse Without Borders — Native Desktop App (LAN & Encrypted Internet)";
        this.Size = new Size(920, 680);
        this.MinimumSize = new Size(880, 640);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.BackColor = Color.FromArgb(15, 23, 42);
        this.ForeColor = Color.FromArgb(248, 250, 252);
        this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

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

        pollTimer = new System.Windows.Forms.Timer();
        pollTimer.Interval = 2000;
        pollTimer.Tick += (s, e) => RefreshServiceTelemetry();
        pollTimer.Start();
        RefreshServiceTelemetry();

        gitCheckTimer = new System.Windows.Forms.Timer();
        gitCheckTimer.Interval = 45000; // Check GitHub for new commits every 45 seconds
        gitCheckTimer.Tick += (s, e) => CheckForGitHubUpdatesAsync(false);
        gitCheckTimer.Start();
        CheckForGitHubUpdatesAsync(false);
    }

    private void BuildUI() {
        // Top Header Bar
        Panel header = new Panel {
            Dock = DockStyle.Top,
            Height = 62,
            BackColor = Color.FromArgb(30, 41, 59),
            Padding = new Padding(18, 12, 18, 12)
        };

        Label title = new Label {
            Text = "🖱️ Mouse Without Borders — Native Desktop Software",
            Font = new Font("Segoe UI", 13f, FontStyle.Bold),
            ForeColor = Color.White,
            AutoSize = true,
            Location = new Point(18, 10)
        };

        serviceDetailLabel = new Label {
            Text = "Native OS Input Hooks (WH_MOUSE_LL + WH_KEYBOARD_LL) • AES-256-GCM Encrypted Relay",
            Font = new Font("Segoe UI", 8.5f, FontStyle.Regular),
            ForeColor = Color.FromArgb(148, 163, 184),
            AutoSize = true,
            Location = new Point(20, 36)
        };

        statusBadge = new Label {
            Text = "Starting Service...",
            Font = new Font("Segoe UI", 9f, FontStyle.Bold),
            ForeColor = Color.FromArgb(56, 189, 248),
            BackColor = Color.FromArgb(15, 23, 42),
            AutoSize = true,
            Padding = new Padding(10, 5, 10, 5),
            Location = new Point(620, 16)
        };

        btnAutoUpdate = new Button {
            Text = "🔄 Auto-Update (GitHub)",
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            BackColor = Color.FromArgb(14, 165, 233),
            ForeColor = Color.FromArgb(15, 23, 42),
            FlatStyle = FlatStyle.Flat,
            Size = new Size(175, 32),
            Location = new Point(515, 15),
            Anchor = AnchorStyles.Top | AnchorStyles.Right
        };
        btnAutoUpdate.FlatAppearance.BorderSize = 0;
        btnAutoUpdate.Click += (s, e) => TriggerGitHubAutoUpdate();

        Button btnOpenFullDashboard = new Button {
            Text = "Open Advanced Telemetry UI",
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            BackColor = Color.FromArgb(51, 65, 85),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Size = new Size(190, 32),
            Location = new Point(700, 15),
            Anchor = AnchorStyles.Top | AnchorStyles.Right
        };
        btnOpenFullDashboard.FlatAppearance.BorderSize = 0;
        btnOpenFullDashboard.Click += (s, e) => OpenFullWorkspaceWindow();

        header.Controls.Add(title);
        header.Controls.Add(serviceDetailLabel);
        header.Controls.Add(btnAutoUpdate);
        header.Controls.Add(btnOpenFullDashboard);
        this.Controls.Add(header);

        // Role Selector Bar
        Panel roleBar = new Panel {
            Location = new Point(18, 74),
            Size = new Size(865, 48),
            BackColor = Color.FromArgb(30, 41, 59),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        Label lblRole = new Label {
            Text = "1. Select This Computer's Role:",
            Font = new Font("Segoe UI", 10f, FontStyle.Bold),
            ForeColor = Color.FromArgb(56, 189, 248),
            AutoSize = true,
            Location = new Point(14, 13)
        };

        radioReceiver = new RadioButton {
            Text = "🖥️ Receiver PC (Accepts Mouse & Keyboard Control)",
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            ForeColor = Color.White,
            AutoSize = true,
            Location = new Point(250, 12),
            Checked = true
        };

        radioController = new RadioButton {
            Text = "🖱️ Controller PC (Has Physical Mouse & Keyboard)",
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            ForeColor = Color.White,
            AutoSize = true,
            Location = new Point(585, 12)
        };

        radioReceiver.CheckedChanged += (s, e) => UpdateRolePanels();
        radioController.CheckedChanged += (s, e) => UpdateRolePanels();

        roleBar.Controls.Add(lblRole);
        roleBar.Controls.Add(radioReceiver);
        roleBar.Controls.Add(radioController);
        this.Controls.Add(roleBar);

        // Left Configuration Card (Receiver + Controller Panels)
        receiverPanel = new Panel {
            Location = new Point(18, 132),
            Size = new Size(440, 290),
            BackColor = Color.FromArgb(30, 41, 59)
        };

        Label rTitle = new Label {
            Text = "🖥️ Receiver Mode — Share Session Link & PIN",
            Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
            ForeColor = Color.FromArgb(34, 197, 94),
            AutoSize = true,
            Location = new Point(16, 14)
        };

        Label rSub = new Label {
            Text = "Copy the Session Link and 6-digit Pairing PIN below and paste them into the Controller PC app (works across any Wi-Fi or Internet network).",
            ForeColor = Color.FromArgb(148, 163, 184),
            Size = new Size(408, 38),
            Location = new Point(16, 38)
        };

        Label lblLink = new Label { Text = "Internet Session Link:", Location = new Point(16, 84), AutoSize = true };
        txtSessionLink = new TextBox {
            Location = new Point(16, 106),
            Size = new Size(270, 26),
            ReadOnly = true,
            BackColor = Color.FromArgb(11, 17, 32),
            ForeColor = Color.FromArgb(56, 189, 248),
            Font = new Font("Consolas", 10.5f, FontStyle.Bold)
        };

        Label lblPin = new Label { Text = "6-Digit PIN:", Location = new Point(298, 84), AutoSize = true };
        txtSessionPin = new TextBox {
            Location = new Point(298, 106),
            Size = new Size(124, 26),
            ReadOnly = true,
            BackColor = Color.FromArgb(11, 17, 32),
            ForeColor = Color.FromArgb(34, 197, 94),
            Font = new Font("Consolas", 10.5f, FontStyle.Bold)
        };

        btnCopySession = new Button {
            Text = "📋 Copy Link + PIN",
            BackColor = Color.FromArgb(56, 189, 248),
            ForeColor = Color.FromArgb(15, 23, 42),
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            FlatStyle = FlatStyle.Flat,
            Location = new Point(16, 144),
            Size = new Size(200, 36)
        };
        btnCopySession.FlatAppearance.BorderSize = 0;
        btnCopySession.Click += (s, e) => {
            if (!string.IsNullOrEmpty(txtSessionLink.Text)) {
                Clipboard.SetText(txtSessionLink.Text + " (PIN: " + txtSessionPin.Text + ")");
                AppendLog("Copied Session Link & PIN to Clipboard.");
            }
        };

        btnNewSession = new Button {
            Text = "🔄 New Session & PIN",
            BackColor = Color.FromArgb(51, 65, 85),
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 9f, FontStyle.Bold),
            FlatStyle = FlatStyle.Flat,
            Location = new Point(226, 144),
            Size = new Size(196, 36)
        };
        btnNewSession.FlatAppearance.BorderSize = 0;
        btnNewSession.Click += (s, e) => RegenerateSessionLink();

        Label lblLan = new Label { Text = "Direct Local LAN Address (Same Wi-Fi):", Location = new Point(16, 196), AutoSize = true };
        txtLanLink = new TextBox {
            Location = new Point(16, 218),
            Size = new Size(406, 26),
            ReadOnly = true,
            BackColor = Color.FromArgb(11, 17, 32),
            ForeColor = Color.FromArgb(203, 213, 225),
            Font = new Font("Consolas", 10f, FontStyle.Regular)
        };

        receiverPanel.Controls.AddRange(new Control[] {
            rTitle, rSub, lblLink, txtSessionLink, lblPin, txtSessionPin, btnCopySession, btnNewSession, lblLan, txtLanLink
        });
        this.Controls.Add(receiverPanel);

        // Controller Panel
        controllerPanel = new Panel {
            Location = new Point(18, 132),
            Size = new Size(440, 290),
            BackColor = Color.FromArgb(30, 41, 59),
            Visible = false
        };

        Label cTitle = new Label {
            Text = "🖱️ Controller Mode — Connect to Receiver PC",
            Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
            ForeColor = Color.FromArgb(56, 189, 248),
            AutoSize = true,
            Location = new Point(16, 12)
        };

        radioModeInternet = new RadioButton {
            Text = "🌐 Online Internet Relay (E2EE)",
            Location = new Point(16, 40),
            AutoSize = true,
            Checked = true
        };
        radioModeLan = new RadioButton {
            Text = "🏠 Local Network (LAN IP)",
            Location = new Point(235, 40),
            AutoSize = true
        };

        Label lblTarget = new Label { Text = "Receiver Session Link (mwb://...) or LAN IP:", Location = new Point(16, 68), AutoSize = true };
        txtTargetLink = new TextBox {
            Location = new Point(16, 88),
            Size = new Size(275, 26),
            BackColor = Color.FromArgb(11, 17, 32),
            ForeColor = Color.White,
            Font = new Font("Consolas", 10f)
        };
        txtTargetLink.TextChanged += (s, e) => {
            // If user pasted "mwb://mwb-xxxx (PIN: 123456)", automatically split it into Link and PIN!
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

        Label lblTargetPin = new Label { Text = "Pairing PIN:", Location = new Point(302, 68), AutoSize = true };
        txtTargetPin = new TextBox {
            Location = new Point(302, 88),
            Size = new Size(120, 26),
            BackColor = Color.FromArgb(11, 17, 32),
            ForeColor = Color.FromArgb(34, 197, 94),
            Font = new Font("Consolas", 10f, FontStyle.Bold)
        };

        Label lblEdge = new Label { Text = "Where is the 2nd Computer's Screen Located?", Location = new Point(16, 122), AutoSize = true };
        cmbEdge = new ComboBox {
            Location = new Point(16, 142),
            Size = new Size(406, 28),
            DropDownStyle = ComboBoxStyle.DropDownList,
            BackColor = Color.FromArgb(11, 17, 32),
            ForeColor = Color.White
        };
        cmbEdge.Items.AddRange(new object[] {
            "right — Right Edge of This Screen",
            "left — Left Edge of This Screen",
            "top — Top Edge of This Screen",
            "bottom — Bottom Edge of This Screen"
        });
        cmbEdge.SelectedIndex = 0;
        cmbEdge.SelectedIndexChanged += (s, e) => UpdateMonitorMapLayout();

        chkOsHooks = new CheckBox {
            Text = "Enable Global OS Screen-Edge Capture (Works Outside Browser)",
            Location = new Point(16, 178),
            AutoSize = true,
            Checked = true,
            ForeColor = Color.FromArgb(34, 197, 94)
        };

        chkClipboard = new CheckBox {
            Text = "Synchronize OS Clipboard Text Between Computers",
            Location = new Point(16, 202),
            AutoSize = true,
            Checked = true
        };

        btnConnect = new Button {
            Text = "⚡ Pair & Enable Edge Control",
            BackColor = Color.FromArgb(34, 197, 94),
            ForeColor = Color.FromArgb(15, 23, 42),
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            FlatStyle = FlatStyle.Flat,
            Location = new Point(16, 236),
            Size = new Size(255, 38)
        };
        btnConnect.FlatAppearance.BorderSize = 0;
        btnConnect.Click += (s, e) => ConnectFromNativeDesktop();

        btnDisconnect = new Button {
            Text = "Stop / Release",
            BackColor = Color.FromArgb(239, 68, 68),
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 9f, FontStyle.Bold),
            FlatStyle = FlatStyle.Flat,
            Location = new Point(282, 236),
            Size = new Size(140, 38)
        };
        btnDisconnect.FlatAppearance.BorderSize = 0;
        btnDisconnect.Click += (s, e) => DisconnectFromNativeDesktop();

        controllerPanel.Controls.AddRange(new Control[] {
            cTitle, radioModeInternet, radioModeLan, lblTarget, txtTargetLink, lblTargetPin, txtTargetPin,
            lblEdge, cmbEdge, chkOsHooks, chkClipboard, btnConnect, btnDisconnect
        });
        this.Controls.Add(controllerPanel);

        // Right Panel: Visual Screen Arrangement Map
        monitorStage = new Panel {
            Location = new Point(472, 132),
            Size = new Size(411, 290),
            BackColor = Color.FromArgb(30, 41, 59),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };

        Label mTitle = new Label {
            Text = "🖥️ Screen Edge Arrangement & Status",
            Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
            ForeColor = Color.White,
            Location = new Point(16, 14),
            AutoSize = true
        };

        boxMonitor1 = new Panel {
            Size = new Size(165, 105),
            Location = new Point(30, 85),
            BackColor = Color.FromArgb(11, 17, 32),
            BorderStyle = BorderStyle.FixedSingle
        };
        lblMonitor1 = new Label {
            Text = "Monitor 1\n(This Computer)\nActive",
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(56, 189, 248),
            Font = new Font("Segoe UI", 9f, FontStyle.Bold)
        };
        boxMonitor1.Controls.Add(lblMonitor1);

        boxMonitor2 = new Panel {
            Size = new Size(165, 105),
            Location = new Point(215, 85),
            BackColor = Color.FromArgb(11, 17, 32),
            BorderStyle = BorderStyle.FixedSingle
        };
        lblMonitor2 = new Label {
            Text = "Monitor 2\n(Remote PC)\nRight Edge ➡️",
            TextAlign = ContentAlignment.MiddleCenter,
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(34, 197, 94),
            Font = new Font("Segoe UI", 9f, FontStyle.Bold)
        };
        boxMonitor2.Controls.Add(lblMonitor2);

        Label lblHotkeyHint = new Label {
            Text = "Tip: Move your physical mouse pointer across the configured screen border to control the 2nd computer. Press Ctrl + Alt + Q anytime to return immediately.",
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8.5f),
            Location = new Point(16, 225),
            Size = new Size(380, 52)
        };

        monitorStage.Controls.AddRange(new Control[] { mTitle, boxMonitor1, boxMonitor2, lblHotkeyHint });
        this.Controls.Add(monitorStage);

        // Bottom Event & Security Telemetry Log
        Panel logPanel = new Panel {
            Location = new Point(18, 434),
            Size = new Size(865, 190),
            BackColor = Color.FromArgb(30, 41, 59),
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
        };

        Label lblLog = new Label {
            Text = "Live OS Hook, Pairing & Encrypted Transport Telemetry:",
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            ForeColor = Color.FromArgb(148, 163, 184),
            Location = new Point(14, 10),
            AutoSize = true
        };

        txtLog = new TextBox {
            Location = new Point(14, 34),
            Size = new Size(837, 142),
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BackColor = Color.FromArgb(11, 17, 32),
            ForeColor = Color.FromArgb(203, 213, 225),
            Font = new Font("Consolas", 9f),
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
        };

        logPanel.Controls.Add(lblLog);
        logPanel.Controls.Add(txtLog);
        this.Controls.Add(logPanel);
    }

    private void BuildTrayIcon() {
        trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("Show Mouse Without Borders", null, (s, e) => {
            this.Show();
            this.WindowState = FormWindowState.Normal;
            this.Activate();
        });
        trayMenu.Items.Add("🔄 Auto-Update from GitHub (OneDesk)", null, (s, e) => TriggerGitHubAutoUpdate());
        trayMenu.Items.Add("Open Full Telemetry UI", null, (s, e) => OpenFullWorkspaceWindow());
        trayMenu.Items.Add("-");
        trayMenu.Items.Add("Exit Application", null, (s, e) => {
            CleanupAndExit();
        });

        trayIcon = new NotifyIcon {
            Text = "Mouse Without Borders — Native Desktop App",
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

    private void UpdateRolePanels() {
        receiverPanel.Visible = radioReceiver.Checked;
        controllerPanel.Visible = radioController.Checked;
    }

    private string GetSelectedEdge() {
        string raw = (cmbEdge.SelectedItem ?? "right").ToString();
        return raw.Split(' ')[0].Trim();
    }

    private void UpdateMonitorMapLayout() {
        string edge = GetSelectedEdge();
        if (edge == "right") {
            boxMonitor1.Location = new Point(30, 85);
            boxMonitor2.Location = new Point(215, 85);
            lblMonitor2.Text = "Monitor 2\n(Remote PC)\nRight Edge ➡️";
        } else if (edge == "left") {
            boxMonitor2.Location = new Point(30, 85);
            boxMonitor1.Location = new Point(215, 85);
            lblMonitor2.Text = "Monitor 2\n(Remote PC)\n⬅️ Left Edge";
        } else if (edge == "top") {
            boxMonitor2.Size = new Size(180, 75);
            boxMonitor1.Size = new Size(180, 75);
            boxMonitor2.Location = new Point(115, 45);
            boxMonitor1.Location = new Point(115, 130);
            lblMonitor2.Text = "Monitor 2 (Remote PC) ⬆️ Top Edge";
        } else if (edge == "bottom") {
            boxMonitor1.Size = new Size(180, 75);
            boxMonitor2.Size = new Size(180, 75);
            boxMonitor1.Location = new Point(115, 45);
            boxMonitor2.Location = new Point(115, 130);
            lblMonitor2.Text = "Monitor 2 (Remote PC) ⬇️ Bottom Edge";
        }
        if (edge == "left" || edge == "right") {
            boxMonitor1.Size = new Size(165, 105);
            boxMonitor2.Size = new Size(165, 105);
        }
    }

    private void AppendLog(string msg) {
        if (txtLog.InvokeRequired) {
            txtLog.BeginInvoke((MethodInvoker)delegate { AppendLog(msg); });
            return;
        }
        string line = "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + Environment.NewLine;
        txtLog.AppendText(line);
    }

    private void EnsureBackendServiceRunning() {
        try {
            using (var wc = new System.Net.WebClient()) {
                string info = wc.DownloadString("http://127.0.0.1:8765/info");
                if (!string.IsNullOrEmpty(info)) {
                    AppendLog("Connected to running Native OS Input & Relay Service on port 8765.");
                    return;
                }
            }
        } catch {}

        string serverScript = Path.Combine(baseDir, "host-server", "server.js");
        if (!File.Exists(serverScript)) {
            serverScript = Path.Combine(baseDir, "server.js");
        }
        if (!File.Exists(serverScript)) {
            AppendLog("ERROR: Could not find host-server/server.js");
            return;
        }

        try {
            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = "node",
                Arguments = "\"" + serverScript + "\"",
                WorkingDirectory = Path.GetDirectoryName(serverScript),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            serverProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };
            serverProcess.OutputDataReceived += (s, e) => {
                if (!string.IsNullOrEmpty(e.Data)) AppendLog(e.Data);
            };
            serverProcess.Start();
            serverProcess.BeginOutputReadLine();
            AppendLog("Started Native Desktop Background Service (server.js + MwbInputDriver.exe).");
        } catch (Exception ex) {
            AppendLog("Failed to start Node service: " + ex.Message);
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

    private void RefreshServiceTelemetry() {
        try {
            using (var wc = new System.Net.WebClient()) {
                string json = wc.DownloadString("http://127.0.0.1:8765/info");
                string pubUrl = ExtractJsonString(json, "publicWsUrl");
                string pin = ExtractJsonString(json, "pairingPin");
                string lanUrl = ExtractJsonString(json, "lanWsUrl");
                string activeScreen = ExtractJsonString(json, "activeScreen");
                bool hooksOk = json.Contains("\"osHooksInstalled\":true");

                if (!string.IsNullOrEmpty(pubUrl) && txtSessionLink.Text != pubUrl) {
                    txtSessionLink.Text = pubUrl;
                }
                if (!string.IsNullOrEmpty(pin) && txtSessionPin.Text != pin) {
                    txtSessionPin.Text = pin;
                }
                if (!string.IsNullOrEmpty(lanUrl)) {
                    txtLanLink.Text = lanUrl;
                }

                serviceDetailLabel.Text = hooksOk
                    ? "🟢 Native OS Hooks Installed (WH_MOUSE_LL + WH_KEYBOARD_LL) • AES-256-GCM Encrypted Relay Ready"
                    : "⚠️ Waiting for Native OS Input Driver...";

                if (activeScreen == "host") {
                    lblMonitor1.Text = "Monitor 1\n(Controller PC)\nCursor Parked";
                    lblMonitor2.Text = "Monitor 2\n(Receiver PC)\n🟢 ACTIVE INPUT";
                } else {
                    lblMonitor1.Text = "Monitor 1\n(This Computer)\n🟢 ACTIVE INPUT";
                }
            }
        } catch {}
    }

    private void RegenerateSessionLink() {
        try {
            using (var wc = new System.Net.WebClient()) {
                wc.DownloadString("http://127.0.0.1:8765/generate-link?force=true");
                AppendLog("Generated new encrypted Session ID and 6-digit Pairing PIN.");
                RefreshServiceTelemetry();
            }
        } catch (Exception ex) {
            AppendLog("Error generating link: " + ex.Message);
        }
    }

    private void ConnectFromNativeDesktop() {
        string target = txtTargetLink.Text.Trim();
        string pin = txtTargetPin.Text.Trim();
        string edge = GetSelectedEdge();
        string mode = radioModeLan.Checked ? "lan" : "internet";

        if (string.IsNullOrEmpty(target)) {
            MessageBox.Show("Please enter the Receiver's Session Link (mwb://...) or LAN IP.", "Pairing Required", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        try {
            string url = string.Format(
                "http://127.0.0.1:8765/native-connect?mode={0}&target={1}&pin={2}&edge={3}&osCapture={4}&clipboard={5}",
                Uri.EscapeDataString(mode),
                Uri.EscapeDataString(target),
                Uri.EscapeDataString(pin),
                Uri.EscapeDataString(edge),
                chkOsHooks.Checked ? "1" : "0",
                chkClipboard.Checked ? "1" : "0"
            );
            using (var wc = new System.Net.WebClient()) {
                wc.DownloadString(url);
            }
            AppendLog("Paired & armed OS screen-edge transition (" + edge.ToUpper() + " edge) -> " + target);
        } catch (Exception ex) {
            AppendLog("Connection request failed: " + ex.Message);
        }
    }

    private void DisconnectFromNativeDesktop() {
        try {
            using (var wc = new System.Net.WebClient()) {
                wc.DownloadString("http://127.0.0.1:8765/native-disconnect");
            }
            AppendLog("Stopped remote control and released OS cursor hooks.");
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

    private void CheckForGitHubUpdatesAsync(bool logIfUpToDate) {
        System.Threading.ThreadPool.QueueUserWorkItem((state) => {
            try {
                RunGitCommand("fetch origin main");
                string localSha = RunGitCommand("rev-parse HEAD");
                string remoteSha = RunGitCommand("rev-parse origin/main");
                if (!string.IsNullOrEmpty(localSha) && !string.IsNullOrEmpty(remoteSha)) {
                    bool hasNew = (localSha != remoteSha);
                    this.BeginInvoke((MethodInvoker)delegate {
                        updateAvailable = hasNew;
                        if (hasNew) {
                            string shortSha = remoteSha.Length >= 7 ? remoteSha.Substring(0, 7) : remoteSha;
                            btnAutoUpdate.Text = "⬇️ Update Ready (" + shortSha + ")";
                            btnAutoUpdate.BackColor = Color.FromArgb(34, 197, 94);
                            btnAutoUpdate.ForeColor = Color.FromArgb(15, 23, 42);
                            AppendLog("🔔 New GitHub update detected on origin/main (" + shortSha + ")! Click 'Update Ready' to install & restart.");
                        } else {
                            string shortSha = localSha.Length >= 7 ? localSha.Substring(0, 7) : localSha;
                            btnAutoUpdate.Text = "🔄 Auto-Update (" + shortSha + ")";
                            btnAutoUpdate.BackColor = Color.FromArgb(14, 165, 233);
                            if (logIfUpToDate) {
                                AppendLog("✅ Already on latest GitHub commit (" + shortSha + ").");
                            }
                        }
                    });
                }
            } catch {}
        });
    }

    private void TriggerGitHubAutoUpdate() {
        string updaterBat = Path.Combine(baseDir, "update-from-github.bat");
        if (!File.Exists(updaterBat)) {
            MessageBox.Show("update-from-github.bat was not found in " + baseDir, "Auto-Update Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        AppendLog("⬇️ Pulling latest changes from https://github.com/JustNathan25/OneDesk.git, recompiling, and restarting...");
        try {
            ProcessStartInfo psi = new ProcessStartInfo {
                FileName = "cmd.exe",
                Arguments = "/c start \"OneDesk GitHub Auto-Updater\" \"" + updaterBat + "\"",
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            Process.Start(psi);
            CleanupAndExit();
        } catch (Exception ex) {
            AppendLog("Auto-update launch error: " + ex.Message);
        }
    }

    private void OpenFullWorkspaceWindow() {
        try {
            string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            string chromePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
            if (File.Exists(edgePath)) {
                Process.Start(edgePath, "--app=http://127.0.0.1:8765 --window-size=1180,760");
            } else if (File.Exists(chromePath)) {
                Process.Start(chromePath, "--app=http://127.0.0.1:8765 --window-size=1180,760");
            } else {
                Process.Start("http://127.0.0.1:8765");
            }
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
