import { expect, type Page } from '@playwright/test';

export interface StoredProject {
  id: string;
  name: string;
  updatedAt: number;
  floors: {
    id: string;
    name: string;
    walls: {
      id: string;
      start: { x: number; y: number };
      end: { x: number; y: number };
      thickness: number;
    }[];
    rooms: { name: string; area: number; type: string }[];
    openings: { kind: string; catalogId: string }[];
    objects: { catalogId: string; width: number }[];
    stairs: unknown[];
    pillars: unknown[];
    plants: unknown[];
  }[];
}

/** Reads saved projects straight out of IndexedDB, which is what survives a crash. */
export async function storedProjects(page: Page): Promise<StoredProject[]> {
  return page.evaluate(
    () =>
      new Promise<StoredProject[]>((resolve, reject) => {
        // The database keeps the app's old name, so houses saved before the rename are still there.
        const open = indexedDB.open('gharnirman');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('projects').objectStore('projects').getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result as StoredProject[]);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

export async function newProject(page: Page, name = 'Test house') {
  await page.goto('/');
  await page.getByTestId('new-name').fill(name);
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  await skipTour(page);
}

/** The guided first run starts on a first empty house; tests that are not about it skip it. */
export async function skipTour(page: Page) {
  const skip = page.getByTestId('tour-skip');
  await skip
    .waitFor({ timeout: 2500 })
    .then(() => skip.click())
    .catch(() => undefined);
}

export async function openSample(page: Page) {
  await page.goto('/');
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
}

/** Screen position of the canvas, for pointer input. */
export async function canvasBox(page: Page) {
  const box = await page.getByTestId('plan-canvas').boundingBox();
  if (!box) throw new Error('Canvas is not on screen');
  return box;
}

/** Drags on the canvas with real pointer events, offsets measured from the canvas's top-left. */
export async function dragOnCanvas(page: Page, from: [number, number], to: [number, number]) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
}

export async function tapCanvas(page: Page, at: [number, number]) {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + at[0], box.y + at[1]);
}

/** Waits until the autosave has reached the database and shows a condition holding. */
export async function waitForSaved(page: Page, test: (p: StoredProject) => boolean, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const all = await storedProjects(page);
    if (all.some(test)) return Date.now() - start;
    await page.waitForTimeout(50);
  }
  throw new Error(`Autosave did not reach the database within ${timeout} ms`);
}
