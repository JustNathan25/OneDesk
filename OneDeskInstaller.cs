using System;
using System.IO;
using System.Drawing;
using System.Threading;
using System.Diagnostics;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using Microsoft.Win32;

public class OneDeskInstallerForm : Form {
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    private static readonly Color BgRoot = Color.FromArgb(10, 10, 12);
    private static readonly Color BgSurface = Color.FromArgb(17, 17, 20);
    private static readonly Color BgInput = Color.FromArgb(12, 12, 15);
    private static readonly Color BorderSubtle = Color.FromArgb(34, 34, 40);
    private static readonly Color TextPrimary = Color.FromArgb(244, 244, 245);
    private static readonly Color TextMuted = Color.FromArgb(141, 141, 150);
    private static readonly Color AccentAmber = Color.FromArgb(217, 119, 6);
    private static readonly Color AccentEmerald = Color.FromArgb(16, 185, 129);

    private Panel pageWelcome;
    private Panel pageProgress;
    private Panel pageFinish;

    private TextBox txtInstallDir;
    private CheckBox chkDesktopShortcut;
    private CheckBox chkStartMenuShortcut;
    private CheckBox chkLaunchNow;

    private Label lblStepStatus;
    private Panel progressTrack;
    private Panel progressFill;
    private TextBox txtInstallLog;

    private Button btnNext;
    private Button btnCancel;
    private int currentStep = 0; // 0 = Welcome/Options, 1 = Installing, 2 = Finished
    private string sourceDir;

    public OneDeskInstallerForm() {
        sourceDir = Directory.GetCurrentDirectory();
        if (!File.Exists(Path.Combine(sourceDir, "MwbDesktopApp.cs"))) {
            sourceDir = AppDomain.CurrentDomain.BaseDirectory;
        }

        this.Text = "OneDesk Setup Wizard";
        this.Size = new Size(560, 440);
        this.FormBorderStyle = FormBorderStyle.FixedDialog;
        this.MaximizeBox = false;
        this.MinimizeBox = false;
        this.StartPosition = FormStartPosition.CenterScreen;
        this.BackColor = BgRoot;
        this.ForeColor = TextPrimary;
        this.Font = new Font("Segoe UI", 9f, FontStyle.Regular);

        try {
            int useDark = 1;
            DwmSetWindowAttribute(this.Handle, 20, ref useDark, sizeof(int));
        } catch {}

        string iconPath = Path.Combine(sourceDir, "chrome-extension", "icons", "icon128.png");
        if (File.Exists(iconPath)) {
            try {
                using (Bitmap bmp = new Bitmap(iconPath)) {
                    this.Icon = Icon.FromHandle(bmp.GetHicon());
                }
            } catch {}
        }

        BuildWizardUI();
    }

    private Button CreateFlatButton(string text, Point loc, Size size, Color bg, Color fg, Color borderCol) {
        Button b = new Button {
            Text = text,
            Location = loc,
            Size = size,
            BackColor = bg,
            ForeColor = fg,
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI Semibold", 9f, FontStyle.Bold),
            Cursor = Cursors.Hand
        };
        b.FlatAppearance.BorderColor = borderCol;
        b.FlatAppearance.BorderSize = borderCol == Color.Empty ? 0 : 1;
        return b;
    }

