import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import {
  canvasBox,
  dragOnCanvas,
  newProject,
  openSample,
  storedProjects,
  tapCanvas,
  waitForSaved,
} from './helpers';

const SHOTS = 'test-results/shots';
const openMenu = async (page: Page, item: string) => {
  await page.getByTestId('top-menu').click();
  await page.getByTestId(`more-${item}`).click();
};
mkdirSync(SHOTS, { recursive: true });

test.describe('offline and privacy', () => {
  test('makes no network requests beyond its own files, and works in airplane mode', async ({
    page,
    context,
    baseURL,
  }) => {
    const foreign: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith(baseURL!) && !r.url().startsWith('data:') && !r.url().startsWith('blob:'))
        foreign.push(r.url());
    });
    await page.goto('/');
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('plan-canvas')).toBeVisible();
    // Everything lazy loads now, then the network goes away for good.
    await page.getByTestId('go-3d').click();
    await expect(page.getByTestId('view3d')).toBeVisible();
    await page.getByTestId('back-editor').click();
    await page.getByTestId('go-print').click();
    await expect(page.getByTestId('print-screen')).toBeVisible();
    await page.getByTestId('back-editor').click();
    await context.setOffline(true);
    await page.getByTestId('go-vastu').click();
    await expect(page.getByTestId('vastu-score')).not.toHaveText('–');
    await page.getByTestId('back-editor').click();
    await page.getByTestId('go-estimate').click();
    await expect(page.getByTestId('estimate-total')).toBeVisible();
    expect(foreign).toEqual([]);
  });
});

