import { ownCopy, readShared, SharedFileError } from '../core/storage/shared';
import { translate } from './i18n';
import type { Id } from '../core/model/types';
import { produce } from 'immer';
import { create } from 'zustand';
import { createFloor, createProject, createWall } from '../core/model/defaults';
import { newId } from '../core/model/ids';
import type { Floor, Language, LengthUnit, Project, ThemeName } from '../core/model/types';
import {
  emptyHistory,
  persistableHistory,
  pushEntry,
  redoOnFloor,
  redoStep,
  undoOnFloor,
  undoTarget,
  redoTarget,
  runCommand,
  undoStep,
  type HistoryState,
} from '../core/history/history';
import { addSnapshot, loadHistory, loadProject, saveHistory, saveProject } from '../core/storage/db';
import { writeBackup } from '../core/storage/backup';
import { Autosaver } from '../core/storage/autosave';
import type { PaintTarget } from '../catalog/paints';
import {
  copyFloor,
  floorNameFor,
  moveFloor,
  relevelFloors,
  syncRooms,
  type Clip,
  type ItemRef,
} from '../editor2d/commands';
import { renderThumbnail } from '../editor2d/thumbnail';

export interface RoomPreview {
  box: { minX: number; minY: number; maxX: number; maxY: number };
  label: string;
}

export type Screen = 'home' | 'editor' | 'view3d' | 'explore' | 'vastu' | 'estimate' | 'print';

export type ToolId =
  | 'select'
  | 'lasso'
  | 'wall'
  | 'rect'
  | 'polygon'
  | 'slab'
  | 'paint'
  | 'arc'
  | 'door'
  | 'window'
  | 'object'
  | 'plant'
  | 'stair'
  | 'pillar'
  | 'beam'
  | 'dimension'
  | 'label'
  | 'electrical'
  | 'plumbing'
  | 'split'
  | 'offset';

export type DialogId =
  | 'wizard'
  | 'perimeter'
  | 'plot'
  | 'catalog'
  | 'rooms'
  | 'more'
  | 'shortcuts'
  | 'floors'
  | 'materials'
  | 'layers'
  | 'site'
  | 'settings'
  | 'history'
  | 'versions'
  | 'converter'
  | 'snap'
  | 'project';

export interface Prefs {
  language: Language;
  theme: ThemeName;
  displayUnit: LengthUnit;
  secondaryUnit: LengthUnit;
  /** Most recently added first. */
  recents?: RecentItem[];
  /** The guided first run has been finished or skipped. */
  tourDone?: boolean;
}

export interface RecentItem {
  tool: ToolId;
  arg: string;
}

const AUTO_SNAPSHOT_MS = 10 * 60 * 1000;

interface AppState {
  screen: Screen;
  prefs: Prefs;
  project: Project | null;
  activeFloorId: string;
  history: HistoryState;
  selection: ItemRef[];
  tool: ToolId;
  /** Catalogue id or sub-type for the active placement tool. */
  toolArg: string;
  dialog: DialogId | null;
  inspectorOpen: boolean;
  /** While on, tapping an item adds it to the selection instead of replacing it. */
  multiSelect: boolean;
  clip: Clip | null;
  /** What was last placed, so one tap can place another. */
  lastPlace: { tool: ToolId; arg: string } | null;
  paint: { color: string; target: PaintTarget };
  /** Bumped to ask the plan to fit itself to the screen. */
  fitTick: number;
  toast: string;
  saveError: string;
  lastSavedAt: number;

  go(screen: Screen): void;
  setPrefs(p: Partial<Prefs>): void;
  /** The guided first run is on screen. */
  tourOpen: boolean;
  openProject(project: Project, history?: HistoryState): void;
  closeProject(): Promise<void>;
  setFloor(id: string): void;
  setTool(tool: ToolId, arg?: string): void;
  setDialog(d: DialogId | null): void;
  setSelection(s: ItemRef[]): void;
  setInspector(open: boolean): void;
  setClip(c: Clip | null): void;
  setPaint(p: Partial<{ color: string; target: PaintTarget }>): void;
  requestFit(): void;
  showToast(text: string): void;