    private void BuildWizardUI() {
        // Top Brand Banner
        Panel topHeader = new Panel {
            Dock = DockStyle.Top,
            Height = 68,
            BackColor = BgSurface
        };
        topHeader.Paint += (s, e) => {
            using (Pen p = new Pen(BorderSubtle, 1f)) {
                e.Graphics.DrawLine(p, 0, topHeader.Height - 1, topHeader.Width, topHeader.Height - 1);
            }
        };

        Label lblBrand = new Label {
            Text = "ONEDESK SETUP",
            Font = new Font("Segoe UI", 12f, FontStyle.Bold),
            ForeColor = TextPrimary,
            Location = new Point(26, 14),
            AutoSize = true
        };

        Label lblSub = new Label {
            Text = "Seamless Multi-Computer Mouse, Keyboard & Encrypted Relay Software",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = TextMuted,
            Location = new Point(26, 38),
            AutoSize = true
        };

        topHeader.Controls.AddRange(new Control[] { lblBrand, lblSub });
        this.Controls.Add(topHeader);

        // Bottom Action Bar
        Panel bottomBar = new Panel {
            Dock = DockStyle.Bottom,
            Height = 60,
            BackColor = BgSurface
        };
        bottomBar.Paint += (s, e) => {
            using (Pen p = new Pen(BorderSubtle, 1f)) {
                e.Graphics.DrawLine(p, 0, 0, bottomBar.Width, 0);
            }
        };

        btnCancel = CreateFlatButton(
            "CANCEL",
            new Point(290, 13),
            new Size(110, 34),
            BgInput,
            TextMuted,
            BorderSubtle
        );
        btnCancel.Click += (s, e) => this.Close();

        btnNext = CreateFlatButton(
            "INSTALL NOW →",
            new Point(410, 13),
            new Size(116, 34),
            AccentAmber,
            Color.FromArgb(10, 10, 12),
            Color.Empty
        );
        btnNext.Click += (s, e) => AdvanceStep();

        bottomBar.Controls.AddRange(new Control[] { btnCancel, btnNext });
        this.Controls.Add(bottomBar);

        // PAGE 1: Welcome & Installation Folder
        pageWelcome = new Panel {
            Location = new Point(26, 84),
            Size = new Size(494, 244),
            BackColor = BgRoot
        };

        Label lblWelcomeTitle = new Label {
            Text = "Install OneDesk on this Windows PC",
            Font = new Font("Segoe UI Semibold", 11f, FontStyle.Bold),
            ForeColor = TextPrimary,
            Location = new Point(0, 4),
            AutoSize = true
        };

        Label lblWelcomeDesc = new Label {
            Text = "This wizard will install OneDesk, configure native Windows OS screen-edge hooks (WH_MOUSE_LL / WH_KEYBOARD_LL), and add shortcuts to your computer.",
            Font = new Font("Segoe UI", 9f),
            ForeColor = TextMuted,
            Location = new Point(0, 30),
            Size = new Size(488, 38)
        };

        Label lblFolder = new Label {
            Text = "DESTINATION FOLDER",
            Font = new Font("Consolas", 8f, FontStyle.Bold),
            ForeColor = TextMuted,
            Location = new Point(0, 82),
            AutoSize = true
        };

        string defaultInstallDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs",
            "OneDesk"
        );

        txtInstallDir = new TextBox {
            Text = defaultInstallDir,
            Location = new Point(0, 102),
            Size = new Size(396, 26),
            BackColor = BgInput,
            ForeColor = TextPrimary,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Consolas", 9.5f)
        };

        Button btnBrowse = CreateFlatButton(
            "BROWSE",
            new Point(404, 101),
            new Size(86, 27),
            BgSurface,
            TextPrimary,
            BorderSubtle
        );
        btnBrowse.Font = new Font("Consolas", 8f, FontStyle.Bold);
        btnBrowse.Click += (s, e) => {
            using (FolderBrowserDialog fbd = new FolderBrowserDialog()) {
                fbd.SelectedPath = txtInstallDir.Text;
                if (fbd.ShowDialog() == DialogResult.OK) {
                    txtInstallDir.Text = Path.Combine(fbd.SelectedPath, "OneDesk");
                }
            }
        };

        chkDesktopShortcut = new CheckBox {
            Text = "Create a Desktop shortcut (OneDesk)",
            Location = new Point(2, 148),
            AutoSize = true,
            Checked = true,
            ForeColor = TextPrimary
        };

        chkStartMenuShortcut = new CheckBox {
            Text = "Add OneDesk to Windows Start Menu & Programs list",
            Location = new Point(2, 176),
            AutoSize = true,
            Checked = true,
            ForeColor = TextPrimary
        };

        pageWelcome.Controls.AddRange(new Control[] {
            lblWelcomeTitle, lblWelcomeDesc, lblFolder, txtInstallDir, btnBrowse,
            chkDesktopShortcut, chkStartMenuShortcut
        });
        this.Controls.Add(pageWelcome);

        // PAGE 2: Installation Progress
        pageProgress = new Panel {
            Location = new Point(26, 84),
            Size = new Size(494, 244),
            BackColor = BgRoot,
            Visible = false
        };

        lblStepStatus = new Label {
            Text = "Preparing installation...",
            Font = new Font("Segoe UI Semibold", 10f, FontStyle.Bold),
            ForeColor = TextPrimary,
            Location = new Point(0, 8),
            AutoSize = true
        };

        progressTrack = new Panel {
            Location = new Point(0, 38),
            Size = new Size(490, 10),
            BackColor = BgSurface
        };
        progressFill = new Panel {
            Location = new Point(0, 0),
            Size = new Size(10, 10),
            BackColor = AccentAmber
        };
        progressTrack.Controls.Add(progressFill);