test.describe('library', () => {
  test('every door, window, stair, wall, pillar and plant has a picture', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' && m.text().includes('thumb failed')) warnings.push(m.text());
    });
    await openSample(page);
    await page.getByTestId('tool-door').click();
    for (const tab of ['doors', 'windows', 'stairs', 'plants', 'walls', 'structure', 'furniture']) {
      await page.getByTestId(`lib-tab-${tab}`).click();
      await expect(page.locator('.library-card span.item-thumb.empty')).toHaveCount(0, { timeout: 60000 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/library-${tab}.png` });
      const blank = await page.locator('.library-card img.item-thumb').evaluateAll(
        (list) =>
          list.filter((el) => {
            const img = el as HTMLImageElement;
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const x = c.getContext('2d')!;
            x.drawImage(img, 0, 0);
            const data = x.getImageData(0, 0, c.width, c.height).data;
            for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return false;
            return true;
          }).length,
      );
      expect(blank, tab).toBe(0);
    }
    expect(warnings).toEqual([]);
  });
});

/** Metres from the house in Explore. The label goes once the player is at the house, which counts as 0. */
const distanceNow = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="distance"]');
    return Number(el?.textContent?.match(/\d+/)?.[0] ?? 0);
  });

test.describe('version 2: the fixes asked for', () => {
  type Walls = { floors: { walls: { start: { x: number }; end: { x: number } }[] }[] };

  test('undo on the first floor never takes back the ground floor', async ({ page }) => {
    await newProject(page, 'Undo per floor');
    // Ground floor first.
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [300, 200], [500, 350]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    // Then a first floor, with its own change.
    await page.getByTestId('floor-add').click();
    await page.getByTestId('add-floor').click();
    await page.getByTestId('add-floor-empty').click();
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [600, 200], [800, 350]);
    await waitForSaved(page, (p) => p.floors[1]?.walls.length === 4);
    // Undo twice here, once with the button and once with the keyboard.
    await page.getByTestId('undo').click();
    await waitForSaved(page, (p) => p.floors[1].walls.length === 0);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    const [p] = await storedProjects(page);
    expect(p.floors[0].walls).toHaveLength(4);
    expect(p.floors[1].walls).toHaveLength(0);
  });

  test('a wall dragged longer stays longer, even with its length box open', async ({ page }) => {
    await newProject(page, 'Drag stays');
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [300, 200], [500, 350]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    await tapCanvas(page, [400, 200]);
    await page.getByTestId('length-chip').click();
    await expect(page.getByTestId('wall-length-input')).toBeFocused();
    const before = (await storedProjects(page))[0] as unknown as Walls;
    const width = (w: Walls) =>
      Math.max(...w.floors[0].walls.flatMap((x) => [x.start.x, x.end.x])) -
      Math.min(...w.floors[0].walls.flatMap((x) => [x.start.x, x.end.x]));
    // Drag the right-hand end further right on the plan.
    await dragOnCanvas(page, [500, 200], [600, 200]);
    await waitForSaved(page, (p) => width(p as unknown as Walls) > width(before) + 200);
    // Leaving the box must not put the old length back.
    await page.getByTestId('length-done').click();
    await page.waitForTimeout(800);
    expect(width((await storedProjects(page))[0] as unknown as Walls)).toBeGreaterThan(width(before) + 200);
  });

  test('a stair is drawn by dragging, at any angle, then typed to an angle and flipped', async ({ page }) => {
    await newProject(page, 'Drawn stair');
    await page.getByTestId('tool-stair').click();
    await page.getByTestId('catalog-stair_straight').click();
    type S = { floors: { stairs: { transform: { rotation: number }; tread: number }[] }[] };
    await dragOnCanvas(page, [400, 520], [700, 320]);
    await waitForSaved(page, (p) => (p as unknown as S).floors[0].stairs.length === 1);
    const stair = () => storedProjects(page).then((all) => (all[0] as unknown as S).floors[0].stairs[0]);
    expect((await stair()).transform.rotation).toBe(55);
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: `${SHOTS}/stair-drawn.png` });
    await page.getByTestId('stair-angle').fill('30');
    await page.getByTestId('stair-angle').press('Enter');
    await waitForSaved(page, (p) => (p as unknown as S).floors[0].stairs[0].transform.rotation === 30);
    await page.getByTestId('stair-flip').click();
    await waitForSaved(page, (p) => (p as unknown as S).floors[0].stairs[0].transform.rotation === 210);
  });

  test('Add lists the frame first: pillars, beams and slabs, then walls, doors and windows', async ({
    page,
  }) => {
    await newProject(page, 'Order');
    await page.getByTestId('tool-all').click();
    const ids = await page
      .getByTestId('library-tabs')
      .locator('[data-testid^="lib-tab-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(ids.slice(0, 5)).toEqual([
      'lib-tab-recent',
      'lib-tab-structure',
      'lib-tab-walls',
      'lib-tab-doors',
      'lib-tab-windows',
    ]);
  });

  test('the compass puts a turned plan back with north up', async ({ page }) => {
    await openSample(page);
    await expect(page.getByTestId('north-up')).toBeVisible();
    await page.getByTestId('north-up').click();
    await expect(page.getByTestId('north-up')).not.toHaveClass(/turned/);
  });

  test('a newer version shows its number, date and changes, and Later puts it away', async ({ page }) => {
    await page.route('**/version.json*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          version: '99.1.0',
          date: '2026-12-01T10:00:00Z',
          notes: ['Faster drawing', 'New stairs'],
        }),
      }),
    );
    await page.goto('/');
    const popup = page.getByTestId('update-popup');
    await expect(popup).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('update-versions')).toContainText('99.1.0');
    await expect(popup).toContainText('New stairs');
    await page.screenshot({ path: `${SHOTS}/update-popup.png` });
    await page.getByTestId('update-later').click();
    await expect(popup).toHaveCount(0);
    // Not again the same day.
    await page.reload();
    await page.waitForTimeout(4000);
    await expect(popup).toHaveCount(0);
  });

  test('nothing is shown when this is the newest version', async ({ page }) => {
    await page.route('**/version.json*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: '0.0.1', notes: [] }),
      }),
    );
    await page.goto('/');
    await page.waitForTimeout(4000);
    await expect(page.getByTestId('update-popup')).toHaveCount(0);
  });
});

test.describe('floors, stairs, slabs, sizes and sharing', () => {
  const clickFloor = async (page: Page, index: number) => page.getByTestId(`floor-level-${index}`).click();

  test('undo only takes back work on the floor you are on', async ({ page }) => {
    await newProject(page, 'Two floors');
    await page.getByTestId('floor-add').click();
    await page.getByTestId('add-floor').click();
    await page.getByTestId('add-floor-empty').click();
    // First floor is active after adding it: draw there.
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [300, 200], [500, 350]);
    await waitForSaved(page, (p) => p.floors[1]?.walls.length === 4);
    // Then the ground floor.
    await clickFloor(page, 0);
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [600, 200], [800, 350]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4 && p.floors[1]?.walls.length === 4);
    // Back on the first floor, undo must not touch the newer ground-floor work.
    await clickFloor(page, 1);
    await page.getByTestId('undo').click();
    await waitForSaved(page, (p) => p.floors[1].walls.length === 0 && p.floors[0].walls.length === 4);
    // The button says when there is nothing left here, though the ground floor still has its step.
    await expect(page.getByTestId('undo')).toBeDisabled();
    await clickFloor(page, 0);
    await expect(page.getByTestId('undo')).toBeEnabled();
    await page.getByTestId('undo').click();
    await waitForSaved(page, (p) => p.floors[0].walls.length === 0);
    // Redo works the same way.
    await page.getByTestId('redo').click();
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4 && p.floors[1].walls.length === 0);
  });

  test('a stair can be turned before placing, and every way after', async ({ page }) => {
    await newProject(page, 'Stairs');
    await page.getByTestId('tool-stair').click();
    await page.getByTestId('catalog-stair_straight').click();
    await page.mouse.move(600, 400);
    await expect(page.getByTestId('place-rotate')).toBeVisible();
    await page.getByTestId('place-rotate').click();
    await page.keyboard.press('r');
    await page.mouse.move(610, 400);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/stair-before-placing.png` });
    await tapCanvas(page, [600, 400]);
    type WithStair = {
      floors: {
        stairs: { transform: { x: number; y: number; rotation: number }; width: number; turnLeft: boolean }[];
      }[];
    };
    await waitForSaved(
      page,
      (p) => (p as unknown as WithStair).floors[0].stairs[0]?.transform.rotation === 180,
    );
    // Direction buttons, and it stays where it is.
    const stored = async () => ((await storedProjects(page))[0] as unknown as WithStair).floors[0].stairs[0];
    for (const deg of [90, 270, 0]) {
      await page.getByTestId(`stair-dir-${deg}`).click();
      await waitForSaved(
        page,
        (p) => (p as unknown as WithStair).floors[0].stairs[0].transform.rotation === deg,
      );
    }
    await page.screenshot({ path: `${SHOTS}/stair-selected.png` });
    // The Rotate button too.
    await page.getByTestId('action-rotate').click();
    await waitForSaved(
      page,
      (p) => (p as unknown as WithStair).floors[0].stairs[0].transform.rotation === 90,
    );
    expect((await stored()).width).toBe(1000);
    // The size is one tap away, beside the stair.
    await page.getByTestId('size-chip').click();
    await page.getByTestId('size-0').fill('1200');
    await page.getByTestId('size-done').click();
    await page.getByTestId('fit-view').click();
  });

  test('a slab takes two corners, can be picked, and its size can be typed', async ({ page }) => {
    await newProject(page, 'Slab');
    await page.getByTestId('tool-all').click();
    await page.getByTestId('lib-tab-structure').click();
    await page.getByTestId('lib-tool-slab').click();
    await dragOnCanvas(page, [300, 200], [600, 400]);
    type WithSlab = { floors: { slabs: { polygon: { x: number; y: number }[] }[] }[] };
    await waitForSaved(page, (p) => (p as unknown as WithSlab).floors[0].slabs.length === 1);
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: `${SHOTS}/slab-selected.png` });
    await page.getByTestId('slab-width').fill('5m');
    await page.getByTestId('slab-width').press('Enter');
    await waitForSaved(page, (p) => {
      const xs = (p as unknown as WithSlab).floors[0].slabs[0]?.polygon.map((q) => q.x) ?? [0];
      return Math.abs(Math.max(...xs) - Math.min(...xs) - 5000) < 2;
    });
  });

  test('sizes: a chip beside the item, typing a number, Done, and corner handles', async ({ page }) => {
    await newProject(page, 'Sizes');
    await page.getByTestId('tool-object').click();
    await page.getByTestId('lib-tab-furniture').click();
    await page.getByTestId('catalog-sofa_3').click();
    await tapCanvas(page, [500, 300]);
    type WithObject = { floors: { objects: { width: number; depth: number; height: number }[] }[] };
    await waitForSaved(page, (p) => (p as unknown as WithObject).floors[0].objects.length === 1);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/object-selected.png` });
    // Typing a number opens the sizes straight away.
    await page.keyboard.type('9');
    await expect(page.getByTestId('size-popover')).toBeVisible();
    await expect(page.getByTestId('size-0')).toHaveValue('9');
    await page.keyboard.press('Enter');
    await waitForSaved(
      page,
      (p) => Math.abs((p as unknown as WithObject).floors[0].objects[0].width - 2743.2) < 2,
    );
    await page.screenshot({ path: `${SHOTS}/size-popover.png` });
    await page.getByTestId('size-done').click();
    await expect(page.getByTestId('size-popover')).toHaveCount(0);
    // Dragging a corner on the plan.
    await page.getByTestId('fit-view').click();
    await page.waitForTimeout(200);
    await page.getByTestId('size-chip').waitFor();
    const before = ((await storedProjects(page))[0] as unknown as WithObject).floors[0].objects[0].width;
    // Done in the panel finishes the item.
    await expect(page.getByTestId('inspector-done')).toBeVisible();
    await page.getByTestId('inspector-object-width').fill('2m');
    await page.getByTestId('inspector-done').click();
    await waitForSaved(page, (p) => (p as unknown as WithObject).floors[0].objects[0].width === 2000);
    await expect(page.getByTestId('inspector')).toHaveCount(0);
    expect(before).toBeGreaterThan(2000);
  });

  test('corner handles resize and the round handle turns, on the plan', async ({ page }) => {
    await newProject(page, 'Handles');
    await page.getByTestId('tool-object').click();
    await page.getByTestId('lib-tab-furniture').click();
    await page.getByTestId('catalog-sofa_3').click();
    await tapCanvas(page, [500, 300]);
    type O = { floors: { objects: { width: number; transform: { rotation: number } }[] }[] };
    const sofa = async () => ((await storedProjects(page))[0] as unknown as O).floors[0].objects[0];
    await waitForSaved(page, (p) => (p as unknown as O).floors[0].objects.length === 1);
    await page.getByTestId('fit-view').click();
    await page.waitForTimeout(300);
    const box = await canvasBox(page);

    // Hovering changes nothing, and the cursor says when it is over a handle.
    const findHandle = async (cursor: string) => {
      for (let y = box.height * 0.1; y < box.height * 0.9; y += 14) {
        for (let x = box.width * 0.1; x < box.width * 0.9; x += 14) {
          await page.mouse.move(box.x + x, box.y + y);
          const now = await page.getByTestId('plan-canvas').evaluate((c) => (c as HTMLElement).style.cursor);
          if (now === cursor) return { x: box.x + x, y: box.y + y };
        }
      }
      throw new Error(`No ${cursor} handle on the plan`);
    };

    const width = (await sofa()).width;
    const corner = await findHandle('nwse-resize');
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x + (corner.x > box.x + box.width / 2 ? 60 : -60), corner.y, { steps: 4 });
    await page.mouse.up();
    await waitForSaved(page, (p) => (p as unknown as O).floors[0].objects[0].width > width);

    const turn = await findHandle('grab');
    await page.mouse.move(turn.x, turn.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.92, box.y + box.height * 0.5, { steps: 4 });
    await page.mouse.up();
    await waitForSaved(page, (p) => (p as unknown as O).floors[0].objects[0].transform.rotation !== 0);
    // Both are one Undo step each.
    await page.getByTestId('undo').click();
    await waitForSaved(page, (p) => (p as unknown as O).floors[0].objects[0].transform.rotation === 0);
    expect((await sofa()).width).toBeGreaterThan(width);
  });

  test('Add opens on Recent, and what was added is there next time', async ({ page }) => {
    await newProject(page, 'Recents');
    await page.getByTestId('tool-all').click();
    await expect(page.getByTestId('lib-tab-recent')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('recent-empty')).toBeVisible();
    await page.getByTestId('lib-tab-plants').click();
    await page.getByTestId('catalog-tree_neem').click();
    await tapCanvas(page, [500, 300]);
    await page.waitForTimeout(300);
    await page.getByTestId('tool-all').click();
    await page.getByTestId('lib-tab-doors').click();
    await page.getByTestId('catalog-door_single').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByTestId('tool-all').click();
    await expect(page.getByTestId('lib-tab-recent')).toHaveAttribute('aria-selected', 'true');
    const cards = page.locator('.library-grid .library-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toHaveAttribute('data-testid', 'catalog-door_single');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/library-recent.png` });
    // After a reload too.
    await page.reload();
    await page.getByTestId('open-project').first().click();
    await page.getByTestId('tool-all').click();
    await expect(page.locator('.library-grid .library-card')).toHaveCount(2);
  });

  test('Done is on every dialog', async ({ page }) => {
    await openSample(page);
    for (const d of ['layers', 'site', 'snap', 'materials', 'history', 'versions', 'converter', 'settings']) {
      await openMenu(page, d);
      await page.getByTestId('dialog-done').click();
      await expect(page.getByTestId('dialog-done')).toHaveCount(0);
    }
  });

  test('a house travels as a file: view it, or keep your own copy', async ({ page, browser }) => {
    await openSample(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('go-share').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.nakshakar$/);
    const path = await download.path();

    // A friend, on another device, with nothing saved.
    const friendContext = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    const friend = await friendContext.newPage();
    await friend.goto('/');
    await expect(friend.getByTestId('no-projects')).toBeVisible();
    await friend.getByTestId('shared-file').setInputFiles(path);
    await expect(friend.getByTestId('shared-card')).toBeVisible();
    await expect(friend.getByTestId('shared-name')).toContainText('Sample');
    await friend.screenshot({ path: `${SHOTS}/shared-dialog.png` });

    // Viewing changes nothing, and nothing is saved.
    await friend.getByTestId('shared-view').click();
    await expect(friend.getByTestId('shared-banner')).toBeVisible();
    await expect(friend.getByTestId('tool-wall')).toBeHidden();
    await friend.waitForTimeout(400);
    await friend.screenshot({ path: `${SHOTS}/shared-view.png` });
    await friend.getByTestId('go-3d').click();
    await expect(friend.getByTestId('view3d')).toBeVisible();
    await friend.getByTestId('back-editor').click();
    expect(await storedProjects(friend)).toHaveLength(0);

    // Saving makes it theirs, and they can change it.
    await friend.getByTestId('shared-keep').click();
    await expect(friend.getByTestId('shared-banner')).toHaveCount(0);
    await expect(friend.getByTestId('tool-wall')).toBeVisible();
    await waitForSaved(friend, (p) => p.floors.length > 1);
    expect(await storedProjects(friend)).toHaveLength(1);
    const [theirs] = await storedProjects(friend);
    const [mine] = await storedProjects(page);
    expect(theirs.id).not.toBe(mine.id);
    expect(theirs.floors[0].walls.length).toBe(mine.floors[0].walls.length);
    await friendContext.close();
  });

  test('a file that is not a house is refused, politely', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('shared-file').setInputFiles({
      name: 'photo.nakshakar',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a house'),
    });
    await expect(page.getByTestId('toast')).toContainText('not a Nakshakar house');
    await expect(page.getByTestId('shared-card')).toHaveCount(0);
  });

  test('a shared file cannot run code through a colour', async ({ page }) => {
    await openSample(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('go-share').click(),
    ]);
    const text = readFileSync(await download.path(), 'utf8');
    const evil = text.replace(
      /"floorColor":"[^"]*"/g,
      '"floorColor":"#fff\\"><img src=x onerror=window.__pwned=1>"',
    );
    await page.reload();
    await page
      .getByTestId('shared-file')
      .setInputFiles({ name: 'evil.nakshakar', mimeType: 'text/plain', buffer: Buffer.from(evil) });
    await page.getByTestId('shared-view').click();
    await page.getByTestId('go-print').click();
    await expect(page.getByTestId('print-preview').locator('svg').first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});

