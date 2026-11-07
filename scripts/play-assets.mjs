// Makes the Google Play store images: the 512 px icon, the 1024 x 500 feature graphic and phone
// screenshots at 1080 x 1920 (Play refuses screenshots more than twice as tall as they are wide).
// Needs the website running on localhost:4173 (npm run build && npm run preview).
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = 'docs/play-store/images';
const URL = 'http://localhost:4173';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

// Icon.
{
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  const svg = readFileSync('public/icon.svg', 'utf8');
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="512" height="512" ')}</body></html>`);
  await page.screenshot({ path: `${OUT}/icon-512.png`, omitBackground: true });
  await page.close();
}

// Phone screenshots.
const phone = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const p = await phone.newPage();
const id = (t) => p.getByTestId(t);
const shot = (n) => p.screenshot({ path: `${OUT}/phone-${n}.png` });
await p.goto(URL);
await p.evaluate(() => localStorage.setItem('CapacitorStorage.gharnirman.prefs', JSON.stringify({ tourDone: true })));
await p.reload();
await p.waitForTimeout(600);
await shot('1-home');
await id('open-sample').click();
await id('plan-canvas').waitFor();
await p.waitForTimeout(900);
await shot('2-plan');
await id('fab-3d').click();
await id('view3d').waitFor();
await p.waitForTimeout(3500);
await shot('3-3d');
await p.goBack().catch(() => undefined);
await p.goto(URL);
await id('open-sample').click();
await id('plan-canvas').waitFor();
await id('fab-explore').click();
await id('view3d').waitFor();
await p.waitForTimeout(5000);
await shot('4-explore');
await p.goto(URL);
await id('open-sample').click();
await id('plan-canvas').waitFor();
await id('nav-more').click();
await id('more-estimate').click();
await p.waitForTimeout(800);
await shot('5-estimate');
await p.goto(URL);
await p.getByTestId('new-name').fill('My house');
await id('create-project').click();
await id('nav-rooms').click();
for (const type of ['living', 'kitchen', 'master_bedroom', 'bathroom']) {
  await id(`room-type-${type}`).click();
  await id('room-add').click();
  await p.waitForTimeout(300);
}
await p.waitForTimeout(1500);
await shot('6-rooms');
await phone.close();

// Feature graphic, using the overview picture taken above.
{
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  // A blank page may not load local files, so the picture goes in as data.
  const picture = `data:image/png;base64,${readFileSync(`${OUT}/phone-3-3d.png`).toString('base64')}`;
  const icon = readFileSync('public/icon.svg', 'utf8').replace('<svg ', '<svg width="64" height="64" ');
  await page.setContent(`<!doctype html><html><body style="margin:0">
  <div style="width:1024px;height:500px;display:flex;align-items:center;gap:36px;padding:0 56px;box-sizing:border-box;
    font-family:system-ui,'Segoe UI',Roboto,sans-serif;color:#fff;
    background:radial-gradient(120% 140% at 100% 0%,rgba(80,140,220,.35),transparent 55%),linear-gradient(135deg,#102a46,#17406b 60%,#1d4f84)">
    <div style="flex:1">
      <div style="display:flex;align-items:center;gap:14px">${icon}<span style="font-size:44px;font-weight:800">Nakshakar</span></div>
      <p style="font-size:30px;line-height:1.25;font-weight:700;margin:22px 0 12px">Plan your house.<br>Walk through it.<br>Know what it costs.</p>
      <p style="font-size:18px;color:#c4d6ec;margin:0">Feet, inches and gaj · 3D walkthrough · Vastu · Cost ranges</p>
    </div>
    <img src="${picture}" style="height:430px;border-radius:22px;border:6px solid #0b1d31;box-shadow:0 20px 50px rgba(0,0,0,.45)">
  </div></body></html>`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/feature-1024x500.png` });
  await page.close();
}
await browser.close();
console.log('written to', OUT);