  /** Runs a named, atomic, undoable edit on the project. */
  commit(name: string, recipe: (draft: Project) => void): void;
  /** As commit, on the active floor. Set rooms to re-detect them as part of the same step. */
  commitFloor(name: string, recipe: (floor: Floor, draft: Project) => void, rooms?: boolean): void;
  /** Shows a live drag result built from a base project without recording it. */
  preview(base: Project, recipe: (floor: Floor) => void): void;
  /** Finishes a drag as one undoable step, measured from the same base. */
  commitFrom(base: Project, name: string, recipe: (floor: Floor) => void, rooms?: boolean): void;
  undo(): void;
  /** Undoes or redoes the very latest step, on whichever floor. The history list steps back this way. */
  undoLatest(): void;
  redoLatest(): void;
  addRecent(item: RecentItem): void;
  /** A house from someone else, which nothing can change until it is saved as the reader's own. */
  readOnly: boolean;
  pendingShared: { project: Project; sharedAt: number | null } | null;
  setPendingShared(p: { project: Project; sharedAt: number | null } | null): void;
  openSharedText(text: string): void;
  viewShared(): void;
  saveShared(): Promise<void>;
  redo(): void;
  addFloor(kind?: 'upper' | 'basement' | 'terrace', mode?: 'empty' | 'layout' | 'all', sourceId?: Id): void;
  moveFloor(id: Id, direction: 1 | -1): void;
  roomPreview: RoomPreview | null;
  setRoomPreview(p: RoomPreview | null): void;
  /** Saves pending work immediately; used when the app is backgrounded. */
  flush(): Promise<void>;
  markMilestone(name: string): void;
}

export const activeFloor = (s: Pick<AppState, 'project' | 'activeFloorId'>): Floor | null =>
  s.project?.floors.find((f) => f.id === s.activeFloorId) ?? s.project?.floors[0] ?? null;

let snapshotAt = 0;
let snapshotTimer: ReturnType<typeof setInterval> | null = null;