test.describe('finishing and keys', () => {
  test('walls keep joining corner after corner until Done, then the tool goes back to Select', async ({
    page,
  }) => {
    await newProject(page);
    await page.getByTestId('tool-wall').click();
    await tapCanvas(page, [300, 300]);
    await page.waitForTimeout(350);
    await tapCanvas(page, [600, 300]);
    await page.waitForTimeout(350);
    await tapCanvas(page, [600, 500]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 2);
    await expect(page.getByTestId('tool-wall')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('wall-finish')).toBeVisible();
    await page.getByTestId('wall-finish').click();
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tool-wall')).toHaveAttribute('aria-pressed', 'false');
    // Another click does not draw any more.
    await page.waitForTimeout(350);
    await tapCanvas(page, [600, 500]);
    await page.waitForTimeout(1200);
    expect((await storedProjects(page))[0].floors[0].walls).toHaveLength(2);
    // One tap to draw another.
    await page.getByTestId('add-another').click();
    await expect(page.getByTestId('tool-wall')).toHaveAttribute('aria-pressed', 'true');
  });

  test('numbers, Enter, Delete and arrows work on the keyboard', async ({ page }) => {
    await newProject(page);
    // Typing a number while drawing types the length; Enter adds that wall and the next can follow.
    await page.keyboard.press('w');
    await tapCanvas(page, [300, 300]);
    await page.mouse.move(700, 300);
    await page.keyboard.type('12');
    await expect(page.getByTestId('draw-length')).toHaveValue('12');
    await page.keyboard.press('Enter');
    await waitForSaved(page, (p) => p.floors[0].walls.length === 1);
    let wall = (await storedProjects(page))[0].floors[0].walls[0];
    expect(Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)).toBeCloseTo(3657.6, 0);
    // Done ends the drawing and chooses the new wall: typing a number changes its length.
    await page.getByTestId('wall-finish').click();
    await page.keyboard.type('20');
    await expect(page.getByTestId('wall-length-input')).toHaveValue('20');
    await page.keyboard.press('Enter');
    await waitForSaved(page, (p) => {
      const w = p.floors[0].walls[0];
      return Math.abs(Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) - 6096) < 1;
    });
    // Arrow keys nudge what is chosen.
    await page.waitForTimeout(200);
    wall = (await storedProjects(page))[0].floors[0].walls[0];
    await page.keyboard.press('Shift+ArrowDown');
    await waitForSaved(page, (p) => Math.abs(p.floors[0].walls[0].start.y - wall.start.y - 1000) < 1);
    // Delete removes it, and Ctrl+Z brings it back.
    await page.keyboard.press('Delete');
    await waitForSaved(page, (p) => p.floors[0].walls.length === 0);
    await page.keyboard.press('Control+z');
    await waitForSaved(page, (p) => p.floors[0].walls.length === 1);
    // Letters open tools, and the ones that need a choice open the library.
    await page.keyboard.press('Escape');
    await page.keyboard.press('d');
    await expect(page.getByTestId('catalog-door_single')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcuts')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/shortcuts.png` });
  });

  test('walking keys work from the 3D button, in Orbit too', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('go-3d').click();
    await expect(page.getByTestId('view3d')).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId('orbit-keys')).toBeVisible();
    await page.keyboard.press('w');
    await expect(page.getByTestId('joystick')).toBeVisible();
    await expect(page.getByTestId('mode-walk')).toHaveClass(/active/);
  });

  test('walking keys work with a non-English keyboard layout', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('go-explore').click();
    await expect(page.getByTestId('distance')).toHaveText(/\b([4-9]|1\d) m\b/, { timeout: 30000 });
    await page.waitForTimeout(600);
    const send = (type: string) =>
      page.evaluate(
        (t) => window.dispatchEvent(new KeyboardEvent(t, { key: 'ो', code: 'KeyW', bubbles: true })),
        type,
      );
    const start = Number(((await page.getByTestId('distance').textContent()) ?? '').match(/\d+/)?.[0]);
    await send('keydown');
    await page.waitForTimeout(2500);
    await send('keyup');
    await page.waitForTimeout(400);
    expect(await distanceNow(page)).toBeLessThan(start);
  });

  test('floors can be added from the plan and moved up and down', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('floor-add').click();
    await page.screenshot({ path: `${SHOTS}/floors.png` });
    const before = (await storedProjects(page))[0].floors.map((f) => f.name);
    expect(before.slice(0, 2)).toEqual(['Ground Floor', 'First Floor']);
    const groundRooms = (await storedProjects(page))[0].floors[0].rooms.length;
    await page.getByTestId('floor-up-0').click();
    await waitForSaved(
      page,
      (p) => p.floors[1].rooms.length === groundRooms && p.floors[0].name === 'Ground Floor',
    );
    const [p] = await storedProjects(page);
    expect(p.floors[1].name).toBe('First Floor');
    await page.getByTestId('add-floor').click();
    await page.screenshot({ path: `${SHOTS}/floors-add.png` });
    await page.getByTestId('add-floor-same').click();
    await waitForSaved(page, (x) => x.floors.length === p.floors.length + 1);
    const [q] = await storedProjects(page);
    // The sample's terrace stays on top, so the new floor sits just under it.
    const added = q.floors[q.floors.length - 2];
    expect(added.objects).toHaveLength(0);
    expect(added.walls.length).toBeGreaterThan(3);
  });

  test('the plan shows where the next room will go before it is added', async ({ page }) => {
    await newProject(page);
    await page.getByTestId('tool-rooms').click();
    await page.getByTestId('room-type-kitchen').click();
    await page.waitForTimeout(300);
    const empty = await page.getByTestId('plan-canvas').screenshot();
    await page.getByTestId('room-side-auto').count();
    await page.getByTestId('room-add').click();
    await waitForSaved(page, (p) => p.floors[0].rooms.length === 1);
    await page.getByTestId('room-type-bedroom').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/rooms-preview.png` });
    expect((await page.getByTestId('plan-canvas').screenshot()).equals(empty)).toBe(false);
    // Enter adds it.
    await page.keyboard.press('Enter');
    await waitForSaved(page, (p) => p.floors[0].rooms.length === 2);
  });
});

test.describe('drawing', () => {
  test('rectangle tool creates four walls and a detected room', async ({ page }) => {
    await newProject(page);
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [200, 200], [500, 420]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    const [p] = await storedProjects(page);
    expect(p.floors[0].rooms).toHaveLength(1);
    expect(p.floors[0].rooms[0].area).toBeGreaterThan(1);
    await page.screenshot({ path: `${SHOTS}/rect-room.png` });
  });

  test('numeric wall entry follows the typed length and angle, then closes the loop', async ({ page }) => {
    await newProject(page);
    await page.getByTestId('tool-wall').click();
    await tapCanvas(page, [300, 300]);
    await expect(page.getByTestId('wall-panel')).toBeVisible();
    await page.getByTestId('draw-connected').check();
    const lengths = [
      ['12ft', '0'],
      ['10ft', '90'],
      ['12ft', '180'],
    ];
    for (const [length, angle] of lengths) {
      await page.getByTestId('draw-length').fill(length);
      await page.getByTestId('draw-angle').fill(angle);
      await page.getByTestId('draw-angle').press('Enter');
    }
    await page.getByTestId('draw-close').click();
    await expect(page.getByTestId('toast')).toBeVisible();
    await waitForSaved(page, (x) => x.floors[0].walls.length === 4 && x.floors[0].rooms.length === 1);
    const [p] = await storedProjects(page);
    const w = p.floors[0].walls[0];
    const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    expect(Math.abs(length - 3657.6)).toBeLessThan(1);
    // 12 ft x 10 ft on centre lines, less half a 230 mm wall on each side.
    expect(p.floors[0].rooms[0].area).toBeCloseTo((3.6576 - 0.23) * (3.048 - 0.23), 1);
  });

  test('typing a bad length shows a hint and does not crash', async ({ page }) => {
    await newProject(page);
    await page.getByTestId('tool-wall').click();
    await tapCanvas(page, [300, 300]);
    await page.getByTestId('draw-length').fill('abc');
    await expect(page.getByText(/Could not read/)).toBeVisible();
    await page.getByTestId('draw-length').fill(`5' 6"`);
    await expect(page.getByText(/= 1\.68 m/)).toBeVisible();
  });

  test('undo and redo walk through named steps', async ({ page }) => {
    await newProject(page);
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [200, 200], [500, 420]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    await page.getByTestId('undo').click();
    await waitForSaved(page, (p) => p.floors[0].walls.length === 0);
    await page.getByTestId('redo').click();
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    await openMenu(page, 'history');
    await expect(page.getByTestId('history-list')).toContainText('Draw rectangle');
  });

  test('tapping a wall lets its length be typed, and the room stays square', async ({ page }) => {
    await newProject(page);
    await openMenu(page, 'wizard');
    await page.getByTestId('wizard-length').fill('4m');
    await page.getByTestId('wizard-length').press('Enter');
    await page.getByTestId('wizard-breadth').fill('3m');
    await page.getByTestId('wizard-breadth').press('Enter');
    await page.getByTestId('wizard-drop').click();
    await waitForSaved(page, (p) => p.floors[0].rooms.length === 1);
    await page.getByTestId('fit-view').click();
    // Select a wall by probing down the middle of the fitted plan until one is picked.
    const box = await canvasBox(page);
    let selected = false;
    for (let y = 60; y < box.height - 60 && !selected; y += 6) {
      await tapCanvas(page, [box.width / 2, y]);
      selected = await page.getByTestId('length-chip').isVisible();
    }
    expect(selected).toBe(true);
    await page.getByTestId('length-chip').click();
    await page.getByTestId('wall-length-input').fill('5m');
    await page.getByTestId('wall-length-input').press('Enter');
    await waitForSaved(page, (p) => Math.abs(p.floors[0].rooms[0].area - 4.77 * 2.77) < 0.05);
  });

  test('places a door on a wall and resizes furniture by typing', async ({ page }) => {
    await newProject(page);
    await openMenu(page, 'wizard');
    await page.getByTestId('wizard-drop').click();
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    await page.getByTestId('fit-view').click();
    const box = await canvasBox(page);
    await page.getByTestId('tool-door').click();
    await page.getByTestId('catalog-door_single').click();
    for (let y = 60; y < box.height - 60; y += 8) {
      await tapCanvas(page, [box.width / 2, y]);
      if (await page.getByTestId('inspector').isVisible()) break;
    }
    await waitForSaved(page, (p) => p.floors[0].openings.length === 1);
    await page.getByTestId('tool-object').click();
    await page.getByTestId('catalog-sofa_3').click();
    await tapCanvas(page, [box.width / 2, box.height / 2]);
    await waitForSaved(page, (p) => p.floors[0].objects.length === 1);
    await page.getByTestId('inspector-object-width').fill('7ft');
    await page.getByTestId('inspector-object-width').press('Enter');
    await waitForSaved(page, (p) => Math.abs(p.floors[0].objects[0].width - 2133.6) < 1);
  });

  test('perimeter table reports the closing error and builds walls', async ({ page }) => {
    await newProject(page);
    await openMenu(page, 'perimeter');
    await expect(page.getByTestId('closing-error')).toContainText(/closes/i);
    await page.getByTestId('perimeter-length-3').fill('2m');
    await page.getByTestId('perimeter-length-3').press('Enter');
    await expect(page.getByTestId('closing-error')).toContainText(/does not close/i);
    await page.getByTestId('perimeter-length-3').fill('3000mm');
    await page.getByTestId('perimeter-length-3').press('Enter');
    await expect(page.getByTestId('closing-error')).toContainText(/closes/i);
    await page.getByTestId('perimeter-build').click();
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4 && p.floors[0].rooms.length === 1);
  });

  test('trace plot builds walls on the area left after setbacks', async ({ page }) => {
    await newProject(page);
    await openMenu(page, 'plot');
    await expect(page.getByTestId('buildable-area')).toContainText('sq ft');
    await page.getByTestId('plot-build').click();
    await waitForSaved(page, (p) => p.floors[0].rooms.length === 1);
  });

  test('every wizard shape can be dropped', async ({ page }) => {
    await newProject(page);
    const shapes = [
      'rectangle',
      'l',
      'u',
      't',
      'plus',
      'bay',
      'trapezium',
      'hexagon',
      'octagon',
      'circle',
      'ngon',
    ];
    let rooms = 0;
    for (const shape of shapes) {
      await openMenu(page, 'wizard');
      await page.getByTestId(`wizard-shape-${shape}`).click();
      await page.getByTestId('wizard-drop').click();
      rooms += 1;
      await waitForSaved(page, (p) => p.floors[0].rooms.length === rooms);
    }
    await page.getByTestId('fit-view').click();
    await page.screenshot({ path: `${SHOTS}/all-shapes.png` });
  });

  test('saved versions can be compared and restored', async ({ page }) => {
    await newProject(page);
    await openMenu(page, 'versions');
    await page.getByTestId('version-name').fill('Empty');
    await page.getByTestId('version-save').click();
    await expect(page.getByTestId('version-list')).toContainText('Empty');
    await page.getByRole('button', { name: /close/i }).click();
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [200, 200], [500, 420]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    await openMenu(page, 'versions');
    const empty = page.getByTestId('version-list').locator('li', { hasText: 'Empty' });
    await empty.getByTestId('version-compare').click();
    await expect(page.getByTestId('version-diff')).toBeVisible();
    await empty.getByTestId('version-restore').click();
    await waitForSaved(page, (p) => p.floors[0].walls.length === 0);
  });

  test('lasso selects, and a group can be rotated, mirrored, copied to another floor and deleted', async ({
    page,
  }) => {
    await newProject(page);
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [300, 250], [500, 400]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    await page.getByTestId('tool-lasso').click();
    const box = await canvasBox(page);
    await page.mouse.move(box.x + 250, box.y + 200);
    await page.mouse.down();
    for (const [x, y] of [
      [560, 200],
      [560, 460],
      [250, 460],
      [250, 200],
    ])
      await page.mouse.move(box.x + x, box.y + y, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId('inspector')).toContainText('4');
    await page.getByTestId('action-rotate').click();
    await page.getByTestId('action-mirror').click();
    await page.getByTestId('action-copy').click();
    await openMenu(page, 'floors');
    await page.getByTestId('add-floor').click();
    await page.getByTestId('add-floor-empty').click();
    // The new floor is active and empty; the copied walls are still held for pasting there.
    await page.getByTestId('paste-here').click();
    await waitForSaved(
      page,
      (p) => p.floors.length === 2 && p.floors[1]?.walls.length === 4 && p.floors[1].rooms.length === 1,
    );
    await page.getByTestId('action-delete').click();
    await waitForSaved(page, (p) => p.floors[1].walls.length === 0 && p.floors[0].walls.length === 4);
  });

  test('unit converter handles Indian units', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('home-converter').click();
    await page.getByTestId('converter-input').fill('1');
    await page.getByTestId('converter-unit').selectOption('gaj');
    await expect(page.getByTestId('converter-results')).toContainText('0.9144 m');
    await page.getByTestId('converter-area').click();
    await page.getByTestId('converter-unit').selectOption('cent');
    await expect(page.getByTestId('converter-results')).toContainText('40.47 sq m');
  });
});

