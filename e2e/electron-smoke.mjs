/* global process, setTimeout, console, indexedDB */
// Starts the packaged Windows app and checks it opens a project with no network beyond the update check.
// Run after electron-builder.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = 9333;
// Editors built on Electron set this, and it would make the app start as plain Node.
const withoutRunAsNode = { ...process.env };
delete withoutRunAsNode.ELECTRON_RUN_AS_NODE;
const child = spawn('release/desktop/win-unpacked/Nakshakar.exe', [`--remote-debugging-port=${PORT}`], { stdio: 'ignore', env: withoutRunAsNode });

let browser = null;
for (let tries = 0; tries < 60 && !browser; tries++) {
  await new Promise((r) => setTimeout(r, 500));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
}
if (!browser) {
  child.kill();
  console.error('The app did not open a debug port');
  process.exit(1);
}

let page = browser.contexts()[0]?.pages()[0];
for (let tries = 0; tries < 40 && !page; tries++) {
  await new Promise((r) => setTimeout(r, 250));
  page = browser.contexts()[0]?.pages()[0];
}

const foreign = [];
const errors = [];
// The one request allowed out is the small file that announces new versions.
const UPDATE_FILE = 'https://nakshakarapp-hue.github.io/nakshakar/version.json';
page.on('request', (r) => {
  if (!/^(file|data|blob|devtools):/.test(r.url()) && r.url().split('?')[0] !== UPDATE_FILE) foreign.push(r.url());
});
page.on('pageerror', (e) => errors.push(e.message));

let shown = '';
let saved = 0;
try {
  await page.getByTestId('open-sample').click({ timeout: 30000 });
  await page.getByTestId('plan-canvas').waitFor({ timeout: 30000 });
  await page.getByTestId('go-explore').click();
  await page.getByTestId('joystick').waitFor({ timeout: 30000 });
  const distance = page.getByTestId('distance');
  await distance.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/shots/electron-explore.png' });
  shown = await distance.innerText();
  await page.getByTestId('back-editor').click();
  await page.waitForTimeout(1500);
  saved = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('gharnirman');
        open.onsuccess = () => {
          const req = open.result.transaction('projects').objectStore('projects').count();
          req.onsuccess = () => resolve(req.result);
        };
      }),
  );
} catch (err) {
  errors.push(String(err));
}
await browser.close().catch(() => undefined);
child.kill();
console.log(JSON.stringify({ url: page.url().slice(0, 40), shown, saved, foreign, errors }));
process.exit(foreign.length || errors.length || !saved ? 1 : 0);
