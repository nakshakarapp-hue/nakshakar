import { migrateProject } from '../model/migrations';
import { newId } from '../model/ids';
import type { Project } from '../model/types';

/** The file people send each other. It holds one whole house and opens in anyone's copy of the app. */
export const SHARE_EXTENSION = '.nakshakar';
const FORMAT = 'nakshakar-shared-house';
/** Files shared before the app was renamed. */
const OLD_FORMATS = ['gharnirman-shared-house'];
/** Far larger than any real house, so a wrong file is refused rather than freezing the app. */
const MAX_BYTES = 64 * 1024 * 1024;
const HEX = /^#[0-9a-f]{3,8}$/i;
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;
const LISTS = [
  'walls',
  'openings',
  'rooms',
  'stairs',
  'pillars',
  'beams',
  'slabs',
  'objects',
  'plants',
  'dimensions',
  'labels',
  'electrical',
  'plumbing',
  'hiddenCategories',
] as const;

export class SharedFileError extends Error {}

export function shareFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'house';
  return `${safe}${SHARE_EXTENSION}`;
}

export function packShared(project: Project): string {
  return JSON.stringify({ format: FORMAT, sharedAt: Date.now(), project });
}

/**
 * A file from someone else is not trusted. Anything that ends up in the page as a colour or an image
 * must be exactly that, and a key that could reach an object's prototype is dropped.
 */
function scrub(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => scrub(v, key));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = scrub(v, key === 'colors' ? 'color' : k);
    }
    return out;
  }
  if (typeof value === 'string') {
    if (/colou?r$/i.test(key) && value !== '') return HEX.test(value) ? value : '#999999';
    if (key === 'thumbnail') return IMAGE.test(value) ? value : '';
  }
  return value;
}

const isPoint = (p: unknown) =>
  !!p && Number.isFinite((p as { x: unknown }).x) && Number.isFinite((p as { y: unknown }).y);

/** Reads a shared file, or an older plain project export. Throws a SharedFileError on anything else. */
export function readShared(text: string): { project: Project; sharedAt: number | null } {
  if (text.length > MAX_BYTES) throw new SharedFileError('too-big');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SharedFileError('not-a-house');
  }
  const wrapped = parsed as { format?: unknown; project?: unknown; sharedAt?: unknown };
  const known = wrapped?.format === FORMAT || OLD_FORMATS.includes(String(wrapped?.format));
  const raw = known ? wrapped.project : parsed;
  const shape = raw as { floors?: unknown; id?: unknown; name?: unknown } | null;
  if (!shape || typeof shape !== 'object' || !Array.isArray(shape.floors) || !shape.floors.length) {
    throw new SharedFileError('not-a-house');
  }
  let project: Project;
  try {
    project = migrateProject(scrub(raw));
  } catch (error) {
    throw new SharedFileError((error as Error).name === 'ProjectTooNewError' ? 'too-new' : 'not-a-house');
  }
  for (const floor of project.floors) {
    if (!floor || typeof floor !== 'object' || typeof floor.id !== 'string')
      throw new SharedFileError('not-a-house');
    const lists = floor as unknown as Record<string, unknown>;
    for (const list of LISTS) if (!Array.isArray(lists[list])) lists[list] = [];
    floor.walls = floor.walls.filter((w) => isPoint(w?.start) && isPoint(w?.end));
    floor.openings = floor.openings.filter((o) => floor.walls.some((w) => w.id === o?.wallId));
    floor.rooms = floor.rooms.filter((r) => Array.isArray(r?.polygon) && r.polygon.every(isPoint));
  }
  if (typeof project.name !== 'string' || !project.name.trim()) project.name = 'Shared house';
  project.name = project.name.slice(0, 120);
  return {
    project,
    sharedAt: typeof wrapped?.sharedAt === 'number' ? wrapped.sharedAt : null,
  };
}

/** A copy that becomes the reader's own project, with nothing tying it to the sender's. */
export function ownCopy(project: Project): Project {
  const now = Date.now();
  return { ...project, id: newId(), createdAt: now, updatedAt: now };
}

/** What the person opening the file is told about it. */
export function sharedSummary(project: Project): { floors: number; rooms: number; area: number } {
  return {
    floors: project.floors.length,
    rooms: project.floors.reduce((n, f) => n + f.rooms.length, 0),
    area: project.floors.reduce((n, f) => n + f.rooms.reduce((a, r) => a + (Number(r.area) || 0), 0), 0),
  };
}