test.describe('laptop with a mouse', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('a first house is taught step by step, by tapping the lit buttons', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('new-name').fill('First house');
    await page.getByTestId('create-project').click();
    const tour = page.getByTestId('tour');
    await expect(tour).toHaveAttribute('data-step', 'rooms');
    await page.screenshot({ path: `${SHOTS}/tour-start.png` });
    // Everything except the lit button waits.
    await page.mouse.click(700, 400);
    await expect(tour).toHaveAttribute('data-step', 'rooms');
    await page.getByTestId('tool-rooms').click();
    await expect(tour).toHaveAttribute('data-step', 'roomType');
    await page.getByTestId('tour-next').click();
    await expect(tour).toHaveAttribute('data-step', 'roomAdd');
    await page.getByTestId('room-add').click();
    await expect(tour).toHaveAttribute('data-step', 'roomMore');
    await waitForSaved(page, (p) => p.floors[0].rooms.length >= 1);
    await page.screenshot({ path: `${SHOTS}/tour-room.png` });
    await page.getByTestId('room-add').click();
    await expect(tour).toHaveAttribute('data-step', 'roomsDone');
    await page.getByTestId('rooms-done').click();
    await expect(tour).toHaveAttribute('data-step', 'add');
    await page.getByTestId('tool-all').click();
    await expect(tour).toHaveAttribute('data-step', 'library');
    await page.getByTestId('tour-next').click();
    await expect(tour).toHaveAttribute('data-step', 'libraryClose');
    await page.getByTestId('dialog-done').click();
    for (const step of ['select', 'undo', 'three', 'explore']) {
      await expect(tour).toHaveAttribute('data-step', step);
      await page.getByTestId('tour-next').click();
    }
    await expect(tour).toHaveCount(0);
    await expect(page.getByTestId('welcome')).toHaveCount(0);
    // Not again on the next house; still in the menu.
    await page.getByTestId('back-home').click();
    await page.getByTestId('new-name').fill('Second house');
    await page.getByTestId('create-project').click();
    await page.waitForTimeout(1200);
    await expect(tour).toHaveCount(0);
    const rail = page.locator('.toolrail');
    expect(await rail.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  });

  test('walls draw by clicking; double click finishes; clicking the start closes the room', async ({
    page,
  }) => {
    await newProject(page);
    await page.keyboard.press('w');
    await expect(page.getByTestId('tool-wall')).toHaveAttribute('aria-pressed', 'true');
    const corners: [number, number][] = [
      [300, 150],
      [650, 150],
      [650, 400],
      [300, 400],
    ];
    await tapCanvas(page, corners[0]);
    await page.waitForTimeout(400);
    // Walls join one after another until the room is closed.
    for (const c of corners.slice(1)) {
      await tapCanvas(page, c);
      await page.waitForTimeout(400);
    }
    await tapCanvas(page, corners[0]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4 && p.floors[0].rooms.length === 1);
    await page.waitForTimeout(400);
    await page.keyboard.press('w');
    // A separate wall, finished with a double click.
    await tapCanvas(page, [750, 150]);
    await page.waitForTimeout(400);
    await tapCanvas(page, [750, 400]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 5);
    await tapCanvas(page, [750, 400]);
    await tapCanvas(page, [750, 400]);
    await page.waitForTimeout(400);
    const [p] = await storedProjects(page);
    expect(p.floors[0].walls).toHaveLength(5);
    // Esc goes back to Select once the drawing has ended.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  });

  test('polygon, arc, split, offset, measure and label tools all work with a mouse', async ({ page }) => {
    await newProject(page);
    // Polygon: click corners, then close it by clicking the start.
    await page.getByTestId('tool-polygon').click();
    for (const c of [
      [250, 120],
      [550, 120],
      [600, 330],
      [250, 330],
      [250, 120],
    ] as [number, number][]) {
      await tapCanvas(page, c);
      await page.waitForTimeout(350);
    }
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4 && p.floors[0].rooms.length === 1);
    // Arc: start, end, then the point that sets the curve.
    await page.getByTestId('tool-arc').click();
    for (const c of [
      [700, 120],
      [950, 120],
      [825, 40],
    ] as [number, number][]) {
      await tapCanvas(page, c);
      await page.waitForTimeout(350);
    }
    await waitForSaved(page, (p) => p.floors[0].walls.length === 5);
    let [p] = await storedProjects(page);
    expect((p.floors[0].walls[4] as unknown as { bulge: number }).bulge).not.toBe(0);
    // Split the top wall of the polygon: one wall becomes two, and the room survives.
    await page.getByTestId('tool-all').click();
    await page.getByTestId('lib-tab-edit').click();
    await page.getByTestId('lib-tool-split').click();
    await tapCanvas(page, [400, 120]);
    await waitForSaved(page, (x) => x.floors[0].walls.length === 6 && x.floors[0].rooms.length === 1);
    // Offset: a parallel copy on the side clicked.
    await page.getByTestId('tool-all').click();
    await page.getByTestId('lib-tab-edit').click();
    await page.getByTestId('lib-tool-offset').click();
    await tapCanvas(page, [250, 225]);
    await waitForSaved(page, (x) => x.floors[0].walls.length === 7);
    // Measure, with two clicks.
    await page.getByTestId('tool-dimension').click();
    await tapCanvas(page, [700, 400]);
    await page.waitForTimeout(350);
    await tapCanvas(page, [950, 400]);
    await page.waitForTimeout(350);
    // Label.
    await page.getByTestId('tool-label').click();
    await tapCanvas(page, [800, 500]);
    await page.getByTestId('label-text').fill('Garden');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(1300);
    [p] = await storedProjects(page);
    const floor = p.floors[0] as unknown as { dimensions: unknown[]; labels: { text: string }[] };
    expect(floor.dimensions).toHaveLength(1);
    expect(floor.labels[0].text).toBe('Garden');
  });

  test('corners clicked quickly in a row all count', async ({ page }) => {
    await newProject(page);
    await page.keyboard.press('w');
    await tapCanvas(page, [300, 150]);
    for (const c of [
      [650, 150],
      [650, 400],
      [300, 400],
      [300, 150],
    ] as [number, number][])
      await tapCanvas(page, c);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4 && p.floors[0].rooms.length === 1);
  });

  test('the plan stays still when the side panel opens, and right click opens the menu', async ({ page }) => {
    await newProject(page);
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [300, 150], [650, 450]);
    await waitForSaved(page, (p) => p.floors[0].rooms.length === 1);
    await page.getByTestId('tool-select').click();
    const area = await canvasBox(page);
    const left = async () =>
      (
        await page.screenshot({ clip: { x: area.x + 100, y: area.y + 100, width: 120, height: 120 } })
      ).toString('base64');
    const before = await left();
    await tapCanvas(page, [475, 300]);
    await expect(page.getByTestId('inspector')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await left()).toBe(before);
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 475, box.y + 300, { button: 'right' });
    await expect(page.getByTestId('context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `${SHOTS}/laptop-inspector.png` });
  });

  test('Esc closes a dialog, and shortcuts do not fire behind one', async ({ page }) => {
    await newProject(page);
    await openMenu(page, 'site');
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('w');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('w');
    await expect(page.getByTestId('tool-wall')).toHaveAttribute('aria-pressed', 'true');
  });

  test('copy and paste work from the keyboard, and zoom buttons work', async ({ page }) => {
    await newProject(page);
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [300, 150], [650, 450]);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    await page.getByTestId('tool-select').click();
    await tapCanvas(page, [300, 300]);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await waitForSaved(page, (p) => p.floors[0].walls.length === 5);
    const before = await page.getByTestId('plan-canvas').screenshot();
    await page.getByTestId('zoom-in').click();
    await page.waitForTimeout(150);
    expect((await page.getByTestId('plan-canvas').screenshot()).equals(before)).toBe(false);
  });
});

