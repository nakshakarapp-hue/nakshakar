// The Windows app: the same offline bundle as the website, in its own window.
const { app, BrowserWindow, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Files shared before the rename still end in .gharnirman.
const SHARED = /\.(nakshakar|gharnirman)$/i;
let mainWindow = null;

/** Hands a double-clicked house to the page, as text; nothing else from the file system reaches it. */
function openSharedFrom(args, win) {
  const file = args.find((a) => SHARED.test(a));
  if (!file) return;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const send = `window.__openShared ? window.__openShared(${JSON.stringify(text)}) : window.addEventListener('nakshakar-ready', () => window.__openShared(${JSON.stringify(text)}), { once: true })`;
    void win.webContents.executeJavaScript(send);
  } catch {
    // A file that cannot be read is simply not opened.
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_event, args) => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  openSharedFrom(args, mainWindow);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    autoHideMenuBar: true,
    backgroundColor: '#f4f5f7',
    title: 'Nakshakar',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // The one link out is the download page for a new version, opened in the person's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SITE)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
  mainWindow = win;
  win.webContents.once('did-finish-load', () => openSharedFrom(process.argv, win));
  void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// Nothing leaves this computer except one request: the small file announcing new versions. No
// details of the person or their houses go with it.
const OWN = /^(file|data|blob|devtools|chrome-extension):/;
const SITE = 'https://nakshakarapp-hue.github.io/nakshakar/';
const allowed = (url) => OWN.test(url) || url.split('?')[0] === `${SITE}version.json`;

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, respond) =>
    respond({ cancel: !allowed(details.url) }),
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
