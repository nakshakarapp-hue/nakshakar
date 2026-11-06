// Takes the screenshots used by the user guide. Needs the website running on localhost:4173.
import { mkdirSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const OUT = process.argv[2] ?? 'docs/manual-images';
mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:4173';
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args });
const shot = (page, name, options = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...options });

const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await context.newPage();
const id = (t) => page.getByTestId(t);
const canvas = async () => id('plan-canvas').boundingBox();

// A new plan.
await page.goto(URL);
await id('new-name').fill('Sharma house');
await id('create-project').click();
// The guided first run, then the room wizard from the menu.
await id('tour').waitFor();
await page.waitForTimeout(400);
await shot(page, 'tour');
await id('tour-skip').click();
await id('top-menu').click();
await id('more-wizard').click();
await shot(page, 'wizard');
await page.keyboard.press('Escape');

// Rooms one after another, with the panel open beside the plan.
await id('tool-rooms').click();
for (const type of ['living', 'kitchen', 'bedroom', 'bathroom']) {
  await id(`room-type-${type}`).click();
  await id('room-add').click();
  await page.waitForTimeout(250);
}
await id('room-type-dining').click();
await page.waitForTimeout(2500);
await shot(page, 'rooms-panel');
await id('rooms-done').click();
for (let i = 0; i < 4; i++) await id('undo').click();

// Mouse drawing, mid-stroke.
await page.keyboard.press('w');
let box = await canvas();
await page.mouse.click(box.x + 320, box.y + 170);
await page.waitForTimeout(400);
await page.mouse.move(box.x + 760, box.y + 170, { steps: 4 });
await page.waitForTimeout(250);
await shot(page, 'draw-walls');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

await id('top-menu').click();
await id('more-perimeter').click();
await page.waitForTimeout(150);
await shot(page, 'perimeter');
await page.keyboard.press('Escape');
await id('top-menu').click();
await id('more-plot').click();
await shot(page, 'plot');
await page.keyboard.press('Escape');
await id('top-menu').click();
await id('more-converter').click();
await id('converter-input').fill('12\'6"');
await page.waitForTimeout(150);
await shot(page, 'converter');
await page.keyboard.press('Escape');

// Home with a project in the list.
await id('back-home').click();
await id('project-list').waitFor();
await page.waitForTimeout(250);
await shot(page, 'home');

// The sample house.
await id('open-sample').click();
await id('plan-canvas').waitFor();
await page.waitForTimeout(500);
await shot(page, 'plan');

// A wall with its handles and length label.
box = await canvas();
await id('fit-view').click();
await page.waitForTimeout(150);
for (let x = box.width * 0.42; x < box.width * 0.62; x += 5) {
  await page.mouse.click(box.x + x, box.y + box.height * 0.1);
  await page.waitForTimeout(40);
  if (await id('length-chip').isVisible()) break;
}
if (!(await id('length-chip').isVisible())) {
  for (let y = 30; y < box.height * 0.3; y += 5) {
    await page.mouse.click(box.x + box.width * 0.45, box.y + y);
    await page.waitForTimeout(40);
    if (await id('length-chip').isVisible()) break;
  }
}
await page.waitForTimeout(250);
await shot(page, 'wall-selected');
await page.keyboard.press('Escape');

// A room's properties.
// Furniture takes the click if it is in the way, so this looks for bare floor.
search: for (let fy = 0.3; fy < 0.75; fy += 0.03) {
  for (let fx = 0.3; fx < 0.7; fx += 0.03) {
    await page.keyboard.press('Escape');
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(60);
    if (await id('room-area').isVisible()) break search;
  }
}
await page.waitForTimeout(300);
await shot(page, 'room-selected');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);

await id('tool-object').click();
await page.waitForTimeout(150);
await shot(page, 'catalog');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

await id('floor-add').click();
await page.waitForTimeout(150);
await shot(page, 'floors');
await id('add-floor').click();
await page.waitForTimeout(350);
await shot(page, 'floors-add');
await page.keyboard.press('Escape');
await page.keyboard.press('?');
await page.waitForTimeout(150);
await shot(page, 'shortcuts');
await page.keyboard.press('Escape');
await id('top-menu').click();
await id('more-site').click();
await page.waitForTimeout(150);
await shot(page, 'site');
await page.keyboard.press('Escape');
await id('top-menu').click();
await id('more-versions').click();
await id('version-name').fill('Before client changes');
await id('version-save').click();
await page.waitForTimeout(300);
await shot(page, 'versions');
await page.keyboard.press('Escape');