test.describe('safety of work', () => {
  test('killing the page loses at most 2 seconds of work, and undo survives', async ({ page, context }) => {
    await newProject(page, 'Crash test');
    await page.getByTestId('tool-rect').click();
    await dragOnCanvas(page, [200, 200], [500, 420]);
    const took = await waitForSaved(page, (p) => p.floors[0].walls.length === 4);
    expect(took).toBeLessThan(2000);
    // No warning and no flush: the page is simply gone.
    await page.close({ runBeforeUnload: false });
    const next = await context.newPage();
    await next.goto('/');
    await expect(next.getByTestId('project-list')).toContainText('Crash test');
    await next.getByTestId('open-project').first().click();
    await expect(next.getByTestId('plan-canvas')).toBeVisible();
    const [p] = await storedProjects(next);
    expect(p.floors[0].rooms).toHaveLength(1);
    await expect(next.getByTestId('undo')).toBeEnabled();
    await next.getByTestId('undo').click();
    await waitForSaved(next, (x) => x.floors[0].walls.length === 0);
  });
});

/** How bright a screenshot is on average, from 0 to 255. A blank 3D view is close to 0. */
const brightness = (page: Page, shot: Buffer) =>
  page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, 32, 32);
    const px = g.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
    return sum / (32 * 32);
  }, shot.toString('base64'));

