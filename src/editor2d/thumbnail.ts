import type { Project } from '../core/model/types';
import { floorPrims, primBounds } from './drawing';
import { drawPrims } from './renderer';

/** A small PNG of the first floor that has walls, for the project list. Empty if there is nothing to show. */
export function renderThumbnail(project: Project, width = 320, height = 200): string {
  if (typeof document === 'undefined') return '';
  const floor = project.floors.find((f) => f.walls.length) ?? project.floors[0];
  if (!floor) return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const prims = floorPrims(floor, {
    settings: { ...project.settings, showDimensions: false, showArea: false, showFurnitureLabels: false },
    ink: '#1b2733',
    muted: '#5a6876',
    wallFill: '#8d99a6',
    paper: '#ffffff',
    forPrint: true,
  }).filter((p) => p.t !== 'text');
  const box = primBounds(prims);
  if (!box) return '';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const zoom = Math.min(
    (width - 16) / Math.max(1, box.maxX - box.minX),
    (height - 16) / Math.max(1, box.maxY - box.minY),
  );
  drawPrims(
    ctx,
    { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, zoom, w: width, h: height },
    prims,
  );
  return canvas.toDataURL('image/png');
}