export const useApp = create<AppState>((set, get) => {
  const saver = new Autosaver<Project>(
    async (p) => {
      await saveProject(p);
      await saveHistory(p.id, persistableHistory(get().history));
      set({ lastSavedAt: Date.now(), saveError: '' });
    },
    (p) => writeBackup(p),
    (error) => set({ saveError: error instanceof Error ? error.message : String(error) }),
  );

  const touched = (project: Project, history: HistoryState) => {
    set({ project, history });
    saver.schedule(project);
  };

  const inFloor = (draft: Project, recipe: (floor: Floor, draft: Project) => void, rooms: boolean) => {
    const id = get().activeFloorId;
    const floor = draft.floors.find((f) => f.id === id) ?? draft.floors[0];
    recipe(floor, draft);
    if (rooms) syncRooms(floor, draft.settings.northAngleDeg);
    draft.updatedAt = Date.now();
  };

  return {
    screen: 'home',
    prefs: { language: 'en', theme: 'light', displayUnit: 'ftin', secondaryUnit: 'm' },
    project: null,
    readOnly: false,
    tourOpen: false,
    pendingShared: null,
    activeFloorId: '',
    history: emptyHistory(),
    selection: [],
    tool: 'select',
    toolArg: '',
    dialog: null,
    inspectorOpen: false,
    multiSelect: false,
    clip: null,
    lastPlace: null,
    paint: { color: '#f7cfae', target: 'walls' },
    fitTick: 0,
    toast: '',
    saveError: '',
    lastSavedAt: 0,

    go: (screen) => set({ screen }),
    setPendingShared: (pendingShared) => set({ pendingShared }),
    openSharedText: (text) => {
      try {
        set({ pendingShared: readShared(text) });
      } catch (error) {
        const reason = error instanceof SharedFileError ? error.message : 'not-a-house';
        get().showToast(translate(get().prefs.language, `shared.error.${reason}`));
      }
    },
    viewShared: () => {
      const pending = get().pendingShared;
      if (!pending) return;
      if (snapshotTimer) clearInterval(snapshotTimer);
      snapshotTimer = null;
      set({
        project: pending.project,
        pendingShared: null,
        readOnly: true,
        history: emptyHistory(),
        activeFloorId: pending.project.floors[0]?.id ?? '',
        selection: [],
        tool: 'select',
        lastPlace: null,
        screen: 'editor',
        dialog: null,
      });
    },
    saveShared: async () => {
      const shared = get().pendingShared?.project ?? (get().readOnly ? get().project : null);
      if (!shared) return;
      const own = ownCopy(shared);
      await saveProject(own);
      set({ pendingShared: null });
      get().openProject(own);
      get().showToast(translate(get().prefs.language, 'shared.saved'));
    },
    addRecent: (item) => {
      const others = (get().prefs.recents ?? []).filter((r) => r.tool !== item.tool || r.arg !== item.arg);
      set((s) => ({ prefs: { ...s.prefs, recents: [item, ...others].slice(0, 12) } }));
    },
    setPrefs: (p) => {
      set((s) => ({ prefs: { ...s.prefs, ...p } }));
      const { project } = get();
      if (project) {
        const next = produce(project, (d) => {
          Object.assign(d.settings, p);
        });
        set({ project: next });
        if (!get().readOnly) saver.schedule(next);
      }
    },
    openProject: (project, history) => {
      snapshotAt = project.updatedAt;
      set({
        project,
        readOnly: false,
        history: history ?? emptyHistory(),
        activeFloorId: project.floors[0]?.id ?? '',
        selection: [],
        tool: 'select',
        screen: 'editor',
        dialog: null,
      });
      // A project gets its filesystem safety copy as soon as it opens, not only after the first edit.
      saver.schedule(project);
      if (snapshotTimer) clearInterval(snapshotTimer);
      snapshotTimer = setInterval(() => {
        const p = get().project;
        if (p && p.updatedAt > snapshotAt) {
          snapshotAt = p.updatedAt;
          void addSnapshot(p, new Date().toLocaleString(), 'auto');
        }
      }, AUTO_SNAPSHOT_MS);
    },
    closeProject: async () => {
      const open = get().readOnly ? null : get().project;
      if (open) {
        // Not an edit, so it stays out of the undo history.
        const withThumb = produce(open, (d) => {
          d.thumbnail = renderThumbnail(open);
        });
        saver.schedule(withThumb);
      }
      await saver.flush();
      if (snapshotTimer) clearInterval(snapshotTimer);
      snapshotTimer = null;
      set({
        project: null,
        readOnly: false,
        screen: 'home',
        history: emptyHistory(),
        selection: [],
        dialog: null,
      });
    },
    setFloor: (activeFloorId) => set({ activeFloorId, selection: [] }),
    setTool: (tool, arg = '') => set({ tool, toolArg: arg, selection: [] }),
    setDialog: (dialog) => set({ dialog }),
    setSelection: (selection) => set({ selection }),
    setInspector: (inspectorOpen) => set({ inspectorOpen }),
    setClip: (clip) => set({ clip }),
    setPaint: (p) => set((s) => ({ paint: { ...s.paint, ...p } })),
    requestFit: () => set((s) => ({ fitTick: s.fitTick + 1 })),
    showToast: (toast) => {
      set({ toast });
      setTimeout(() => {
        if (get().toast === toast) set({ toast: '' });
      }, 2600);
    },

    commit: (name, recipe) => {
      if (get().readOnly) {
        get().showToast(translate(get().prefs.language, 'shared.readOnly'));
        return;
      }
      const { project, history } = get();
      if (!project) return;
      const done = runCommand(project, name, (d) => {
        recipe(d);
        d.updatedAt = Date.now();
      });
      if (done) touched(done.project, pushEntry(history, done.entry));
    },
    commitFloor: (name, recipe, rooms = false) => {
      if (get().readOnly) {
        get().showToast(translate(get().prefs.language, 'shared.readOnly'));
        return;
      }
      const { project, history } = get();
      if (!project) return;
      const done = runCommand(project, name, (d) => inFloor(d, recipe, rooms));
      if (done) touched(done.project, pushEntry(history, done.entry));
    },
    preview: (base, recipe) => {
      if (get().readOnly) return;
      set({ project: produce(base, (d) => inFloor(d, recipe, false)) });
    },
    commitFrom: (base, name, recipe, rooms = true) => {
      if (get().readOnly) {
        get().showToast(translate(get().prefs.language, 'shared.readOnly'));
        return;
      }
      const done = runCommand(base, name, (d) => inFloor(d, recipe, rooms));
      if (done) touched(done.project, pushEntry(get().history, done.entry));
      else set({ project: base });
    },
    undo: () => {
      const { project, history, activeFloorId } = get();
      if (!project) return;
      const r = undoOnFloor(project, history, activeFloorId);
      if (!r) {
        if (history.past.length) get().showToast(translate(get().prefs.language, 'undo.otherFloor'));
        return;
      }
      touched(r.project, r.state);
      set({
        selection: [],
        activeFloorId: r.project.floors.some((f) => f.id === activeFloorId)
          ? activeFloorId
          : (r.project.floors[0]?.id ?? ''),
      });
    },
    redo: () => {
      const { project, history, activeFloorId } = get();
      if (!project) return;
      const r = redoOnFloor(project, history, activeFloorId);
      if (!r) return;
      touched(r.project, r.state);
      set({
        selection: [],
        activeFloorId: r.project.floors.some((f) => f.id === activeFloorId)
          ? activeFloorId
          : (r.project.floors[0]?.id ?? ''),
      });
    },
    undoLatest: () => {
      const { project, history, activeFloorId } = get();
      const r = project && undoStep(project, history);
      if (!r) return;
      touched(r.project, r.state);
      set({
        selection: [],
        activeFloorId: r.project.floors.some((f) => f.id === activeFloorId)
          ? activeFloorId
          : (r.project.floors[0]?.id ?? ''),
      });
    },
    redoLatest: () => {
      const { project, history, activeFloorId } = get();
      const r = project && redoStep(project, history);
      if (!r) return;
      touched(r.project, r.state);
      set({
        selection: [],
        activeFloorId: r.project.floors.some((f) => f.id === activeFloorId)
          ? activeFloorId
          : (r.project.floors[0]?.id ?? ''),
      });
    },
    moveFloor: (id, direction) => get().commit('Move floor', (d) => void moveFloor(d.floors, id, direction)),
    roomPreview: null,
    setRoomPreview: (roomPreview) => set({ roomPreview }),
    addFloor: (kind = 'upper', mode = 'empty', sourceId) => {
      const { project } = get();
      if (!project) return;
      const top = project.floors[project.floors.length - 1];
      const first = project.floors[0];
      const id = newId();
      get().commit(
        kind === 'basement' ? 'Add basement' : kind === 'terrace' ? 'Add terrace' : 'Add floor',
        (d) => {
          if (kind === 'basement') {
            d.floors.unshift(createFloor('Basement', first.levelIndex - 1, first.elevation - 3150, { id }));
            return;
          }
          if (kind === 'terrace') {
            const terrace = createFloor('Terrace', top.levelIndex + 1, top.elevation + top.floorToFloor, {
              id,
              floorToFloor: 1000,
            });
            // A terrace starts with a parapet along the outer walls of the floor below.
            terrace.walls = d.floors[d.floors.length - 1].walls
              .filter((w) => w.type === 'outer')
              .map((w) =>
                createWall(w.start, w.end, {
                  type: 'parapet',
                  height: 1000,
                  thickness: 150,
                  bulge: w.bulge,
                  points: w.points,
                }),
              );
            syncRooms(terrace, d.settings.northAngleDeg);
            terrace.rooms.forEach((r) => {
              r.type = 'terrace';
              r.name = 'Terrace';
              r.userNamed = true;
              r.floorFinish = 'cement';
              r.floorColor = '#c9c5bb';
            });
            d.floors.push(terrace);
            return;
          }
          const basements = d.floors.filter((f) => f.levelIndex < 0).length;
          const source = d.floors.find((f) => f.id === (sourceId ?? get().activeFloorId));
          const fresh =
            mode !== 'empty' && source
              ? copyFloor(source, id, mode)
              : createFloor(floorNameFor(0), 0, 0, {
                  id,
                  floorToFloor: source?.floorToFloor ?? top.floorToFloor,
                });
          fresh.name = 'Floor 0';
          // A terrace stays on top of the house.
          const last = d.floors.length - 1;
          d.floors.splice(/terrace/i.test(d.floors[last].name) ? last : last + 1, 0, fresh);
          relevelFloors(d.floors, basements);
        },
      );
      set({ activeFloorId: id, selection: [] });
      get().markMilestone('Floor added');
    },
    flush: () => {
      // Backgrounding is a good moment to refresh the project list picture. It is not an edit, so no undo step.
      const open = get().readOnly ? null : get().project;
      if (open) {
        const next = produce(open, (d) => {
          d.thumbnail = renderThumbnail(open);
        });
        set({ project: next });
        saver.schedule(next);
      }
      return saver.flush();
    },
    markMilestone: (name) => {
      const p = get().readOnly ? null : get().project;
      if (p) void addSnapshot(p, name, 'milestone');
    },
  };
});

/** Opens a stored project with the undo history saved alongside it. */
export async function openStoredProject(id: string): Promise<boolean> {
  const project = await loadProject(id);
  if (!project) return false;
  const history = (await loadHistory(id)) ?? emptyHistory();
  useApp.getState().openProject(project, history);
  return true;
}

/** Creates a blank project with the user's preferred units and opens it. */
export async function startNewProject(name: string): Promise<void> {
  const { prefs } = useApp.getState();
  const project = createProject(name);
  Object.assign(project.settings, prefs);
  await saveProject(project);
  useApp.getState().openProject(project);
}

export { undoTarget };
export { redoTarget };