test.describe('sample house', () => {
  test('plan renders on screen', async ({ page }) => {
    await openSample(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/sample-plan.png` });
    await page.getByTestId('floor-level-1').click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOTS}/sample-plan-first.png` });
  });

  test('3D renders real pixels in every mode', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('go-3d').click();
    await expect(page.getByTestId('view3d')).toBeVisible();
    await expect(page.getByTestId('webgl-error')).toHaveCount(0);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/3d-orbit.png` });
    await page.getByTestId('view-options').click();
    // Cut away the upper floors to look in.
    await page.getByTestId('cutaway').selectOption({ index: 0 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/3d-cutaway.png` });
    await page.getByTestId('cutaway').selectOption({ index: 2 });
    await page.getByTestId('toggle-night').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/3d-night.png` });
    await page.getByTestId('toggle-night').click();
    await page.getByTestId('view-options').click();
    await page.getByTestId('mode-walk').click();
    await expect(page.getByTestId('joystick')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/3d-walk-start.png` });
    await page.keyboard.down('w');
    await page.waitForTimeout(2500);
    await page.keyboard.up('w');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/3d-walk-moved.png` });
    await page.getByTestId('mode-vr').click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/3d-vr.png` });
    await page.getByTestId('exit-vr').click();
    await expect(page.getByTestId('joystick')).toBeVisible();
  });

  test('in 3D, doors open and close, and painting and planting save to the design', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('go-3d').click();
    await expect(page.getByTestId('view3d')).toBeVisible();
    await page.waitForTimeout(1500);
    const box = (await page.getByTestId('view3d').boundingBox())!;

    // Paint: tap the middle of the house.
    await page.getByTestId('tool3d-paint').click();
    await page.getByTestId('paint-hot_pink').click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await waitForSaved(page, (p) => JSON.stringify(p).includes('#e84d8a'));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/3d-painted.png` });

    // Plant: pick a tree, tap the ground near the bottom of the screen.
    const before = (await storedProjects(page))[0].floors.reduce((n, f) => n + f.plants.length, 0);
    await page.getByTestId('tool3d-add').click();
    await page.getByTestId('add3d-tree_neem').click();
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height - 60);
    await waitForSaved(page, (p) => p.floors.reduce((n, f) => n + f.plants.length, 0) === before + 1);
    await page.getByTestId('tool3d-add').click();

    // Doors: walking starts indoors by the entrance, and a door nearby offers Open.
    await page.getByTestId('mode-walk').click();
    await expect(page.getByTestId('joystick')).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/3d-third-person-inside.png` });
    await expect(page.getByTestId('toggle-opening')).toBeVisible({ timeout: 10000 });
    const first = await page.getByTestId('toggle-opening').innerText();
    await page.getByTestId('toggle-opening').click();
    await expect(page.getByTestId('toggle-opening')).not.toHaveText(first);
    // A slow device lowers its sharpness about now, and that must not blank the view.
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(450);
      const shot = await page.screenshot({ path: `${SHOTS}/3d-door-toggled.png` });
      expect(await brightness(page, shot)).toBeGreaterThan(40);
    }

    // First-person is one tap away, and comes back.
    await page.getByTestId('toggle-eyes').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/3d-eyes.png` });
    await page.getByTestId('toggle-eyes').click();
  });

  test('Explore opens from the editor, and shows the distance on a laptop', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('go-explore').click();
    await expect(page.getByTestId('distance')).toHaveText(/\b([4-9]|1\d) m\b/, { timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/explore-start.png` });
    await page.keyboard.down('w');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(3000);
    await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/explore-run.png` });
    await page.getByTestId('back-editor').click();
    await expect(page.getByTestId('plan-canvas')).toBeVisible();
  });

  test('Vastu report assesses the house', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('go-vastu').click();
    await expect(page.getByTestId('vastu-score')).toContainText(/\d+/);
    await expect(page.getByTestId('vastu-findings')).toContainText('Kitchen placement');
    await page.screenshot({ path: `${SHOTS}/vastu.png` });
  });

  test('estimate always shows minimum, likely and maximum', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('go-estimate').click();
    const row = page.getByTestId('estimate-total').locator('.figure strong');
    await expect(row).toHaveCount(3);
    const value = async (i: number) => Number((await row.nth(i).innerText()).replace(/[^\d]/g, ''));
    const [min, likely, max] = [await value(0), await value(1), await value(2)];
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThan(likely);
    expect(likely).toBeLessThan(max);
    await expect(page.getByTestId('default-rates-warning')).toBeVisible();
    await expect(page.getByTestId('estimate-assumptions')).toContainText('licensed engineer');
    await page.screenshot({ path: `${SHOTS}/estimate.png`, fullPage: true });
    for (const tab of ['materials', 'schedule', 'rates', 'details']) {
      await page.getByTestId(`estimate-tab-${tab}`).click();
      await expect(page.getByTestId(`estimate-${tab}`)).toBeVisible();
    }
  });

  test('PDF generates offline with plans, Vastu and estimate', async ({ page, context }) => {
    await openSample(page);
    await page.getByTestId('go-print').click();
    await expect(page.getByTestId('print-preview').locator('svg').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/print-preview.png` });
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('make-pdf').click();
    const download = await downloadPromise;
    const path = 'test-results/sample.pdf';
    await download.saveAs(path);
    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(20000);
    await expect(page.getByTestId('print-status')).toContainText(/\d+ pages/);
    // And once more with no network at all.
    await context.setOffline(true);
    const again = page.waitForEvent('download');
    await page.getByTestId('make-pdf').click();
    expect((await again).suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('Hindi and Telugu show translated text, and a Hindi PDF still builds', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('home-settings').click();
    await page.getByTestId('language').selectOption('hi');
    await expect(page.getByTestId('open-sample').locator('strong')).toHaveText('नमूना घर खोलें');
    await page.getByTestId('language').selectOption('te');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('open-sample').locator('strong')).toHaveText('నమూనా ఇల్లు తెరువు');
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('plan-canvas')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/telugu.png` });
    await page.getByTestId('go-print').click();
    const dl = page.waitForEvent('download');
    await page.getByTestId('make-pdf').click();
    await dl;
  });

  test('themes apply', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('home-settings').click();
    await page.getByTestId('theme').selectOption('dark');
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('open-sample').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/dark.png` });
  });
});