        txtInstallLog = new TextBox {
            Location = new Point(0, 62),
            Size = new Size(490, 170),
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            BackColor = BgInput,
            ForeColor = TextMuted,
            BorderStyle = BorderStyle.FixedSingle,
            Font = new Font("Consolas", 8.5f)
        };

        pageProgress.Controls.AddRange(new Control[] { lblStepStatus, progressTrack, txtInstallLog });
        this.Controls.Add(pageProgress);

        // PAGE 3: Finish Page
        pageFinish = new Panel {
            Location = new Point(26, 84),
            Size = new Size(494, 244),
            BackColor = BgRoot,
            Visible = false
        };

        Label lblDoneBadge = new Label {
            Text = "● INSTALLATION COMPLETE",
            Font = new Font("Consolas", 9f, FontStyle.Bold),
            ForeColor = AccentEmerald,
            Location = new Point(0, 12),
            AutoSize = true
        };

        Label lblDoneTitle = new Label {
            Text = "OneDesk has been installed on your computer.",
            Font = new Font("Segoe UI Semibold", 11.5f, FontStyle.Bold),
            ForeColor = TextPrimary,
            Location = new Point(0, 38),
            AutoSize = true
        };

        Label lblDoneDesc = new Label {
            Text = "You can launch OneDesk anytime from your Windows Desktop or Start Menu, and update it with one click using the built-in GIT SYNC button.",
            Font = new Font("Segoe UI", 9f),
            ForeColor = TextMuted,
            Location = new Point(0, 68),
            Size = new Size(480, 42)
        };

        chkLaunchNow = new CheckBox {
            Text = "Launch OneDesk now",
            Font = new Font("Segoe UI Semibold", 9.5f, FontStyle.Bold),
            ForeColor = TextPrimary,
            Location = new Point(2, 130),
            AutoSize = true,
            Checked = true
        };

