import { describe, expect, it } from 'vitest';
import { panBy, pinAt, toScreen, toWorld, type View } from '../editor2d/renderer';
import { isNewer, parseRelease, SITE_URL } from '../app/update';

describe('a plan turned with two fingers', () => {
  const view: View = { cx: 5000, cy: 3000, zoom: 0.08, w: 800, h: 600, rot: 0.6 };

  it('maps a point to the screen and back to the same place', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 5000, y: 3000 },
      { x: -1200, y: 8700 },
    ]) {
      const back = toWorld(view, toScreen(view, p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it('keeps the middle of the view in the middle of the screen', () => {
    const c = toScreen(view, { x: view.cx, y: view.cy });
    expect(c.x).toBeCloseTo(400);
    expect(c.y).toBeCloseTo(300);
  });

  it('turns clockwise: a point to the right of the middle moves down the screen', () => {
    const p = toScreen(view, { x: view.cx + 1000, y: view.cy });
    expect(p.y).toBeGreaterThan(300);
  });

  it('pans along the screen, whichever way the plan is turned', () => {
    const before = toScreen(view, { x: 1000, y: 1000 });
    const moved = panBy(view, 40, -25);
    const after = toScreen(moved, { x: 1000, y: 1000 });
    expect(after.x - before.x).toBeCloseTo(40, 6);
    expect(after.y - before.y).toBeCloseTo(-25, 6);
  });

  it('pins a plan point under the fingers', () => {
    const v = pinAt({ ...view, rot: 1.1, zoom: 0.12 }, { x: 2500, y: 4100 }, { x: 120, y: 480 });
    const s = toScreen(v, { x: 2500, y: 4100 });
    expect(s.x).toBeCloseTo(120, 6);
    expect(s.y).toBeCloseTo(480, 6);
  });

  it('is the same as before when not turned', () => {
    const flat: View = { ...view, rot: 0 };
    expect(toScreen(flat, { x: 6000, y: 3000 })).toEqual({ x: 480, y: 300 });
  });
});

describe('the new version notice', () => {
  it('compares versions number by number', () => {
    expect(isNewer('2.0.1', '2.0.0')).toBe(true);
    expect(isNewer('2.10.0', '2.9.9')).toBe(true);
    expect(isNewer('2.0', '2.0.0')).toBe(false);
    expect(isNewer('1.9.9', '2.0.0')).toBe(false);
  });

  it('reads only well-formed announcements, and only links to the website', () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ version: 'latest' })).toBeNull();
    const r = parseRelease({
      version: '2.1.0',
      date: '2026-12-01T10:00:00Z',
      notes: ['One', 2, 'Three'],
      android: { url: `${SITE_URL}downloads/v2.1.0/Nakshakar.apk`, size: 4_000_000 },
      windows: { url: 'https://example.com/evil.exe', size: 1 },
    });
    expect(r?.date).toBe('2026-12-01');
    expect(r?.notes).toEqual(['One', 'Three']);
    expect(r?.android?.size).toBe(4_000_000);
    expect(r?.windows).toBeUndefined();
  });
});