test.describe('touch @phone', () => {
  // Touch state lives in the session, so one session must carry a whole gesture.
  const sessions = new WeakMap<Page, CDPSession>();
  const touch = async (page: Page, type: string, points: { x: number; y: number; id: number }[]) => {
    let client = sessions.get(page);
    if (!client) {
      client = await page.context().newCDPSession(page);
      sessions.set(page, client);
    }
    await client.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: points });
  };

  test('one finger draws a room and two fingers pinch without drawing @phone', async ({ page }) => {
    await newProject(page, 'Touch');
    await page.getByTestId('nav-add').click();
    await page.getByTestId('lib-tab-walls').click();
    await page.getByTestId('lib-tool-rect').click();
    // The settings stay out of the way of the canvas on a phone, but can be opened.
    await expect(page.getByTestId('wall-panel')).toHaveCount(0);
    await page.getByTestId('wall-settings').click();
    await expect(page.getByTestId('wall-panel')).toBeVisible();
    await page.getByTestId('wall-panel').getByRole('button', { name: /hide/i }).click();
    await expect(page.getByTestId('wall-panel')).toHaveCount(0);
    const box = await canvasBox(page);
    const at = (x: number, y: number, id = 0) => ({ x: box.x + x, y: box.y + y, id });
    await touch(page, 'touchStart', [at(80, 150)]);
    for (let i = 1; i <= 6; i++) await touch(page, 'touchMove', [at(80 + i * 35, 150 + i * 35)]);
    await touch(page, 'touchEnd', []);
    await waitForSaved(page, (p) => p.floors[0].walls.length === 4);

    // Two fingers: navigation only. Nothing may be added or changed.
    const before = await page.getByTestId('plan-canvas').screenshot();
    await touch(page, 'touchStart', [at(120, 250, 1), at(240, 250, 2)]);
    for (let i = 1; i <= 6; i++)
      await touch(page, 'touchMove', [at(120 - i * 12, 250, 1), at(240 + i * 12, 250, 2)]);
    await touch(page, 'touchEnd', []);
    await page.waitForTimeout(200);
    const after = await page.getByTestId('plan-canvas').screenshot();
    expect(after.equals(before)).toBe(false);
    await page.waitForTimeout(1200);
    const [p] = await storedProjects(page);
    expect(p.floors[0].walls).toHaveLength(4);
  });

  test('long press opens the action menu, and tap-to-add builds a selection @phone', async ({ page }) => {
    await openSample(page);
    await page.waitForTimeout(300);
    const box = await canvasBox(page);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 };
    await touch(page, 'touchStart', [centre]);
    await page.waitForTimeout(800);
    await touch(page, 'touchEnd', []);
    await expect(page.getByTestId('context-menu')).toBeVisible();
    await expect(page.getByTestId('context-menu').getByTestId('action-tap-to-add')).toBeVisible();
    await page.getByTestId('context-menu').getByTestId('action-tap-to-add').click();
    await expect(page.getByTestId('action-tap-to-add')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('phone @phone', () => {
  test('layout works at phone size, and touch draws @phone', async ({ page }) => {
    await page.goto('/');
    await page.screenshot({ path: `${SHOTS}/phone-home.png` });
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('plan-canvas')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/phone-editor.png` });
    await page.getByTestId('fab-3d').click();
    await expect(page.getByTestId('view3d')).toBeVisible();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/phone-3d.png` });
    await page.getByTestId('back-editor').click();
    // Everything else is one tap away, in big buttons, with nothing to scroll sideways.
    await page.getByTestId('nav-more').click();
    await page.screenshot({ path: `${SHOTS}/phone-more.png` });
    for (const id of ['more-vastu', 'more-estimate', 'more-print', 'more-floors', 'more-settings']) {
      const b = await page.getByTestId(id).boundingBox();
      expect(b && b.x + b.width <= page.viewportSize()!.width, id).toBe(true);
    }
    await page.getByRole('button', { name: /close/i }).click();
    const size = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      v: window.innerWidth,
    }));
    expect(size.w).toBeLessThanOrEqual(size.v);
  });

  test('rooms go in one after another without leaving the sheet @phone', async ({ page }) => {
    await newProject(page, 'Room after room');
    await page.getByTestId('nav-rooms').click();
    await expect(page.getByTestId('room-sheet')).toBeVisible();
    const types = ['living', 'kitchen', 'master_bedroom', 'bathroom'];
    for (let i = 0; i < types.length; i++) {
      await page.getByTestId(`room-type-${types[i]}`).click();
      await page.getByTestId('room-add').click();
      await waitForSaved(page, (p) => p.floors[0].rooms.length === i + 1);
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/phone-rooms.png` });
    const [p] = await storedProjects(page);
    expect(p.floors[0].rooms.map((r) => r.type).sort()).toEqual([...types].sort());
    expect(p.floors[0].openings.some((o) => o.kind === 'door')).toBe(true);
    expect(p.floors[0].objects.length).toBeGreaterThan(2);
    await page.getByTestId('rooms-done').click();
    await expect(page.getByTestId('nav-rooms')).toBeVisible();
  });

  test('choosing from the library shows pictures, and doors and furniture are separate @phone', async ({
    page,
  }) => {
    await openSample(page);
    await page.getByTestId('nav-add').click();
    await expect(page.getByTestId('lib-tab-recent')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('lib-tab-doors').click();
    await expect(page.locator('[data-testid=catalog-door_single] img.item-thumb')).toBeVisible({
      timeout: 20000,
    });
    await page.screenshot({ path: `${SHOTS}/phone-library-doors.png` });
    await expect(page.getByTestId('catalog-sofa_3')).toHaveCount(0);
    await page.getByTestId('lib-tab-windows').click();
    await expect(
      page
        .locator('[data-testid=catalog-win_sliding_2] img.item-thumb, .library-card img.item-thumb')
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await page.getByTestId('lib-tab-furniture').click();
    await expect(page.locator('.library-card img.item-thumb').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/phone-library-furniture.png` });
    await page.getByTestId('lib-tab-plants').click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/phone-library-plants.png` });
  });

  test('paint a room in 2D, with one tap @phone', async ({ page }) => {
    await newProject(page, 'Paint');
    await page.getByTestId('nav-rooms').click();
    await page.getByTestId('room-add').click();
    await waitForSaved(page, (p) => p.floors[0].rooms.length === 1);
    await page.getByTestId('rooms-done').click();
    await page.getByTestId('nav-paint').click();
    await page.getByTestId('paint-target-floor').click();
    await page.getByTestId('paint-teal').click();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS}/phone-paint.png` });
    const box = await canvasBox(page);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await waitForSaved(
      page,
      (p) => (p.floors[0].rooms[0] as unknown as { floorColor: string }).floorColor === '#2a8d8f',
    );
  });

  test('Explore starts at the house with a character, a stick and working doors @phone', async ({
    page,
  }) => {
    await openSample(page);
    await page.getByTestId('fab-explore').click();
    await expect(page.getByTestId('view3d')).toBeVisible();
    await expect(page.getByTestId('joystick')).toBeVisible();
    await expect(page.getByTestId('distance')).toHaveText(/\b([4-9]|1\d) m\b/, { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/phone-explore-start.png` });
    const start = await distanceNow(page);
    // Hold the stick forward: the house gets nearer.
    const stick = await page.getByTestId('joystick').boundingBox();
    const client = await page.context().newCDPSession(page);
    const point = { x: stick!.x + stick!.width / 2, y: stick!.y + stick!.height / 2 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x, y: point.y - 60 }],
    });
    await page.waitForTimeout(1500);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.screenshot({ path: `${SHOTS}/phone-explore-walk.png` });
    expect(await distanceNow(page)).toBeLessThan(start);
  });

  test('sizes on a phone: the chip clears the handles, and Done can be tapped @phone', async ({ page }) => {
    await newProject(page, 'Phone sizes');
    await page.getByTestId('nav-add').click();
    await page.getByTestId('lib-tab-furniture').click();
    await page.getByTestId('catalog-sofa_3').click();
    const box = await canvasBox(page);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByTestId('size-chip').click();
    await expect(page.getByTestId('size-popover')).toBeVisible();
    await page.getByTestId('size-0').fill('3m');
    await page.getByTestId('size-done').click();
    await expect(page.getByTestId('size-popover')).toHaveCount(0);
    type O = { floors: { objects: { width: number }[] }[] };
    await waitForSaved(page, (p) => (p as unknown as O).floors[0].objects[0]?.width === 3000);
    await expect(page.getByTestId('size-chip')).toBeVisible();
  });

  test('touch targets are at least 44 px @phone', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('open-sample').click();
    await expect(page.getByTestId('plan-canvas')).toBeVisible();
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button, select, input:not([type=file])')]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute('data-testid') ?? el.textContent ?? el.tagName,
            h: r.height,
            w: r.width,
          };
        })
        .filter((x) => x.w > 0 && (x.h < 44 || x.w < 44)),
    );
    expect(small).toEqual([]);
  });
});