        pageFinish.Controls.AddRange(new Control[] { lblDoneBadge, lblDoneTitle, lblDoneDesc, chkLaunchNow });
        this.Controls.Add(pageFinish);
    }

    private void UpdateProgressUI(string status, int percent) {
        if (this.InvokeRequired) {
            this.BeginInvoke((MethodInvoker)delegate { UpdateProgressUI(status, percent); });
            return;
        }
        lblStepStatus.Text = status;
        int w = (int)Math.Round((percent / 100.0) * progressTrack.Width);
        progressFill.Width = Math.Max(8, Math.Min(progressTrack.Width, w));
        txtInstallLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + status + Environment.NewLine);
    }

    private void AdvanceStep() {
        if (currentStep == 0) {
            currentStep = 1;
            pageWelcome.Visible = false;
            pageProgress.Visible = true;
            btnNext.Enabled = false;
            btnCancel.Enabled = false;

            string targetDir = txtInstallDir.Text.Trim();
            bool makeDesktop = chkDesktopShortcut.Checked;
            bool makeStartMenu = chkStartMenuShortcut.Checked;

            Thread worker = new Thread(() => RunInstallation(targetDir, makeDesktop, makeStartMenu));
            worker.IsBackground = true;
            worker.Start();
        } else if (currentStep == 2) {
            string targetDir = txtInstallDir.Text.Trim();
            if (chkLaunchNow.Checked) {
                try {
                    string ps1 = Path.Combine(targetDir, "OneDesk.ps1");
                    string psExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
                    Process.Start(new ProcessStartInfo {
                        FileName = psExe,
                        Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + ps1 + "\"",
                        WorkingDirectory = targetDir,
                        UseShellExecute = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    });
                } catch {}
            }
            this.Close();
        }
    }

    private static void CopyDirectoryRecursive(string src, string dst) {
        Directory.CreateDirectory(dst);
        foreach (string file in Directory.GetFiles(src)) {
            string name = Path.GetFileName(file);
            if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
            string destFile = Path.Combine(dst, name);
            if (File.Exists(destFile)) {
                try { File.SetAttributes(destFile, FileAttributes.Normal); } catch {}
            }
            File.Copy(file, destFile, true);
        }
        foreach (string dir in Directory.GetDirectories(src)) {
            string dirName = Path.GetFileName(dir);
            if (string.Equals(dirName, "node_modules", StringComparison.OrdinalIgnoreCase)) continue;
            CopyDirectoryRecursive(dir, Path.Combine(dst, dirName));
        }
    }

    private void CreateWindowsShortcut(string shortcutPath, string targetDir) {
        try {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            Type scType = shortcut.GetType();
            string psExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            scType.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { psExe });
            scType.InvokeMember("Arguments", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + Path.Combine(targetDir, "OneDesk.ps1") + "\"" });
            scType.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { targetDir });
            scType.InvokeMember("Description", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { "OneDesk - Seamless Multi-PC Mouse & Keyboard" });
            scType.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, shortcut, null);
        } catch {}
    }

    private void RunInstallation(string targetDir, bool makeDesktop, bool makeStartMenu) {
        try {
            UpdateProgressUI("Checking for active OneDesk processes...", 12);
            int myPid = Process.GetCurrentProcess().Id;
            try {
                Process pStop = Process.Start(new ProcessStartInfo {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -WindowStyle Hidden -Command \"Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne " + myPid + " -and (($_.Name -eq 'node.exe' -and $_.CommandLine -like '*server.js*') -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*OneDesk.ps1*')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }\"",
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
                pStop.WaitForExit(3500);
            } catch {}

            UpdateProgressUI("Installing application files to " + targetDir + "...", 35);
            if (!string.Equals(Path.GetFullPath(sourceDir).TrimEnd('\\'), Path.GetFullPath(targetDir).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) {
                CopyDirectoryRecursive(sourceDir, targetDir);
            }

            UpdateProgressUI("Clearing Smart App Control Zone.Identifier flags...", 55);
            try {
                Process pUnblock = Process.Start(new ProcessStartInfo {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -WindowStyle Hidden -Command \"Get-ChildItem -Path '" + targetDir.Replace("'", "''") + "' -Recurse | Unblock-File -ErrorAction SilentlyContinue\"",
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
                pUnblock.WaitForExit(5000);
            } catch {}

            string nodeModulesDir = Path.Combine(targetDir, "host-server", "node_modules");
            if (!Directory.Exists(nodeModulesDir)) {
                UpdateProgressUI("Installing Node.js transport packages (ws, mqtt)...", 72);
                string srcNodeModules = Path.Combine(sourceDir, "host-server", "node_modules");
                if (Directory.Exists(srcNodeModules)) {
                    Process pRobo = Process.Start(new ProcessStartInfo {
                        FileName = "robocopy.exe",
                        Arguments = "\"" + srcNodeModules + "\" \"" + nodeModulesDir + "\" /E /NFL /NDL /NJH /NJS /NC /NS /NP",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    });
                    pRobo.WaitForExit(20000);
                } else {
                    Process pNpm = Process.Start(new ProcessStartInfo {
                        FileName = "cmd.exe",
                        Arguments = "/c npm install --no-audit --no-fund",
                        WorkingDirectory = Path.Combine(targetDir, "host-server"),
                        UseShellExecute = false,
                        CreateNoWindow = true
                    });
                    pNpm.WaitForExit(60000);
                }
            }

            if (makeDesktop) {
                UpdateProgressUI("Creating Windows Desktop shortcut...", 85);
                string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "OneDesk.lnk");
                CreateWindowsShortcut(desktopLnk, targetDir);
            }

            if (makeStartMenu) {
                UpdateProgressUI("Registering in Windows Start Menu & Installed Apps...", 94);
                string startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "OneDesk");
                Directory.CreateDirectory(startMenuDir);
                CreateWindowsShortcut(Path.Combine(startMenuDir, "OneDesk.lnk"), targetDir);

                try {
                    using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\OneDesk")) {
                        if (key != null) {
                            key.SetValue("DisplayName", "OneDesk — Multi-Computer Mouse & Keyboard");
                            key.SetValue("DisplayVersion", "2.0.0");
                            key.SetValue("Publisher", "JustNathan25");
                            key.SetValue("InstallLocation", targetDir);
                            key.SetValue("UninstallString", "cmd.exe /c rmdir /s /q \"" + targetDir + "\"");
                            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                        }
                    }
                } catch {}
            }

            UpdateProgressUI("Installation completed successfully.", 100);
            Thread.Sleep(500);

            this.BeginInvoke((MethodInvoker)delegate {
                currentStep = 2;
                pageProgress.Visible = false;
                pageFinish.Visible = true;
                progressFill.BackColor = AccentEmerald;
                btnNext.Text = "FINISH";
                btnNext.BackColor = AccentEmerald;
                btnNext.Enabled = true;
            });
        } catch (Exception ex) {
            UpdateProgressUI("ERROR: " + ex.Message, 100);
            this.BeginInvoke((MethodInvoker)delegate {
                btnCancel.Enabled = true;
                btnCancel.Text = "CLOSE";
            });
        }
    }

    [STAThread]
    public static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new OneDeskInstallerForm());
    }
}
