import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { newId } from '../model/ids';
import type { Project } from '../model/types';

enablePatches();

/** How many steps are kept across a relaunch. Within a session undo is unlimited. */
export const PERSISTED_STEPS = 200;

/**
 * What a step touched. Undo and Redo work floor by floor: each floor has its own steps, and the Undo
 * button only ever takes back the floor on screen. Steps for the whole house (adding, removing or moving
 * floors, site and settings, a change made to several floors at once) are not undone from a floor; they
 * stay in the History list, which goes back through everything in order.
 *
 * floorIds lists the floors whose contents a whole-house step changed. A floor's older steps cannot be
 * undone past such a step, because they may no longer fit. Absent on steps saved by older versions,
 * which then count as touching every floor.
 */
export type EntryScope =
  | { kind: 'floor'; floorId: string }
  | { kind: 'project' }
  | { kind: 'shared'; floorIds?: string[] };

export interface HistoryEntry {
  id: string;
  /** Human-readable name shown in the history list. */
  name: string;
  at: number;
  patches: Patch[];
  inverse: Patch[];
  /** Absent on steps saved by older versions, which are treated as shared. */
  scope?: EntryScope;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const emptyHistory = (): HistoryState => ({ past: [], future: [] });

function scopeOf(project: Project, patches: Patch[]): EntryScope {
  const floors = new Set<number>();
  /** Floors whose contents change, by id. Moving a whole floor to another place is not a change to it. */
  const touched = new Set<string>();
  let other = false;
  let structure = false;
  const known = new Set(project.floors.map((f) => f.id));
  for (const { op, path, value } of patches) {
    if (path[0] === 'updatedAt') continue;
    if (path[0] !== 'floors') {
      other = true;
      continue;
    }
    if (path.length < 2 || typeof path[1] !== 'number') {
      structure = true;
      if (path.length === 1) project.floors.forEach((f) => touched.add(f.id));
      continue;
    }
    const before = project.floors[path[1]];
    if (path.length === 2) {
      structure = true;
      const id = (value as { id?: string } | undefined)?.id;
      if (op === 'remove') {
        if (before) touched.add(before.id);
      } else if (id && !known.has(id)) {
        touched.add(id);
      } else if (id && before && id === before.id) {
        touched.add(id);
      }
      continue;
    }
    floors.add(path[1]);
    if (before) touched.add(before.id);
  }
  if (structure || floors.size > 1 || (floors.size === 1 && other)) {
    return { kind: 'shared', floorIds: [...touched] };
  }
  const [only] = floors;
  const floor = only === undefined ? undefined : project.floors[only];
  if (only !== undefined && !floor) return { kind: 'shared' };
  return floor ? { kind: 'floor', floorId: floor.id } : { kind: 'project' };
}

/** Runs a recipe as one atomic, named command. Returns null when nothing changed. */
export function runCommand(
  project: Project,
  name: string,
  recipe: (draft: Project) => void,
): { project: Project; entry: HistoryEntry } | null {
  const [next, patches, inverse] = produceWithPatches(project, recipe);
  if (!patches.length) return null;
  return {
    project: next,
    entry: { id: newId(), name, at: Date.now(), patches, inverse, scope: scopeOf(project, patches) },
  };
}

/** Records a command, and discards the redo steps it has made impossible. */
export function pushEntry(state: HistoryState, entry: HistoryEntry): HistoryState {
  const scope = entry.scope ?? { kind: 'shared' };
  if (scope.kind === 'shared') return { past: [...state.past, entry], future: [] };
  // A shared step, and everything undone before it, may depend on what has just changed.
  const shared = state.future.findIndex((e) => (e.scope ?? { kind: 'shared' }).kind === 'shared');
  const reachable = shared < 0 ? state.future : state.future.slice(0, shared);
  const same = (e: HistoryEntry) => {
    const other = e.scope ?? { kind: 'shared' };
    return scope.kind === 'floor'
      ? other.kind === 'floor' && other.floorId === scope.floorId
      : other.kind === 'project';
  };
  return { past: [...state.past, entry], future: reachable.filter((e) => !same(e)) };
}

/**
 * Which step in a list comes next for this floor: its own latest step, passing over other floors' work
 * and whole-house steps that left this floor alone. -1 when there is none, or when a whole-house step
 * that changed this floor is in the way.
 */
function nextFor(list: HistoryEntry[], order: number[], floorId: string): number {
  for (const i of order) {
    const scope: EntryScope = list[i].scope ?? { kind: 'shared' };
    if (scope.kind === 'floor') {
      if (scope.floorId === floorId) return i;
      continue;
    }
    if (scope.kind === 'project') continue;
    if (!scope.floorIds || scope.floorIds.includes(floorId)) return -1;
  }
  return -1;
}

const pastOrder = (state: HistoryState) => state.past.map((_, i) => state.past.length - 1 - i);
const futureOrder = (state: HistoryState) => state.future.map((_, i) => i);

export function undoTarget(state: HistoryState, floorId: string): HistoryEntry | null {
  return state.past[nextFor(state.past, pastOrder(state), floorId)] ?? null;
}

export function redoTarget(state: HistoryState, floorId: string): HistoryEntry | null {
  return state.future[nextFor(state.future, futureOrder(state), floorId)] ?? null;
}

/** A floor can have moved in the building since a step was made, so its position is looked up by id. */
function located(project: Project, entry: HistoryEntry, patches: Patch[]): Patch[] {
  if (entry.scope?.kind !== 'floor') return patches;
  const { floorId } = entry.scope;
  const index = project.floors.findIndex((f) => f.id === floorId);
  if (index < 0) return patches.filter((p) => p.path[0] !== 'floors');
  return patches.map((p) =>
    p.path[0] === 'floors' ? { ...p, path: ['floors', index, ...p.path.slice(2)] } : p,
  );
}

function undoAt(project: Project, state: HistoryState, index: number) {
  const entry = state.past[index];
  return {
    project: applyPatches(project, located(project, entry, entry.inverse)),
    state: { past: state.past.filter((_, i) => i !== index), future: [entry, ...state.future] },
  };
}

function redoAt(project: Project, state: HistoryState, index: number) {
  const entry = state.future[index];
  return {
    project: applyPatches(project, located(project, entry, entry.patches)),
    state: { past: [...state.past, entry], future: state.future.filter((_, i) => i !== index) },
  };
}

/** Undoes the latest step on this floor, or across the project, and leaves other floors alone. */
export function undoOnFloor(project: Project, state: HistoryState, floorId: string) {
  const index = nextFor(state.past, pastOrder(state), floorId);
  return index < 0 ? null : undoAt(project, state, index);
}

export function redoOnFloor(project: Project, state: HistoryState, floorId: string) {
  const index = nextFor(state.future, futureOrder(state), floorId);
  return index < 0 ? null : redoAt(project, state, index);
}

/** Undoes the very latest step, whichever floor it was on. The history list goes back this way. */
export function undoStep(
  project: Project,
  state: HistoryState,
): { project: Project; state: HistoryState } | null {
  return state.past.length ? undoAt(project, state, state.past.length - 1) : null;
}

export function redoStep(
  project: Project,
  state: HistoryState,
): { project: Project; state: HistoryState } | null {
  return state.future.length ? redoAt(project, state, 0) : null;
}

/** The part of history worth keeping across a relaunch. */
export function persistableHistory(state: HistoryState): HistoryState {
  return { past: state.past.slice(-PERSISTED_STEPS), future: state.future.slice(0, PERSISTED_STEPS) };
}
