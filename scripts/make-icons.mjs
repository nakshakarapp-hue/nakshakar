// Renders public/icon.svg into the Android launcher icons. Run with: node scripts/make-icons.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/icon.svg', 'utf8');
const inner = svg.replace(/<rect[^>]*\/>/, '');
const SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const browser = await chromium.launch();
const shot = async (html, size, path) => {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${html}</body>`);
  await page.screenshot({ path, omitBackground: true });
  await page.close();
};

for (const [density, size] of Object.entries(SIZES)) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  mkdirSync(dir, { recursive: true });
  const square = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await shot(square, size, `${dir}/ic_launcher.png`);
  const round = `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden">${square}</div>`;
  await shot(round, size, `${dir}/ic_launcher_round.png`);
  // Adaptive icon foreground: the artwork inside the 66% safe zone, on the launcher's own background.
  const full = FOREGROUND[density];
  const art = inner.replace('<svg ', `<svg width="${full * 0.66}" height="${full * 0.66}" `);
  await shot(`<div style="width:${full}px;height:${full}px;display:grid;place-items:center">${art}</div>`, full, `${dir}/ic_launcher_foreground.png`);
}
// Website and desktop icons.
mkdirSync('build', { recursive: true });
for (const [size, path] of [[192, 'public/icon-192.png'], [512, 'public/icon-512.png'], [512, 'build/icon.png']]) {
  await shot(svg.replace('<svg ', `<svg width="${size}" height="${size}" `), size, path);
}
// Splash screens: every existing image is redrawn at its own size, brand colour with the icon in the middle.
const NAVY = '#1f3a5f';
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
const roots = ['android/app/src/main/res', 'ios/App/App/Assets.xcassets/Splash.imageset'].filter((d) => existsSync(d));
for (const file of roots.flatMap(walk).filter((f) => /\/splash[^/]*\.png$/.test(f))) {
  const png = readFileSync(file);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const side = Math.round(Math.min(width, height) * 0.32);
  const art = svg.replace('<svg ', `<svg width="${side}" height="${side}" `);
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><body style="margin:0;width:${width}px;height:${height}px;background:${NAVY};display:grid;place-items:center">${art}</body>`);
  await page.screenshot({ path: file });
  await page.close();
}

// iOS wants one opaque 1024 px icon.
const iosIcon = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
if (existsSync(iosIcon)) {
  const art = inner.replace('<svg ', '<svg width="760" height="760" ');
  await shot(`<div style="width:1024px;height:1024px;background:${NAVY};display:grid;place-items:center">${art}</div>`, 1024, iosIcon);
}

// The launcher background and app colours match the icon.
writeFileSync(
  'android/app/src/main/res/values/ic_launcher_background.xml',
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1F3A5F</color>\n</resources>\n`,
);
const colors = 'android/app/src/main/res/values/colors.xml';
writeFileSync(
  colors,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="colorPrimary">#1F3A5F</color>\n    <color name="colorPrimaryDark">#16293F</color>\n    <color name="colorAccent">#F4A340</color>\n</resources>\n`,
);
await browser.close();