// The picture library, one section at a time.
await id('tool-door').click();
for (const tab of ['doors', 'windows', 'stairs', 'plants', 'furniture']) {
  await id(`lib-tab-${tab}`).click();
  await page.locator('.library-card span.item-thumb.empty').first().waitFor({ state: 'detached', timeout: 60000 });
  await page.waitForTimeout(250);
  await shot(page, `library-${tab}`);
}
await page.keyboard.press('Escape');
await id('tool-select').click();

// Painting on the plan.
await id('tool-paint').click();
await id('paint-sky').click();
await page.waitForTimeout(250);
await shot(page, 'paint-plan');
await id('tool-select').click();

// 3D.
await id('go-3d').click();
await id('view3d').waitFor();
await page.waitForTimeout(3000);
await shot(page, '3d-outside');
await id('view-options').click();
await id('cutaway').selectOption({ index: 0 });
await page.waitForTimeout(2000);
await id('view-options').click();
await shot(page, '3d-cutaway');
await id('view-options').click();
await id('cutaway').selectOption({ index: 2 });
await page.waitForTimeout(800);
await id('toggle-night').click();
await id('view-options').click();
await page.waitForTimeout(1500);
await shot(page, '3d-night');
await id('view-options').click();
await id('toggle-night').click();
await id('view-options').click();
await id('tool3d-paint').click();
await page.waitForTimeout(400);
await shot(page, '3d-paint');
await id('tool3d-paint').click();
await id('mode-walk').click();
await page.waitForTimeout(1800);
await shot(page, '3d-walk');
await id('toggle-opening').click();
await page.waitForTimeout(1200);
await shot(page, '3d-door-open');
await page.keyboard.down('w');
await page.waitForTimeout(2600);
await page.keyboard.up('w');
await page.waitForTimeout(1200);
await shot(page, '3d-walk-inside');
await id('mode-vr').click();
await page.waitForTimeout(1800);
await shot(page, '3d-vr');
await id('exit-vr').click();
await id('back-editor').click();

// The Explore page.
await id('go-explore').click();
await id('distance').waitFor();
await page.waitForTimeout(2000);
await shot(page, 'explore-start');
await page.keyboard.down('w');
await page.keyboard.down('Shift');
await page.waitForTimeout(6500);
await page.keyboard.up('Shift');
await page.waitForTimeout(350);
await shot(page, 'explore-walk');
await page.keyboard.up('w');
await id('back-editor').click();

// Reports.
await id('go-vastu').click();
await id('vastu-score').waitFor();
await page.waitForTimeout(200);
await shot(page, 'vastu');
await id('back-editor').click();
await id('go-estimate').click();
await id('estimate-total').waitFor();
await page.waitForTimeout(200);
await shot(page, 'estimate');
for (const tab of ['materials', 'schedule', 'rates']) {
  await id(`estimate-tab-${tab}`).click();
  await page.waitForTimeout(200);
  await shot(page, `estimate-${tab}`);
}
await id('back-editor').click();
await id('go-print').click();
await id('print-preview').locator('svg').first().waitFor();
await page.waitForTimeout(200);
await shot(page, 'print');
const download = page.waitForEvent('download');
await id('make-pdf').click();
await (await download).saveAs(`${OUT}/sample-report.pdf`);
await id('back-editor').click();

// Language and theme.
await id('back-home').click();
await id('home-settings').click();
await id('language').selectOption('te');
await page.keyboard.press('Escape');
await id('open-project').first().click();
await id('plan-canvas').waitFor();
await page.waitForTimeout(500);
await shot(page, 'telugu');
await id('back-home').click();
await id('home-settings').click();
await id('language').selectOption('hi');
await id('theme').selectOption('dark');
await page.keyboard.press('Escape');
await id('open-project').first().click();
await id('plan-canvas').waitFor();
await page.waitForTimeout(500);
await shot(page, 'dark-hindi');
await context.close();

