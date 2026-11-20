# OneDesk — Mouse Without Borders Native Desktop App (LAN & Encrypted Internet)

Connect two or more computers over the **Internet** or **Local Network (LAN)** so one computer's physical mouse and keyboard seamlessly control the other computer across the entire operating system — not just inside a browser tab.

## 1. One-Command Install on Your 2nd Computer (via GitHub)

Instead of manually copying files, run this once on your 2nd computer:

```powershell
git clone https://github.com/JustNathan25/OneDesk.git
cd OneDesk
.\install-desktop-app.bat
```

## 2. One-Click Auto-Update Inside the Desktop App

Whenever new changes are pushed to `https://github.com/JustNathan25/OneDesk.git`:
- **`MouseWithoutBordersApp.exe`** automatically checks `origin/main` in the background every 45 seconds.
- When a new commit is pushed to GitHub, the top-bar button turns green (`⬇️ Update Ready (<commit>)`).
- Clicking **`🔄 Auto-Update (GitHub)`** (in the top bar or System Tray menu) runs [`update-from-github.bat`](file:///c:/Users/flicker/.gemini/antigravity/scratch/lan-kvm-extension/update-from-github.bat), which:
  1. Safely stops `MouseWithoutBordersApp.exe`, `MwbInputDriver.exe`, and `server.js`.
  2. Pulls the latest changes from `https://github.com/JustNathan25/OneDesk.git` (`main`).
  3. Recompiles `MouseWithoutBordersApp.exe` and `MwbInputDriver.exe`.
  4. Automatically relaunches `MouseWithoutBordersApp.exe`.