// Phone.
const phone = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2 });
const p = await phone.newPage();
await p.goto(URL);
await p.getByTestId('open-sample').click();
await p.getByTestId('plan-canvas').waitFor();
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/phone-plan.png` });
await p.getByTestId('nav-add').click();
await p.getByTestId('lib-tab-doors').click();
await p.locator('.library-card img.item-thumb').nth(3).waitFor({ timeout: 60000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/phone-library.png` });
await p.getByRole('button', { name: /^close$/i }).click();
await p.getByTestId('nav-more').click();
await p.waitForTimeout(250);
await p.screenshot({ path: `${OUT}/phone-more.png` });
await p.getByRole('button', { name: /^close$/i }).click();
await p.getByTestId('fab-explore').click();
await p.getByTestId('distance').waitFor();
await p.waitForTimeout(2200);
await p.screenshot({ path: `${OUT}/phone-explore.png` });
await p.getByTestId('back-editor').click();
await p.getByTestId('fab-3d').click();
await p.getByTestId('view3d').waitFor();
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/phone-3d.png` });
await p.getByTestId('back-editor').click();

// Adding room after room on a phone, from an empty project.
await p.goto(URL);
await p.getByTestId('new-name').fill('Room after room');
await p.getByTestId('create-project').click();
await p.getByTestId('tour-skip').click({ timeout: 4000 }).catch(() => undefined);
await p.getByTestId('nav-rooms').click();
for (const type of ['living', 'kitchen', 'master_bedroom', 'bathroom', 'dining']) {
  await p.getByTestId(`room-type-${type}`).click();
  await p.getByTestId('room-add').click();
  await p.waitForTimeout(300);
}
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/phone-rooms.png` });
await phone.close();

// Sizes, stairs, slabs, Recent and sharing, in a fresh browser.
const fresh = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2, acceptDownloads: true });
const f = await fresh.newPage();
const fid = (t) => f.getByTestId(t);
await f.goto(URL);
await fid('new-name').fill('Sizes');
await fid('create-project').click();
await f.getByTestId('tour-skip').click({ timeout: 4000 }).catch(() => undefined);
await f.waitForTimeout(300);
const place = async (x, y) => {
  const b = await fid('plan-canvas').boundingBox();
  await f.mouse.move(b.x + x, b.y + y);
  await f.waitForTimeout(120);
  await f.mouse.click(b.x + x, b.y + y);
  await f.waitForTimeout(300);
};
await fid('tool-object').click();
await fid('lib-tab-furniture').click();
await fid('catalog-sofa_3').click();
await place(560, 340);
await f.waitForTimeout(250);
await shot(f, 'object-selected');
await f.keyboard.type('9');
await fid('size-popover').waitFor();
await f.waitForTimeout(250);
await shot(f, 'size-popover');
await fid('size-done').click();
await f.keyboard.press('Delete');

await fid('tool-stair').click();
await fid('catalog-stair_straight').click();
{
  const b = await fid('plan-canvas').boundingBox();
  await f.mouse.move(b.x + 560, b.y + 340);
  await fid('place-rotate').click();
  await f.mouse.move(b.x + 570, b.y + 340);
  await f.waitForTimeout(250);
  await shot(f, 'stair-before-placing');
}
await place(570, 340);
await fid('stair-dir-90').click();
await f.waitForTimeout(350);
await shot(f, 'stair-selected');
await f.keyboard.press('Delete');

await fid('tool-all').click();
await fid('lib-tab-structure').click();
await fid('lib-tool-slab').click();
{
  const b = await fid('plan-canvas').boundingBox();
  await f.mouse.move(b.x + 330, b.y + 190);
  await f.mouse.down();
  await f.mouse.move(b.x + 760, b.y + 480, { steps: 5 });
  await f.mouse.up();
}
await f.waitForTimeout(350);
await shot(f, 'slab-selected');
await f.keyboard.press('Delete');

await fid('tool-all').click();
await f.locator('.library-card span.item-thumb.empty').first().waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
await f.waitForTimeout(500);
await shot(f, 'library-recent');
await f.keyboard.press('Escape');
await f.keyboard.press('Escape');

await fid('back-home').click();
await fid('open-sample').click();
await fid('plan-canvas').waitFor();
const [sent] = await Promise.all([f.waitForEvent('download'), fid('go-share').click()]);
const sharedPath = await sent.path();
const friend = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
const g = await friend.newPage();
await g.goto(URL);
await g.getByTestId('shared-file').setInputFiles(sharedPath);
await g.getByTestId('shared-card').waitFor();
await g.waitForTimeout(250);
await g.screenshot({ path: `${OUT}/shared-dialog.png` });
await g.getByTestId('shared-view').click();
await g.getByTestId('shared-banner').waitFor();
await g.waitForTimeout(500);
await g.screenshot({ path: `${OUT}/shared-view.png` });
await friend.close();
await fresh.close();
await browser.close();
