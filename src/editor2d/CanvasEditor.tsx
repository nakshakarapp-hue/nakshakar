import { stairLayout } from '../catalog/stairs';
import { bbox } from '../core/geometry/polygon';
import type { Floor, Stair } from '../core/model/types';
import { RotateCw, Check } from 'lucide-react';
import { sizeFields, SizePopover } from '../ui/SizePopover';
import { itemHandles, stairCenter } from './handles';
import { Maximize2, Minus, Plus, Settings, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { objectById, openingTypeById, plantById, STAIR_FINISHES, STAIR_TYPES } from '../catalog/catalog';
import { translateText, useT } from '../app/i18n';
import { activeFloor, useApp, type ToolId } from '../app/store';
import {
  createBeam,
  createObject,
  createOpening,
  createPillar,
  createPlant,
  createSlab,
  createStair,
  createWall,
  DEFAULT_INNER_THICKNESS,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  createLabel,
} from '../core/model/defaults';
import { newId } from '../core/model/ids';
import type { ElectricalKind, PlumbingKind, Project, Vec2, Wall } from '../core/model/types';
import { pointInPolygon } from '../core/geometry/polygon';
import {
  angleDeg,
  dist,
  fromAngle,
  leftNormal,
  mid,
  norm,
  snapPoint,
  sub,
  add,
  scale,
  dot,
} from '../core/geometry/vec';
import { pointOnWall, wallLength, wallPath } from '../core/geometry/wallGraph';
import { formatLength } from '../core/units';
import { AngleField, LengthField, SelectField, TextField, ToggleField } from '../ui/fields';
import { pasteClip, SelectionActions } from '../ui/SelectionActions';
import {
  addWallLoop,
  copyItems,
  findItem,
  paintRoomWalls,
  refsOfRoom,
  moveWallEnd,
  nearestWall,
  offsetWall,
  setWallLength,
  splitWall,
  translateItems,
  type ItemRef,
} from './commands';
import { floorPrims, primBounds, type Prim } from './drawing';
import { hitTest, itemsInside } from './hit';
import { CANVAS_FONT, drawCompass, drawGrid, drawMiniMap, drawPrims, drawRulers, toScreen, toWorld, zoomAt, type View, panBy, pinAt } from './renderer';
import { nearStart, snap, type SnapResult } from './snap';

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; last: Vec2; start: Vec2; rightClick: boolean }
  | { kind: 'pinch'; dist: number; center: Vec2; angle: number }
  | { kind: 'marquee'; start: Vec2; cur: Vec2 }
  | { kind: 'lasso'; pts: Vec2[] }
  | {
      kind: 'edit';
      base: Project;
      name: string;
      moved: boolean;
      start: Vec2;
      downScreen: Vec2;
      apply: (cur: Vec2, shift: boolean) => ((f: Project['floors'][number]) => void) | null;
      recipe: ((f: Project['floors'][number]) => void) | null;
    };

interface Colors {
  bg: string;
  ink: string;
  muted: string;
  grid: string;
  gridMajor: string;
  panel: string;
  accent: string;
  wall: string;
}

function readColors(): Colors {
  const s = getComputedStyle(document.documentElement);
  const get = (n: string) => s.getPropertyValue(n).trim();
  return {
    bg: get('--canvas'),
    ink: get('--ink'),
    muted: get('--muted'),
    grid: get('--grid'),
    gridMajor: get('--grid-major'),
    panel: get('--panel'),
    accent: get('--accent'),
    wall: get('--wall-fill'),
  };
}

const DRAW_TOOLS = ['wall', 'polygon', 'slab', 'rect', 'arc', 'dimension', 'beam'];
const PLACE_TOOLS = ['door', 'window', 'object', 'plant', 'pillar', 'stair', 'split', 'offset'];
/** Items that can be turned before they are placed. */
const TURNABLE_TOOLS = ['stair', 'object', 'pillar'];
const cursorFor = (tool: string) => (tool === 'select' ? 'default' : 'crosshair');

/** Single keys that pick a tool. Shown in each tool's tooltip. */
export const TOOL_KEYS: Record<string, string> = {
  v: 'select',
  l: 'lasso',
  w: 'wall',
  r: 'rect',
  p: 'polygon',
  a: 'arc',
  m: 'dimension',
  t: 'label',
  d: 'door',
  n: 'window',
  s: 'stair',
  f: 'object',
  g: 'plant',
  k: 'pillar',
  b: 'beam',
  o: 'paint',
};

/** These open the picture library first, because something has to be chosen. */
export const CATALOG_TOOLS: string[] = [
  'door',
  'window',
  'stair',
  'object',
  'plant',
  'pillar',
  'electrical',
  'plumbing',
];

const TAP_SLOP = 8;
const LONG_PRESS_MS = 550;
const DOUBLE_TAP_MS = 320;

let hapticLast = 0;
function tick(enabled: boolean) {
  if (!enabled || !Capacitor.isNativePlatform()) return;
  const now = Date.now();
  if (now - hapticLast < 60) return;
  hapticLast = now;
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}

export function fitView(prims: Prim[], w: number, h: number, rot = 0): View {
  const box = primBounds(prims);
  if (!box) return { cx: 3000, cy: 3000, zoom: Math.min(w, h) / 14000, w, h, rot };
  const pad = 70;
  // A turned plan takes the space of its turned outline.
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  const bw = Math.max(1000, box.maxX - box.minX);
  const bh = Math.max(1000, box.maxY - box.minY);
  const zoom = Math.min((w - pad * 2) / (bw * c + bh * s), (h - pad * 2) / (bw * s + bh * c));
  return {
    cx: (box.minX + box.maxX) / 2,
    cy: (box.minY + box.maxY) / 2,
    zoom: Math.min(0.5, zoom),
    w,
    h,
    rot,
  };
}

export function CanvasEditor() {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ cx: 3000, cy: 3000, zoom: 0.05, w: 1, h: 1 });
  const fitted = useRef(false);
  const dirty = useRef(true);
  const colorsRef = useRef<Colors | null>(null);
  const primCache = useRef<{
    key: unknown;
    settings: unknown;
    lang?: unknown;
    site?: unknown;
    prims: Prim[];
  }>({ key: null, settings: null, prims: [] });
  const pointers = useRef(new Map<number, Vec2>());
  const drag = useRef<Drag>({ kind: 'none' });
  const penActiveUntil = useRef(0);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef({ at: 0, p: { x: 0, y: 0 } });
  const lastSnapKind = useRef('none');
  const isTouchInput = useRef(false);
  const cursor = useRef<SnapResult | null>(null);
  const hoverWorld = useRef<Vec2 | null>(null);
  const spaceDown = useRef(false);
  const lastChainClick = useRef({ at: 0, p: { x: 0, y: 0 } });

  // Drawing-tool state. Refs for what the canvas reads each frame; panel state for what React shows.
  const chain = useRef<Vec2[]>([]);
  const justStarted = useRef(false);
  const [chainLength, setChainLength] = useState(0);
  const [wallDefaults, setWallDefaults] = useState({
    thickness: DEFAULT_WALL_THICKNESS,
    height: DEFAULT_WALL_HEIGHT,
    type: 'outer' as Wall['type'],
  });
  const armedTool = useApp((s) => s.tool);
  const armedArg = useApp((s) => s.toolArg);
  useEffect(() => {
    if (armedTool !== 'wall' || !armedArg) return;
    const type = armedArg as Wall['type'];
    setWallDefaults({
      type,
      thickness: type === 'inner' ? DEFAULT_INNER_THICKNESS : type === 'glass' ? 40 : DEFAULT_WALL_THICKNESS,
      height: type === 'parapet' || type === 'half' ? 1000 : type === 'compound' ? 1500 : DEFAULT_WALL_HEIGHT,
    });
  }, [armedTool, armedArg]);
  // Walls join one after another, each corner a tap, until Done. One wall at a time is a switch (C).
  const [connected, setConnectedState] = useState(true);
  const connectedRef = useRef(true);
  const setConnected = (on: boolean) => {
    connectedRef.current = on;
    setConnectedState(on);
  };
  const angleTyped = useRef(false);
  // The plan has been turned with two fingers, and a tap on the compass turns it back.
  const [turned, setTurned] = useState(false);
  const [wide, setWide] = useState(true);
  // A stair drawn by dragging from its bottom step to where it should reach.
  const stairDraw = useRef<{ start: Vec2; cur: Vec2; moved: boolean } | null>(null);
  // Which way the next item faces. R turns it, or the button beside the plan.
  const placeTurn = useRef(0);
  const [sizeEdit, setSizeEdit] = useState<ItemRef | null>(null);
  const selectionNow = useApp((s) => s.selection);
  useEffect(() => {
    setSizeEdit((cur) =>
      cur && selectionNow.some((r) => r.kind === cur.kind && r.id === cur.id) ? cur : null,
    );
  }, [selectionNow]);
  const [lengthSeed, setLengthSeed] = useState('');
  const [numeric, setNumericState] = useState({ length: 3000, angle: 0 });
  const numericRef = useRef(numeric);
  const setNumeric = (next: typeof numeric) => {
    numericRef.current = next;
    setNumericState(next);
  };
  const [offsetDistance, setOffsetDistance] = useState(1000);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState<{ at: Vec2; text: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [chip, setChip] = useState<{ x: number; y: number; text: string; wallId: string } | null>(null);
  const [lengthEdit, setLengthEdit] = useState<string | null>(null);
  const chipRef = useRef(chip);
  chipRef.current = chip;

  const tool = useApp((s) => s.tool);

  const redraw = useCallback(() => {
    dirty.current = true;
  }, []);

  const worldFromEvent = (e: { clientX: number; clientY: number }): { world: Vec2; screen: Vec2 } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return { world: toWorld(viewRef.current, screen), screen };
  };

  const snapAt = (world: Vec2, anchor?: Vec2, shift = false, ignoreIds?: Set<string>): SnapResult => {
    const s = useApp.getState();
    const floor = activeFloor(s);
    if (!floor || !s.project) return { point: world, kind: 'none', guides: [] };
    const result = snap(world, {
      floor,
      settings: s.project.settings,
      tolerance: 14 / viewRef.current.zoom,
      anchor,
      constrain: shift,
      ignoreIds,
      alignTo: [...floor.objects, ...floor.pillars].map((o) => ({ x: o.transform.x, y: o.transform.y })),
    });
    if (result.kind !== 'none' && result.kind !== 'grid' && result.kind !== lastSnapKind.current)
      tick(s.project.settings.snapOptions.haptics);
    lastSnapKind.current = result.kind;
    return result;
  };

  const resetTool = () => {
    chain.current = [];
    setChainLength(0);
    cursor.current = null;
    drag.current = { kind: 'none' };
    redraw();
  };

  useEffect(() => {
    resetTool();
    placeTurn.current = 0;
    setMenu(null);
    hoverWorld.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = cursorFor(tool);
    // Wall tool defaults depend on what is being drawn, and any tool change ends a chain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const addSegment = (a: Vec2, b: Vec2) => {
    const s = useApp.getState();
    if (dist(a, b) < 50) return false;
    const sa = snapPoint(a);
    const sb = snapPoint(b);
    s.commitFloor(
      'Draw wall',
      (f) => {
        f.walls.push(createWall(sa, sb, wallDefaults));
      },
      true,
    );
    return true;
  };

  /** Done drawing: back to Select, with the new wall chosen so it can be changed straight away. */
  const finishDrawing = () => {
    const s = useApp.getState();
    const drew = s.tool;
    const floor = activeFloor(s);
    const wall = drew === 'wall' || drew === 'arc' ? floor?.walls[floor.walls.length - 1] : undefined;
    resetTool();
    useApp.setState({
      tool: 'select',
      toolArg: '',
      selection: wall && chain.current.length === 0 ? [{ kind: 'wall', id: wall.id }] : [],
      lastPlace: { tool: drew, arg: s.toolArg },
    });
  };

  const finishChain = () => {
    finishDrawing();
  };

  const extendChain = (to: Vec2) => {
    const pts = chain.current;
    const last = pts[pts.length - 1];
    const first = pts[0];
    const closing = pts.length >= 3 && dist(to, first) <= 14 / viewRef.current.zoom;
    if (!addSegment(last, closing ? first : to)) return;
    if (closing) {
      useApp.getState().showToast(t('editor.roomClosed'));
      useApp.getState().markMilestone('Room closed');
      finishChain();
      return;
    }
    angleTyped.current = false;
    if (!connectedRef.current) {
      finishDrawing();
      return;
    }
    chain.current = [...pts, snapPoint(to)];
    setChainLength(chain.current.length);
  };

  const place = (world: Vec2) => {
    const s = useApp.getState();
    const floor = activeFloor(s);
    if (!floor || !s.project) return;
    const pt = snapAt(world).point;
    const select = (ref: ItemRef) => {
      useApp.setState({
        tool: 'select',
        toolArg: '',
        selection: [ref],
        lastPlace: { tool: s.tool, arg: s.toolArg },
      });
    };
    switch (s.tool) {
      case 'paint': {
        const { color, target } = s.paint;
        // Choosing Floor or Ceiling means that surface, even under a bed or a table.
        if (target === 'floor' || target === 'ceiling') {
          const room = floor.rooms.find((r) => pointInPolygon(world, r.polygon));
          if (!room) {
            s.showToast(t('paint.tapRoom'));
            break;
          }
          s.commitFloor(target === 'floor' ? 'Paint floor' : 'Paint ceiling', (f) => {
            const r = f.rooms.find((x) => x.id === room.id);
            if (r) r[target === 'floor' ? 'floorColor' : 'ceilingColor'] = color;
          });
          break;
        }
        if (target === 'outside') {
          s.commit('Paint outside walls', (d) => {
            d.elevationOverrides.wallColor = color;
          });
          break;
        }
        const hit = hitTest(floor, world, (isTouchInput.current ? 20 : 10) / viewRef.current.zoom);
        if (hit?.kind === 'object') {
          s.commitFloor('Paint item', (f) => {
            const o = f.objects.find((x) => x.id === hit.id);
            const part = o && Object.keys(o.colors)[0];
            if (o && part) o.colors[part] = color;
          });
        } else if (hit?.kind === 'wall') {
          const wall = floor.walls.find((w) => w.id === hit.id);
          if (!wall) return;
          const n = leftNormal(norm(sub(wall.end, wall.start)));
          const left = dot(sub(world, wall.start), n) >= 0;
          s.commitFloor('Paint wall', (f) => {
            const w = f.walls.find((x) => x.id === hit.id);
            if (w) w[left ? 'leftColor' : 'rightColor'] = color;
          });
        } else if (hit?.kind === 'room') {
          s.commitFloor('Paint room', (f) => {
            const r = f.rooms.find((x) => x.id === hit.id);
            if (!r) return;
            r.wallPaintColor = color;
            paintRoomWalls(f, r, color);
          });
        } else {
          s.showToast(t('paint.tapRoom'));
        }
        break;
      }
      case 'door':
      case 'window': {
        const near = nearestWall(floor, world, 40 / viewRef.current.zoom);
        if (!near) {
          s.showToast(t('editor.tapWall'));
          return;
        }
        const type =
          openingTypeById.get(s.toolArg) ?? [...openingTypeById.values()].find((o) => o.kind === s.tool)!;
        const length = wallLength(near.wall);
        const position = Math.max(type.width / 2, Math.min(length - type.width / 2, near.along));
        const id = newId();
        s.commitFloor(`Add ${type.name}`, (f) => {
          f.openings.push(
            createOpening(near.wall.id, position, type.kind, {
              id,
              catalogId: type.id,
              width: type.width,
              height: type.height,
              sillHeight: type.sill,
              lintelHeight: type.sill + type.height,
              panels: type.panels,
              shutterMaterial: type.shutterMaterial,
              shutterColor: type.shutterColor,
              frameColor: type.frameColor,
            }),
          );
        });
        select({ kind: 'opening', id });
        break;
      }
      case 'object': {
        const c = objectById.get(s.toolArg);
        if (!c) return;
        const item = createObject(
          c.id,
          pt,
          { width: c.width, depth: c.depth, height: c.height },
          c.name,
          { ...c.colors },
          c.mount ?? 0,
        );
        item.transform.rotation = placeTurn.current;
        s.commitFloor(`Add ${c.name}`, (f) => {
          f.objects.push(item);
        });
        select({ kind: 'object', id: item.id });
        break;
      }
      case 'plant': {
        const c = plantById.get(s.toolArg);
        if (!c) return;
        const item = createPlant(c.id, pt, c.spread, c.height, c.name, c.foliage, c.trunk);
        s.commitFloor(`Add ${c.name}`, (f) => {
          f.plants.push(item);
        });
        select({ kind: 'plant', id: item.id });
        break;
      }
      case 'stair': {
        const item = stairToPlace(pt, s.toolArg, floor, placeTurn.current);
        const c = { name: item.name };
        s.commitFloor(`Add ${c.name}`, (f) => {
          f.stairs.push(item);
        });
        select({ kind: 'stair', id: item.id });
        break;
      }
      case 'pillar': {
        const item = createPillar(pt, {
          height: floor.floorToFloor - floor.slabThickness,
          shape: s.toolArg === 'round' ? 'round' : 'rect',
        });
        item.transform.rotation = placeTurn.current;
        s.commitFloor('Add pillar', (f) => {
          f.pillars.push(item);
        });
        select({ kind: 'pillar', id: item.id });
        break;
      }
      case 'electrical': {
        const id = newId();
        s.commitFloor('Add electrical point', (f) => {
          f.electrical.push({
            id,
            at: pt,
            kind: (s.toolArg || 'socket') as ElectricalKind,
            height: 1200,
            note: '',
          });
        });
        break;
      }
      case 'plumbing': {
        const id = newId();
        s.commitFloor('Add plumbing point', (f) => {
          f.plumbing.push({ id, at: pt, kind: (s.toolArg || 'tap') as PlumbingKind, note: '' });
        });
        break;
      }
      case 'label':
        setLabelDraft({ at: pt, text: '' });
        break;
      case 'split': {
        const near = nearestWall(floor, world, 40 / viewRef.current.zoom);
        if (!near) {
          s.showToast(t('editor.tapWall'));
          return;
        }
        s.commitFloor(
          'Split wall',
          (f) => {
            splitWall(f, near.wall.id, near.along);
          },
          true,
        );
        break;
      }
      case 'offset': {
        const near = nearestWall(floor, world, 80 / viewRef.current.zoom);
        if (!near) {
          s.showToast(t('editor.tapWall'));
          return;
        }
        const n = leftNormal(norm(sub(near.wall.end, near.wall.start)));
        const side = dot(sub(world, near.point), n) >= 0 ? 1 : -1;
        s.commitFloor(
          'Offset wall',
          (f) => {
            offsetWall(f, near.wall.id, side * offsetDistance);
          },
          true,
        );
        break;
      }
      default:
        break;
    }
  };

  const openProps = (ref: ItemRef) => {
    useApp.setState({ selection: [ref], inspectorOpen: true });
  };

  const beginSelect = (world: Vec2, screen: Vec2, shift: boolean) => {
    const s = useApp.getState();
    const floor = activeFloor(s);
    if (!floor || !s.project) return;
    if (floor.locked) {
      s.showToast(t('editor.floorLocked'));
      return;
    }
    const reach = 18 / viewRef.current.zoom;
    const base = s.project;

    // Handles of a selected wall come first, because they are the smallest targets.
    if (s.selection.length === 1 && s.selection[0].kind === 'wall') {
      const wall = floor.walls.find((w) => w.id === s.selection[0].id);
      if (wall && !wall.locked) {
        for (const which of ['start', 'end'] as const) {
          if (dist(world, wall[which]) <= reach) {
            const other = which === 'start' ? wall.end : wall.start;
            drag.current = {
              kind: 'edit',
              base,
              name: 'Move wall end',
              moved: false,
              start: world,
              downScreen: screen,
              recipe: null,
              apply: (cur, sh) => {
                const hit = snapAt(cur, other, sh, new Set([wall.id]));
                cursor.current = hit;
                return (f) => moveWallEnd(f, wall.id, which, hit.point);
              },
            };
            return;
          }
        }
        const handle = thicknessHandle(wall);
        if (dist(world, handle.at) <= reach) {
          drag.current = {
            kind: 'edit',
            base,
            name: 'Change wall thickness',
            moved: false,
            start: world,
            downScreen: screen,
            recipe: null,
            apply: (cur) => {
              const d = Math.abs(dot(sub(cur, handle.origin), handle.normal));
              const thickness = Math.max(50, Math.round((d * 2) / 5) * 5);
              return (f) => {
                const w = f.walls.find((x) => x.id === wall.id);
                if (w) w.thickness = thickness;
              };
            },
          };
          return;
        }
      }
    }

    if (s.selection.length === 1 && !floor.locked) {
      const near = (isTouchInput.current ? 22 : 12) / viewRef.current.zoom;
      for (const h of visibleHandles(floor, s.selection[0], viewRef.current.zoom)) {
        if (dist(world, h.at) > near) continue;
        drag.current = {
          kind: 'edit',
          base,
          name: h.name,
          moved: false,
          start: world,
          downScreen: screen,
          recipe: null,
          apply: (cur, sh) => h.edit(cur, sh),
        };
        return;
      }
    }

    const hit = hitTest(floor, world, (isTouchInput.current ? 20 : 10) / viewRef.current.zoom);
    if (!hit) {
      if (!shift) s.setSelection([]);
      drag.current = { kind: 'marquee', start: world, cur: world };
      return;
    }
    const already = s.selection.some((r) => r.kind === hit.kind && r.id === hit.id);
    if (shift) {
      s.setSelection(
        already
          ? s.selection.filter((r) => !(r.kind === hit.kind && r.id === hit.id))
          : [...s.selection, hit],
      );
      return;
    }
    const refs = already ? s.selection : [hit];
    if (!already) s.setSelection(refs);
    // Dragging a room carries its walls and everything standing in it.
    const movable = refs
      .flatMap((r) => {
        if (r.kind !== 'room') return [r];
        const room = floor.rooms.find((x) => x.id === r.id);
        return room ? refsOfRoom(floor, room) : [];
      })
      .filter((r) => !findItem<{ locked?: boolean }>(floor, r)?.locked);
    if (!movable.length) return;

    // An opening slides along walls instead of translating freely.
    if (movable.length === 1 && movable[0].kind === 'opening') {
      const id = movable[0].id;
      drag.current = {
        kind: 'edit',
        base,
        name: 'Move opening',
        moved: false,
        start: world,
        downScreen: screen,
        recipe: null,
        apply: (cur) => {
          const bf = activeFloor({ project: base, activeFloorId: useApp.getState().activeFloorId });
          const near = bf && nearestWall(bf, cur, 60 / viewRef.current.zoom);
          if (!near) return null;
          return (f) => {
            const o = f.openings.find((x) => x.id === id);
            if (!o) return;
            o.wallId = near.wall.id;
            const length = wallLength(near.wall);
            o.position = Math.max(o.width / 2, Math.min(length - o.width / 2, near.along));
          };
        },
      };
      return;
    }

    const startSnap = snapAt(world).point;
    const ignore = new Set(movable.filter((r) => r.kind === 'wall').map((r) => r.id));
    drag.current = {
      kind: 'edit',
      base,
      name: movable.length > 1 ? `Move ${movable.length} items` : 'Move item',
      moved: false,
      start: world,
      downScreen: screen,
      recipe: null,
      apply: (cur, sh) => {
        const hitPoint = snapAt(cur, sh ? startSnap : undefined, sh, ignore);
        cursor.current = hitPoint;
        const delta = sub(hitPoint.point, startSnap);
        return (f) => translateItems(f, movable, delta);
      },
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const isTouch = e.pointerType === 'touch';
    isTouchInput.current = isTouch;
    if (e.pointerType === 'pen') penActiveUntil.current = Date.now() + 800;
    // Palm rejection: while a stylus is in play, touches on the canvas are ignored.
    if (isTouch && Date.now() < penActiveUntil.current) return;
    canvasRef.current?.setPointerCapture(e.pointerId);
    const { world, screen } = worldFromEvent(e);
    pointers.current.set(e.pointerId, screen);
    setMenu(null);

    if (pointers.current.size === 2) {
      // A second finger always means navigate: abandon whatever the first finger began.
      cancelEdit();
      if (longPress.current) clearTimeout(longPress.current);
      const [a, b] = [...pointers.current.values()];
      drag.current = {
        kind: 'pinch',
        dist: dist(a, b),
        center: mid(a, b),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
      return;
    }
    if (pointers.current.size > 2) return;
    if (e.button === 1 || e.button === 2 || spaceDown.current) {
      drag.current = { kind: 'pan', last: screen, start: screen, rightClick: e.button === 2 };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      return;
    }

    longPress.current = setTimeout(() => {
      if (!isTouch && e.pointerType !== 'pen') return;
      const s = useApp.getState();
      const floor = activeFloor(s);
      if (!floor || s.tool !== 'select') return;
      cancelEdit();
      const hit = hitTest(floor, world, 12 / viewRef.current.zoom);
      if (hit && !s.selection.some((r) => r.id === hit.id)) s.setSelection([hit]);
      setMenu({ x: screen.x, y: screen.y });
      drag.current = { kind: 'none' };
    }, LONG_PRESS_MS);

    const s = useApp.getState();
    if (s.tool !== 'select' && s.tool !== 'lasso' && activeFloor(s)?.locked) {
      s.showToast(t('editor.floorLocked'));
      return;
    }
    switch (s.tool) {
      case 'select':
        beginSelect(world, screen, e.shiftKey || s.multiSelect);
        break;
      case 'lasso':
        drag.current = { kind: 'lasso', pts: [world] };
        break;
      case 'stair':
        if (s.toolArg) {
          const p = snapAt(world).point;
          stairDraw.current = { start: p, cur: p, moved: false };
        }
        break;
      case 'wall':
      case 'polygon': {
        const anchor = chain.current[chain.current.length - 1];
        const hit = snapAt(world, anchor, e.shiftKey);
        cursor.current = hit;
        if (!chain.current.length) {
          chain.current = [snapPoint(hit.point)];
          justStarted.current = true;
          setChainLength(1);
        } else {
          justStarted.current = false;
        }
        break;
      }
      case 'rect':
      case 'slab':
      case 'arc':
      case 'dimension':
      case 'beam': {
        const hit = snapAt(world, chain.current[chain.current.length - 1], e.shiftKey);
        cursor.current = hit;
        if (!chain.current.length) {
          chain.current = [snapPoint(hit.point)];
          justStarted.current = true;
          setChainLength(1);
        } else {
          justStarted.current = false;
        }
        break;
      }
      default:
        break;
    }
    redraw();
  };

  const cancelEdit = () => {
    const d = drag.current;
    if (d.kind === 'edit') useApp.setState({ project: d.base });
    drag.current = { kind: 'none' };
    if (useApp.getState().tool !== 'select') {
      chain.current = chain.current.slice(0, justStarted.current ? 0 : chain.current.length);
      setChainLength(chain.current.length);
    }
    justStarted.current = false;
    cursor.current = null;
    stairDraw.current = null;
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { world, screen } = worldFromEvent(e);
    const prev = pointers.current.get(e.pointerId);
    if (prev) pointers.current.set(e.pointerId, screen);
    const d = drag.current;
    if (prev && dist(prev, screen) > TAP_SLOP && longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }

    if (d.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const nowDist = dist(a, b);
      const nowCenter = mid(a, b);
      const nowAngle = Math.atan2(b.y - a.y, b.x - a.x);
      const old = viewRef.current;
      // What was under the fingers stays under them while they spread, move and twist.
      const held = toWorld(old, d.center);
      let turn = nowAngle - d.angle;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      let rot = (old.rot ?? 0) + turn;
      // Square to the screen again when close, so it is easy to get back upright.
      const quarter = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(rot - quarter) < (3 * Math.PI) / 180 && Math.abs(turn) < 0.02) rot = quarter;
      rot = Math.atan2(Math.sin(rot), Math.cos(rot));
      const zoom = Math.max(0.004, Math.min(2.5, old.zoom * (nowDist / Math.max(1, d.dist))));
      viewRef.current = pinAt({ ...old, zoom, rot: Math.abs(rot) < 1e-6 ? 0 : rot }, held, nowCenter);
      setTurned(Math.abs(rot) > 1e-6);
      drag.current = { kind: 'pinch', dist: nowDist, center: nowCenter, angle: nowAngle };
      redraw();
      return;
    }
    if (d.kind === 'pan') {
      viewRef.current = panBy(viewRef.current, screen.x - d.last.x, screen.y - d.last.y);
      drag.current = { ...d, last: screen };
      redraw();
      return;
    }
    if (!prev && e.pointerType === 'touch') return;
    updateHover(world, e.pointerType === 'mouse' && !prev);

    if (d.kind === 'marquee' && prev) {
      drag.current = { ...d, cur: world };
      redraw();
      return;
    }
    if (d.kind === 'lasso' && prev) {
      d.pts.push(world);
      redraw();
      return;
    }
    if (d.kind === 'edit' && prev) {
      if (!d.moved && dist(screen, d.downScreen) < TAP_SLOP) return;
      d.moved = true;
      const recipe = d.apply(world, e.shiftKey);
      if (recipe) {
        d.recipe = recipe;
        useApp.getState().preview(d.base, recipe);
      }
      redraw();
      return;
    }

    const sd = stairDraw.current;
    if (sd && prev) {
      sd.cur = snapAt(world).point;
      if (!sd.moved && dist(sd.cur, sd.start) * viewRef.current.zoom > TAP_SLOP * 2) sd.moved = true;
      redraw();
      return;
    }
    const s = useApp.getState();
    if (DRAW_TOOLS.includes(s.tool) && (chain.current.length || e.pointerType === 'mouse')) {
      cursor.current = snapAt(world, chain.current[chain.current.length - 1], e.shiftKey);
      redraw();
    }
  };

  /** Mouse only: shows what a click would do before it happens. */
  const updateHover = (world: Vec2, hovering: boolean) => {
    const s = useApp.getState();
    hoverWorld.current = hovering && PLACE_TOOLS.includes(s.tool) ? world : null;
    if (hoverWorld.current) redraw();
    const c = canvasRef.current;
    const floor = activeFloor(s);
    if (hovering && c && floor && s.tool === 'select') {
      // A handle says what dragging it will do, before anything is dragged.
      const zoom = viewRef.current.zoom;
      const handle =
        s.selection.length === 1 && !floor.locked
          ? visibleHandles(floor, s.selection[0], zoom).find((h) => dist(world, h.at) <= 12 / zoom)
          : undefined;
      c.style.cursor = handle
        ? HANDLE_CURSOR[handle.shape]
        : hitTest(floor, world, 10 / zoom)
          ? 'pointer'
          : 'default';
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
    const wasTracked = pointers.current.delete(e.pointerId);
    if (!wasTracked) return;
    const d = drag.current;
    const { world, screen } = worldFromEvent(e);
    const s = useApp.getState();
    const floor = activeFloor(s);

    if (d.kind === 'pinch') {
      if (pointers.current.size < 2) drag.current = { kind: 'none' };
      return;
    }
    if (d.kind === 'pan') {
      drag.current = { kind: 'none' };
      if (canvasRef.current) canvasRef.current.style.cursor = cursorFor(s.tool);
      if (d.rightClick && dist(screen, d.start) < TAP_SLOP && floor && s.tool === 'select') {
        const hit = hitTest(floor, world, 12 / viewRef.current.zoom);
        if (hit && !s.selection.some((r) => r.id === hit.id)) s.setSelection([hit]);
        setMenu({ x: screen.x, y: screen.y });
      }
      return;
    }
    if (d.kind === 'marquee' && floor) {
      const x0 = Math.min(d.start.x, d.cur.x);
      const x1 = Math.max(d.start.x, d.cur.x);
      const y0 = Math.min(d.start.y, d.cur.y);
      const y1 = Math.max(d.start.y, d.cur.y);
      if ((x1 - x0) * viewRef.current.zoom > 6 || (y1 - y0) * viewRef.current.zoom > 6) {
        s.setSelection(itemsInside(floor, (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1));
      }
      drag.current = { kind: 'none' };
      redraw();
      return;
    }
    if (d.kind === 'lasso' && floor) {
      if (d.pts.length > 3) s.setSelection(itemsInside(floor, (p) => pointInPolygon(p, d.pts)));
      drag.current = { kind: 'none' };
      redraw();
      return;
    }
    if (d.kind === 'edit') {
      drag.current = { kind: 'none' };
      if (d.moved && d.recipe) s.commitFrom(d.base, d.name, d.recipe);
      else useApp.setState({ project: d.base });
      cursor.current = null;
      redraw();
      if (!d.moved) handleTap(world, screen);
      return;
    }

    const c = cursor.current?.point;
    const start = chain.current[0];
    const lastPt = chain.current[chain.current.length - 1];
    switch (s.tool) {
      case 'wall': {
        // Quick clicks on different corners are just fast drawing; a double click is in one spot.
        const now = Date.now();
        const isDouble =
          now - lastChainClick.current.at < DOUBLE_TAP_MS && dist(screen, lastChainClick.current.p) < 22;
        lastChainClick.current = { at: now, p: screen };
        if (isDouble && !justStarted.current) {
          finishChain();
        } else if (c && !(justStarted.current && dist(c, lastPt) < 50)) {
          extendChain(c);
        }
        justStarted.current = false;
        break;
      }
      case 'polygon': {
        // Quick clicks on different corners are just fast drawing; a double click is in one spot.
        const now = Date.now();
        const isDouble =
          now - lastChainClick.current.at < DOUBLE_TAP_MS && dist(screen, lastChainClick.current.p) < 22;
        lastChainClick.current = { at: now, p: screen };
        if (isDouble && chain.current.length >= 3) {
          closePolygon();
          justStarted.current = false;
          break;
        }
        if (c && !justStarted.current && dist(c, lastPt) >= 50) {
          if (chain.current.length >= 3 && dist(c, start) <= 14 / viewRef.current.zoom) {
            closePolygon();
          } else {
            chain.current = [...chain.current, snapPoint(c)];
            setChainLength(chain.current.length);
          }
        }
        justStarted.current = false;
        break;
      }
      case 'slab':
        if (c && start && !(justStarted.current && dist(c, start) < 50)) {
          if (Math.abs(c.x - start.x) >= 100 && Math.abs(c.y - start.y) >= 100) {
            const pts = [start, { x: c.x, y: start.y }, c, { x: start.x, y: c.y }];
            // Slabs usually roof a porch or shade a window, so a new one starts at wall-top height.
            const zOffset = floor?.walls[0]?.height ?? DEFAULT_WALL_HEIGHT;
            const slab = createSlab(orderClockwise(pts), { zOffset });
            s.commitFloor('Add slab', (f) => {
              f.slabs.push(slab);
            });
            resetTool();
            useApp.setState({
              tool: 'select',
              toolArg: '',
              selection: [{ kind: 'slab', id: slab.id }],
              lastPlace: { tool: 'slab', arg: '' },
            });
          } else {
            finishDrawing();
          }
        }
        justStarted.current = false;
        break;
      case 'rect':
        if (c && start && !(justStarted.current && dist(c, start) < 50)) {
          if (Math.abs(c.x - start.x) >= 100 && Math.abs(c.y - start.y) >= 100) {
            const pts = [start, { x: c.x, y: start.y }, c, { x: start.x, y: c.y }];
            s.commitFloor(
              'Draw rectangle',
              (f) => {
                addWallLoop(f, orderClockwise(pts), wallDefaults);
              },
              true,
            );
            s.markMilestone('Room added');
          }
          finishDrawing();
        }
        justStarted.current = false;
        break;
      case 'dimension':
        if (c && start && !(justStarted.current && dist(c, start) < 20)) {
          if (dist(c, start) >= 20) {
            s.commitFloor('Add dimension', (f) => {
              f.dimensions.push({ id: newId(), a: start, b: snapPoint(c), offset: 300, arrow: 'arrow' });
            });
          }
          finishDrawing();
        }
        justStarted.current = false;
        break;
      case 'beam':
        if (c && start && !(justStarted.current && dist(c, start) < 50)) {
          if (dist(c, start) >= 50) {
            s.commitFloor('Add beam', (f) => {
              f.beams.push(createBeam(start, snapPoint(c), { soffit: (floor?.floorToFloor ?? 3150) - 600 }));
            });
          }
          finishDrawing();
        }
        justStarted.current = false;
        break;
      case 'arc':
        if (c && !justStarted.current) {
          if (chain.current.length === 1 && dist(c, start) >= 100) {
            chain.current = [start, snapPoint(c)];
            setChainLength(2);
          } else if (chain.current.length === 2) {
            const [a, b] = chain.current;
            const chord = dist(a, b);
            const n = leftNormal(norm(sub(b, a)));
            const sag = dot(sub(c, mid(a, b)), n);
            const bulge = Math.max(-1, Math.min(1, (2 * sag) / chord));
            s.commitFloor(
              'Draw arc wall',
              (f) => {
                f.walls.push(createWall(a, b, { ...wallDefaults, bulge }));
              },
              true,
            );
            finishDrawing();
          }
        }
        justStarted.current = false;
        break;
      case 'select':
      case 'lasso':
        handleTap(world, screen);
        break;
      case 'stair': {
        const sd = stairDraw.current;
        stairDraw.current = null;
        if (sd?.moved && floor) {
          const item = stairFromDrag(sd.start, sd.cur, s.toolArg, floor);
          s.commitFloor(`Add ${item.name}`, (f) => {
            f.stairs.push(item);
          });
          resetTool();
          useApp.setState({
            tool: 'select',
            toolArg: '',
            selection: [{ kind: 'stair', id: item.id }],
            lastPlace: { tool: 'stair', arg: item.catalogId },
          });
        } else {
          place(world);
        }
        break;
      }
      default:
        place(world);
        break;
    }
    redraw();
  };

  const handleTap = (world: Vec2, screen: Vec2) => {
    const now = Date.now();
    const s = useApp.getState();
    const floor = activeFloor(s);
    if (floor && now - lastTap.current.at < DOUBLE_TAP_MS && dist(screen, lastTap.current.p) < 22) {
      const hit = hitTest(floor, world, 12 / viewRef.current.zoom);
      if (hit) openProps(hit);
    }
    lastTap.current = { at: now, p: screen };
  };

  const closePolygon = () => {
    const pts = chain.current;
    if (pts.length < 3) return;
    const s = useApp.getState();
    s.commitFloor(
      'Draw polygon',
      (f) => {
        addWallLoop(f, orderClockwise(pts), wallDefaults);
      },
      true,
    );
    s.markMilestone('Room added');
    finishDrawing();
  };

  const closeWallLoop = () => {
    if (chain.current.length >= 3) extendChain(chain.current[0]);
  };

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    viewRef.current = zoomAt(
      viewRef.current,
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      e.deltaY < 0 ? 1.12 : 1 / 1.12,
    );
    dirty.current = true;
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      const s = useApp.getState();
      // Keys belong to an open dialog, not to the plan behind it. The Rooms panel sits beside the plan.
      if (s.dialog && s.dialog !== 'rooms') return;
      if (s.dialog === 'rooms' && e.key === 'Enter') return;
      const live = latest.current;
      // By physical key, so shortcuts also work with a Hindi or Telugu keyboard layout switched on.
      const letter = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
      const command = e.ctrlKey || e.metaKey;
      const floorNow = activeFloor(s);
      if (command && letter === 'a') {
        e.preventDefault();
        if (floorNow) s.setSelection(itemsInside(floorNow, () => true));
      } else if (command && letter === 'x') {
        e.preventDefault();
        if (floorNow && s.selection.length) {
          s.setClip(copyItems(floorNow, s.selection));
          window.dispatchEvent(new CustomEvent('gn-delete'));
        }
      } else if (!command && !e.altKey && /^[0-9.]$/.test(e.key)) {
        // Typing a number types a size: the length of the wall being drawn, or of the chosen wall.
        const field = document.querySelector<HTMLInputElement>('[data-testid="draw-length"]');
        const only = s.selection.length === 1 ? s.selection[0] : null;
        if (field) {
          field.focus();
          field.select();
        } else if (only?.kind === 'wall') {
          e.preventDefault();
          setLengthSeed(e.key);
          setLengthEdit(only.id);
        } else if (only && floorNow && sizeFields(floorNow, only).length) {
          e.preventDefault();
          setLengthSeed(e.key);
          setSizeEdit(only);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const here = cursor.current?.point;
        if (chain.current.length) {
          if (s.tool === 'polygon' || s.tool === 'slab') live.closePolygon();
          else if (s.tool === 'wall' && connectedRef.current) live.finishDrawing();
          else if (s.tool === 'wall' && here) live.extendChain(here);
        } else if (s.selection.length === 1) {
          live.openProps(s.selection[0]);
        }
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 1000 : 100;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (floorNow && s.selection.length) {
          const refs = s.selection
            .flatMap((r) => {
              if (r.kind !== 'room') return [r];
              const room = floorNow.rooms.find((x) => x.id === r.id);
              return room ? refsOfRoom(floorNow, room) : [];
            })
            .filter((r) => !findItem<{ locked?: boolean }>(floorNow, r)?.locked);
          s.commitFloor('Move item', (f) => translateItems(f, refs, { x: dx, y: dy }), true);
        } else {
          viewRef.current = panBy(viewRef.current, -dx * 0.06, -dy * 0.06);
          redraw();
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        live.fitAll();
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        const floors = s.project?.floors ?? [];
        const next =
          floors[floors.findIndex((f) => f.id === s.activeFloorId) + (e.key === 'PageUp' ? 1 : -1)];
        if (next) s.setFloor(next.id);
      } else if (e.key === '?') {
        s.setDialog('shortcuts');
      } else if (!command && letter === 'c' && s.tool === 'wall') {
        setConnected(!connectedRef.current);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (command && letter === 'y') {
        e.preventDefault();
        s.redo();
      } else if (command && letter === 'c') {
        const floor = activeFloor(s);
        if (floor && s.selection.length) {
          s.setClip(copyItems(floor, s.selection));
          s.showToast(t('action.copied'));
        }
      } else if (command && letter === 'v') {
        e.preventDefault();
        pasteClip();
      } else if (e.key === 'Escape' && s.dialog === 'rooms') {
        s.setDialog(null);
      } else if (e.key === 'Escape') {
        // First Esc ends the drawing but keeps the tool; the next returns to Select.
        const drawing = chain.current.length > 0;
        cancelEdit();
        resetTool();
        s.setSelection([]);
        if (!drawing) s.setTool('select');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        window.dispatchEvent(new CustomEvent('gn-delete'));
      } else if (e.code === 'Space') {
        e.preventDefault();
        spaceDown.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      } else if (e.key === '+' || e.key === '=') {
        zoomBy(1.25);
      } else if (e.key === '-') {
        zoomBy(0.8);
      } else if (!command && letter === 'r' && TURNABLE_TOOLS.includes(s.tool) && s.toolArg) {
        placeTurn.current = (placeTurn.current + 90) % 360;
        redraw();
      } else if (!command && !e.altKey && TOOL_KEYS[letter]) {
        const id = TOOL_KEYS[letter] as ToolId;
        s.setTool(id);
        s.setDialog(CATALOG_TOOLS.includes(id) ? 'catalog' : null);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = cursorFor(useApp.getState().tool);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard commands run the current version of these, not the one from the first render.
  const latest = useRef<{
    closePolygon: () => void;
    finishDrawing: () => void;
    extendChain: (to: Vec2) => void;
    openProps: (ref: ItemRef) => void;
    fitAll: () => void;
  }>({
    closePolygon: () => undefined,
    finishDrawing: () => undefined,
    extendChain: () => undefined,
    openProps: () => undefined,
    fitAll: () => undefined,
  });

  // The draw loop runs only when something changed.
  useEffect(() => {
    let raf = 0;
    const unsub = useApp.subscribe(() => {
      dirty.current = true;
    });
    const resize = () => {
      const host = hostRef.current;
      const c = canvasRef.current;
      if (!host || !c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
      // Keep the top-left corner fixed, so opening the side panel does not make the plan jump.
      const old = viewRef.current;
      const shift = fitted.current ? 1 : 0;
      viewRef.current = {
        ...panBy(old, (-shift * (w - old.w)) / 2, (-shift * (h - old.h)) / 2),
        w,
        h,
      };
      setWide(w > 620);
      colorsRef.current = readColors();
      dirty.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (hostRef.current) ro.observe(hostRef.current);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!dirty.current) return;
      dirty.current = false;
      draw();
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fitTick = useApp((s) => s.fitTick);
  useEffect(() => {
    if (!fitTick) return;
    // Wait a frame so the new walls are in the drawing list.
    primCache.current = { key: null, settings: null, prims: [] };
    dirty.current = true;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const v = viewRef.current;
        const box = useApp.getState().roomPreview?.box;
        const outline = box
          ? [
              {
                t: 'poly' as const,
                pts: [
                  { x: box.minX, y: box.minY },
                  { x: box.maxX, y: box.minY },
                  { x: box.maxX, y: box.maxY },
                  { x: box.minX, y: box.maxY },
                ],
              },
            ]
          : [];
        const shown = [...primCache.current.prims, ...outline];
        if (shown.length) viewRef.current = fitView(shown, v.w, v.h, v.rot);
        dirty.current = true;
      }),
    );
    return () => cancelAnimationFrame(id);
  }, [fitTick]);

  const themeName = useApp((s) => s.prefs.theme);
  useEffect(() => {
    colorsRef.current = readColors();
    primCache.current = { key: null, settings: null, prims: [] };
    dirty.current = true;
  }, [themeName]);

  function thicknessHandle(wall: Wall) {
    const m = pointOnWall(wall, wallLength(wall) / 2);
    const normal = leftNormal(m.dir);
    return {
      origin: m.point,
      normal,
      at: add(m.point, scale(normal, wall.thickness / 2 + 18 / viewRef.current.zoom)),
    };
  }

  function draw() {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    const s = useApp.getState();
    const colors = colorsRef.current ?? readColors();
    if (!c || !ctx) return;
    const floor = activeFloor(s);
    const dpr = c.width / Math.max(1, viewRef.current.w);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = viewRef.current;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, v.w, v.h);
    if (!floor || !s.project) return;
    const settings = s.project.settings;

    if (
      primCache.current.key !== floor ||
      primCache.current.settings !== settings ||
      primCache.current.lang !== s.prefs.language ||
      primCache.current.site !== s.project.site
    ) {
      const below = s.project.floors[s.project.floors.indexOf(floor) - 1];
      primCache.current = {
        key: floor,
        settings,
        lang: s.prefs.language,
        site: s.project.site,
        prims: floorPrims(floor, {
          settings,
          ink: colors.ink,
          muted: colors.muted,
          wallFill: colors.wall,
          paper: colors.bg,
          ghost: below,
          site: floor.levelIndex === 0 ? s.project.site : undefined,
          roomLabel: (name) => translateText(s.prefs.language, name),
        }),
      };
      if (!fitted.current && v.w > 10) {
        viewRef.current = fitView(primCache.current.prims, v.w, v.h, v.rot);
        fitted.current = true;
      }
    }
    const view = viewRef.current;
    drawGrid(ctx, view, settings.displayUnit, colors.grid, colors.gridMajor);
    drawPrims(ctx, view, primCache.current.prims);
    drawOverlay(ctx, view, colors);
    const fmt = (mm: number) =>
      formatLength(mm, settings.displayUnit, settings.displayUnit === 'ftin' ? 0 : 2);
    // Rulers read along the screen edges, which only match the plan while it is upright.
    if (view.w > 620 && !view.rot)
      drawRulers(ctx, view, settings.displayUnit, fmt, { bg: colors.panel, ink: colors.muted });
    drawCompass(ctx, view.w - 36, view.w > 620 ? 58 : 34, 24, settings.northAngleDeg + ((view.rot ?? 0) * 180) / Math.PI, {
      ink: colors.ink,
      bg: colors.panel,
    });
    const mini =
      view.w > 500
        ? { x: view.w - 136, y: view.h - 106, w: 124, h: 94 }
        : { x: view.w - 92, y: view.h - 72, w: 84, h: 64 };
    if (view.h > 420)
      drawMiniMap(ctx, view, floor.walls, mini, {
        bg: colors.panel,
        ink: colors.muted,
        accent: colors.accent,
      });

    // Keep the tappable length label over the selected wall.
    let nextChip: typeof chip = null;
    if (s.selection.length === 1 && s.selection[0].kind === 'wall') {
      const wall = floor.walls.find((w) => w.id === s.selection[0].id);
      if (wall) {
        const l = wallLength(wall);
        const p = toScreen(view, pointOnWall(wall, l / 2).point);
        nextChip = {
          x: Math.round(p.x),
          y: Math.round(p.y),
          text: formatLength(l, settings.displayUnit, settings.precision),
          wallId: wall.id,
        };
      }
    }
    if (s.selection.length === 1 && s.selection[0].kind !== 'wall') {
      const ref = s.selection[0];
      const fields = sizeFields(floor, ref);
      if (fields.length) {
        const item = findItem<{ polygon?: Vec2[] }>(floor, ref);
        const pts =
          ref.kind === 'stair'
            ? stairLayout(item as unknown as Stair).outline
            : (item?.polygon ?? itemHandles(floor, ref, 0).map((h) => h.at));
        if (pts.length) {
          const box = bbox(pts);
          const p = toScreen(view, { x: (box.minX + box.maxX) / 2, y: box.maxY });
          // Below every handle, so it never sits on one that has to be grabbed.
          const lowest = Math.max(
            p.y,
            ...visibleHandles(floor, ref, view.zoom).map((h) => toScreen(view, h.at).y),
          );
          const fmtSize = (mm: number) => formatLength(mm, settings.displayUnit, settings.precision);
          nextChip = {
            x: Math.round(Math.max(70, Math.min(view.w - 70, p.x))),
            y: Math.round(Math.max(30, Math.min(view.h - 30, lowest + 36))),
            text:
              fields.length > 1
                ? `${fmtSize(fields[0].value)} × ${fmtSize(fields[1].value)}`
                : fmtSize(fields[0].value),
            wallId: ref.id,
          };
        }
      }
    }
    const cur = chipRef.current;
    if (
      nextChip?.x !== cur?.x ||
      nextChip?.y !== cur?.y ||
      nextChip?.text !== cur?.text ||
      nextChip?.wallId !== cur?.wallId
    )
      setChip(nextChip);
  }

  function drawOverlay(ctx: CanvasRenderingContext2D, v: View, colors: Colors) {
    const s = useApp.getState();
    const floor = activeFloor(s);
    if (!floor || !s.project) return;
    const S = (p: Vec2) => toScreen(v, p);
    const accent = colors.accent;

    if (s.roomPreview) {
      const { box, label } = s.roomPreview;
      const a = S({ x: box.minX, y: box.minY });
      const b = S({ x: box.maxX, y: box.maxY });
      ctx.save();
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.1;
      planBox(ctx, v, { x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY });
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = accent;
      ctx.font = `600 13px ${CANVAS_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, (a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(40, b.x - a.x - 8));
      ctx.restore();
    }

    for (const ref of s.selection) {
      ctx.strokeStyle = accent;
      ctx.fillStyle = `${accent}33`;
      ctx.lineWidth = 2;
      const it = findItem<Record<string, unknown>>(floor, ref);
      if (!it) continue;
      if (ref.kind === 'wall') {
        const wall = it as unknown as Wall;
        const path = wallPath(wall).map(S);
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        path.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.lineWidth = 3;
        ctx.stroke();
        if (s.selection.length === 1) {
          for (const end of [wall.start, wall.end]) {
            const p = S(end);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
            ctx.fillStyle = colors.panel;
            ctx.fill();
            ctx.stroke();
          }
          const h = S(thicknessHandle(wall).at);
          ctx.beginPath();
          ctx.rect(h.x - 7, h.y - 7, 14, 14);
          ctx.fillStyle = accent;
          ctx.fill();
        }
      } else if (ref.kind === 'opening') {
        const o = it as unknown as { wallId: string; position: number; width: number };
        const wall = floor.walls.find((w) => w.id === o.wallId);
        if (wall) {
          const m = pointOnWall(wall, o.position);
          const a = S(add(m.point, scale(m.dir, -o.width / 2)));
          const b = S(add(m.point, scale(m.dir, o.width / 2)));
          ctx.lineWidth = Math.max(5, wall.thickness * v.zoom);
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else if (ref.kind === 'stair') {
        const pts = stairLayout(it as unknown as Stair).outline.map(S);
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
      } else if (ref.kind === 'object' || ref.kind === 'pillar') {
        const pts = itemHandles(floor, ref, 0)
          .filter((h) => h.shape === 'corner')
          .map((h) => S(h.at));
        if (pts.length === 4) {
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.stroke();
        }
      } else if (ref.kind === 'room' || ref.kind === 'slab') {
        const r = it as unknown as { polygon: Vec2[] };
        const pts = r.polygon.map(S);
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if ('transform' in it) {
        const tr = it.transform as { x: number; y: number };
        const size = (it.width as number | undefined) ?? (it.spread as number | undefined) ?? 500;
        const p = S(tr);
        const r = Math.max(14, (size * v.zoom) / 2 + 4);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if ('at' in it) {
        const p = S(it.at as Vec2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      } else if ('start' in it) {
        const a = S(it.start as Vec2);
        const b = S(it.end as Vec2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if ('a' in it) {
        const a = S(it.a as Vec2);
        const b = S(it.b as Vec2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // What can be dragged: corners resize, the round handle on a stem turns.
    if (s.selection.length === 1) {
      for (const h of visibleHandles(floor, s.selection[0], v.zoom)) {
        const p = S(h.at);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        if (h.from) {
          const q = S(h.from);
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        ctx.fillStyle = h.shape === 'rotate' ? accent : colors.panel;
        ctx.beginPath();
        if (h.shape === 'corner') ctx.rect(p.x - 5, p.y - 5, 10, 10);
        else ctx.arc(p.x, p.y, h.shape === 'rotate' ? 7 : 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    const d = drag.current;
    if (d.kind === 'marquee') {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      planBox(ctx, v, d.start, d.cur);
      ctx.stroke();
      ctx.fillStyle = `${accent}22`;
      ctx.fill();
      ctx.setLineDash([]);
    }
    if (d.kind === 'lasso') {
      ctx.beginPath();
      d.pts.map(S).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // What a click would place, before the click.
    const drawn = stairDraw.current?.moved ? stairDraw.current : null;
    const hover = drawn ? drawn.start : hoverWorld.current;
    if (hover) {
      const P = S(hover);
      ctx.strokeStyle = accent;
      ctx.fillStyle = `${accent}33`;
      ctx.lineWidth = 2;
      if (s.tool === 'door' || s.tool === 'window' || s.tool === 'split' || s.tool === 'offset') {
        const near = nearestWall(floor, hover, 40 / v.zoom);
        if (near) {
          const type = openingTypeById.get(s.toolArg);
          const half = (s.tool === 'split' || s.tool === 'offset' ? 60 : (type?.width ?? 900)) / 2;
          const m = pointOnWall(near.wall, near.along);
          const a = S(add(m.point, scale(m.dir, -half)));
          const b = S(add(m.point, scale(m.dir, half)));
          ctx.save();
          ctx.lineWidth = Math.max(7, near.wall.thickness * v.zoom + 4);
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
        }
      } else if (s.tool === 'stair') {
        const layout = stairLayout(
          drawn
            ? stairFromDrag(drawn.start, drawn.cur, s.toolArg, floor)
            : stairToPlace(hover, s.toolArg, floor, placeTurn.current),
        );
        ctx.save();
        ctx.globalAlpha = 0.75;
        for (const step of layout.steps) {
          const pts = step.polygon.map(S);
          ctx.beginPath();
          pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        // The arrow shows which way is up.
        const line = layout.path.map(S);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        line.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.stroke();
        ctx.restore();
      } else {
        const size =
          s.tool === 'object'
            ? objectById.get(s.toolArg)
            : s.tool === 'plant'
              ? {
                  width: plantById.get(s.toolArg)?.spread ?? 500,
                  depth: plantById.get(s.toolArg)?.spread ?? 500,
                }
              : { width: 300, depth: 300 };
        const w = (size?.width ?? 500) * v.zoom;
        const d = (size?.depth ?? 500) * v.zoom;
        ctx.beginPath();
        if (s.tool === 'plant') ctx.arc(P.x, P.y, w / 2, 0, Math.PI * 2);
        else {
          ctx.save();
          ctx.translate(P.x, P.y);
          ctx.rotate((placeTurn.current * Math.PI) / 180 + (v.rot ?? 0));
          ctx.rect(-w / 2, -d / 2, w, d);
          ctx.restore();
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    // Tool previews.
    const pts = chain.current;
    const c = cursor.current;
    if (pts.length) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      const scr = pts.map(S);
      ctx.beginPath();
      scr.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      for (const p of scr) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
      }
      if (c) {
        const last = pts[pts.length - 1];
        const a = S(last);
        const b = S(c.point);
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        if (s.tool === 'rect') {
          planBox(ctx, v, pts[0], c.point, true);
        } else if (s.tool === 'arc' && pts.length === 2) {
          const [p0, p1] = pts;
          const chord = dist(p0, p1);
          const n = leftNormal(norm(sub(p1, p0)));
          const sag = dot(sub(c.point, mid(p0, p1)), n);
          const bulge = Math.max(-1, Math.min(1, (2 * sag) / chord));
          const preview = wallPath({ start: p0, end: p1, bulge }).map(S);
          preview.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        } else {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const settings = s.project.settings;
        const length = dist(last, c.point);
        const label = `${formatLength(length, settings.displayUnit, settings.precision)}  ${Math.round(((angleDeg(sub(c.point, last)) + 360) % 360) * 10) / 10}°`;
        ctx.font = `600 13px ${CANVAS_FONT}`;
        const m = ctx.measureText(label).width;
        ctx.fillStyle = colors.panel;
        ctx.fillRect(b.x + 12, b.y - 28, m + 12, 22);
        ctx.fillStyle = colors.ink;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, b.x + 18, b.y - 17);
        if (s.tool !== 'rect' && pts.length >= 3 && nearStart(c.point, pts[0], 14 / v.zoom)) {
          const first = S(pts[0]);
          ctx.beginPath();
          ctx.arc(first.x, first.y, 16, 0, Math.PI * 2);
          ctx.strokeStyle = '#27ae60';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
    }
    if (c) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#27ae60';
      ctx.lineWidth = 1;
      for (const g of c.guides) {
        const a = S(g.a);
        const b = S(g.b);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (c.kind !== 'none' && c.kind !== 'grid') {
        const p = S(c.point);
        ctx.beginPath();
        ctx.rect(p.x - 6, p.y - 6, 12, 12);
        ctx.strokeStyle = '#27ae60';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    viewRef.current = zoomAt(v, { x: v.w / 2, y: v.h / 2 }, factor);
    redraw();
  };

  const fitAll = () => {
    const v = viewRef.current;
    viewRef.current = fitView(primCache.current.prims, v.w, v.h, v.rot);
    redraw();
  };

  const addByNumbers = (over: Partial<typeof numeric> = {}, followCursor = false) => {
    const pts = chain.current;
    if (!pts.length) return;
    const { length, angle } = { ...numericRef.current, ...over };
    const last = pts[pts.length - 1];
    const towards = followCursor && !angleTyped.current ? cursor.current?.point : undefined;
    const span = towards ? dist(last, towards) : 0;
    // A length alone goes the way the mouse is pointing.
    extendChain(
      span > 100
        ? {
            x: last.x + ((towards!.x - last.x) * length) / span,
            y: last.y + ((towards!.y - last.y) * length) / span,
          }
        : add(last, fromAngle(angle, length)),
    );
    redraw();
    // Ready for the next side straight away.
    document.querySelector<HTMLInputElement>('[data-testid="draw-length"]')?.select();
  };

  latest.current = { closePolygon, finishDrawing, extendChain, openProps, fitAll };

  // A room previewed off the edge of the view brings the view to it.
  const roomPreview = useApp((s) => s.roomPreview);
  useEffect(() => {
    if (!roomPreview) return;
    const v = viewRef.current;
    const { box } = roomPreview;
    const a = toScreen(v, { x: box.minX, y: box.minY });
    const b = toScreen(v, { x: box.maxX, y: box.maxY });
    if (a.x >= 30 && a.y >= 30 && b.x <= v.w - 30 && b.y <= v.h - 30) {
      redraw();
      return;
    }
    const outline = {
      t: 'poly' as const,
      pts: [
        { x: box.minX, y: box.minY },
        { x: box.maxX, y: box.minY },
        { x: box.maxX, y: box.maxY },
        { x: box.minX, y: box.maxY },
      ],
    };
    viewRef.current = fitView([...primCache.current.prims, outline], v.w, v.h, v.rot);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomPreview]);

  const showWallPanel =
    (tool === 'wall' && chainLength > 0) || tool === 'rect' || tool === 'polygon' || tool === 'arc';
  // Drawing needs the canvas: only the wall tool's typing bar stays up, and settings open on request.
  const panelOpen = tool === 'wall' || settingsOpen;
  const selection = useApp((s) => s.selection);

  return (
    <div className="canvas-host" ref={hostRef} data-testid="canvas-host">
      <canvas
        ref={canvasRef}
        data-testid="plan-canvas"
        className="plan-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          cancelEdit();
          redraw();
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <button
        className={turned ? 'north-up turned' : 'north-up'}
        style={{ top: wide ? 34 : 10 }}
        data-testid="north-up"
        aria-label={t('editor.northUp')}
        title={t('editor.northUp')}
        onClick={() => {
          viewRef.current = { ...viewRef.current, rot: 0 };
          setTurned(false);
          redraw();
        }}
      />
      <button
        className="btn fab fit"
        onClick={fitAll}
        aria-label={t('editor.fit')}
        title={`${t('editor.fit')} (Home)`}
        data-testid="fit-view"
      >
        <Maximize2 size={17} aria-hidden="true" />
      </button>
      <button
        className="btn fab zoom-in"
        onClick={() => zoomBy(1.25)}
        aria-label={t('editor.zoomIn')}
        title={t('editor.zoomIn')}
        data-testid="zoom-in"
      >
        <Plus size={18} aria-hidden="true" />
      </button>
      <button
        className="btn fab zoom-out"
        onClick={() => zoomBy(0.8)}
        aria-label={t('editor.zoomOut')}
        title={t('editor.zoomOut')}
        data-testid="zoom-out"
      >
        <Minus size={18} aria-hidden="true" />
      </button>

      {chip && selection.length === 1 && lengthEdit !== chip.wallId && sizeEdit?.id !== chip.wallId ? (
        <button
          className="length-chip"
          style={{ left: chip.x, top: chip.y }}
          data-testid={selection[0].kind === 'wall' ? 'length-chip' : 'size-chip'}
          onClick={() =>
            selection[0].kind === 'wall' ? setLengthEdit(chip.wallId) : setSizeEdit(selection[0])
          }
        >
          {chip.text}
        </button>
      ) : null}
      {tool === 'wall' && chainLength > 0 ? (
        <button className="btn primary draw-finish" data-testid="wall-finish" onClick={finishChain}>
          <Check size={17} aria-hidden="true" />
          {chainLength > 1 ? t('editor.finishWalls') : t('common.cancel')}
        </button>
      ) : null}
      {sizeEdit ? (
        <SizePopover
          refItem={sizeEdit}
          seed={lengthSeed}
          onClose={() => {
            setSizeEdit(null);
            setLengthSeed('');
          }}
        />
      ) : null}
      {lengthEdit ? (
        <LengthPopover
          wallId={lengthEdit}
          seed={lengthSeed}
          onClose={() => {
            setLengthEdit(null);
            setLengthSeed('');
          }}
        />
      ) : null}

      {showWallPanel && !panelOpen ? (
        <button
          className="btn small panel-toggle"
          data-testid="wall-settings"
          onClick={() => setSettingsOpen(true)}
        >
          {t('editor.wallSettings')}
        </button>
      ) : null}
      {showWallPanel && panelOpen ? (
        <div className="float-panel" data-testid="wall-panel">
          {settingsOpen ? (
            <button
              className="btn small panel-close"
              aria-label={t('common.hide')}
              onClick={() => setSettingsOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
          {settingsOpen ? (
            <div className="float-grid">
              <LengthField
                label={t('wall.thickness')}
                value={wallDefaults.thickness}
                min={25}
                onCommit={(thickness) => setWallDefaults({ ...wallDefaults, thickness })}
                testId="draw-thickness"
              />
              <LengthField
                label={t('wall.height')}
                value={wallDefaults.height}
                min={100}
                onCommit={(height) => setWallDefaults({ ...wallDefaults, height })}
                testId="draw-height"
              />
              <SelectField
                label={t('wall.type')}
                value={wallDefaults.type}
                options={(
                  ['outer', 'inner', 'parapet', 'retaining', 'compound', 'half', 'glass'] as const
                ).map((id) => ({ id, label: t(`walltype.${id}`) }))}
                onCommit={(type) =>
                  setWallDefaults({
                    ...wallDefaults,
                    type,
                    thickness: type === 'inner' ? DEFAULT_INNER_THICKNESS : wallDefaults.thickness,
                    height: type === 'parapet' || type === 'half' ? 1000 : wallDefaults.height,
                  })
                }
              />
            </div>
          ) : null}
          <div className="float-row">
            {tool === 'wall' ? (
              <>
                <LengthField
                  label={t('wall.length')}
                  value={numeric.length}
                  min={50}
                  onCommit={(length) => setNumeric({ ...numericRef.current, length })}
                  onEnter={(length) => addByNumbers({ length }, true)}
                  testId="draw-length"
                />
                <AngleField
                  label={t('wall.angle')}
                  value={numeric.angle}
                  onCommit={(angle) => {
                    angleTyped.current = true;
                    setNumeric({ ...numericRef.current, angle });
                  }}
                  onEnter={(angle) => addByNumbers({ angle })}
                  testId="draw-angle"
                />
              </>
            ) : null}
            <div className="float-actions">
              {tool === 'wall' ? (
                <>
                  <button className="btn primary" data-testid="draw-add" onClick={() => addByNumbers()}>
                    {t('editor.addWall')}
                  </button>
                  <ToggleField
                    label={t('editor.connected')}
                    value={connected}
                    onCommit={setConnected}
                    testId="draw-connected"
                  />
                  {connected ? (
                    <button
                      className="btn"
                      disabled={chainLength < 3}
                      data-testid="draw-close"
                      onClick={closeWallLoop}
                    >
                      {t('editor.closeLoop')}
                    </button>
                  ) : null}
                  <button className="btn" onClick={finishChain} data-testid="draw-done">
                    {t('common.done')}
                  </button>
                  {!settingsOpen ? (
                    <button
                      className="btn"
                      data-testid="wall-settings"
                      title={t('editor.wallSettings')}
                      aria-label={t('editor.wallSettings')}
                      onClick={() => setSettingsOpen(true)}
                    >
                      <Settings size={17} aria-hidden="true" />
                    </button>
                  ) : null}
                </>
              ) : null}
              {tool === 'polygon' ? (
                <button className="btn primary" disabled={chainLength < 3} onClick={closePolygon}>
                  {t('editor.closeLoop')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {TURNABLE_TOOLS.includes(tool) && armedArg ? (
        <div className="float-panel place-panel">
          <button
            className="btn"
            data-testid="place-rotate"
            onClick={() => {
              placeTurn.current = (placeTurn.current + 90) % 360;
              redraw();
            }}
          >
            <RotateCw size={16} aria-hidden="true" /> {t('place.rotate')}
          </button>
        </div>
      ) : null}

      {tool === 'offset' ? (
        <div className="float-panel">
          <LengthField
            label={t('editor.offsetDistance')}
            value={offsetDistance}
            min={50}
            onCommit={setOffsetDistance}
          />
          <p className="hint">{t('hint.offset')}</p>
        </div>
      ) : null}

      {labelDraft ? (
        <div
          className="float-panel"
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.querySelector<HTMLButtonElement>('.btn.primary')?.click();
            if (e.key === 'Escape') setLabelDraft(null);
          }}
        >
          <TextField
            label={t('editor.labelText')}
            value={labelDraft.text}
            autoFocus
            onCommit={(text) => setLabelDraft({ ...labelDraft, text })}
            testId="label-text"
          />
          <div className="float-actions">
            <button
              className="btn primary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                const input = (e.currentTarget.closest('.float-panel') as HTMLElement).querySelector(
                  'input',
                ) as HTMLInputElement;
                const text = input.value.trim();
                if (text) {
                  useApp.getState().commitFloor('Add label', (f) => {
                    f.labels.push(createLabel(labelDraft.at, text));
                  });
                }
                setLabelDraft(null);
              }}
            >
              {t('common.add')}
            </button>
            <button className="btn" onClick={() => setLabelDraft(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {menu ? <ContextActions x={menu.x} y={menu.y} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

function LengthPopover({ wallId, seed, onClose }: { wallId: string; seed: string; onClose: () => void }) {
  const t = useT();
  const wall = useApp((s) => activeFloor(s)?.walls.find((w) => w.id === wallId));
  const [anchor, setAnchor] = useState<'end' | 'start' | 'both'>('end');
  if (!wall) return null;
  return (
    <div className="float-panel size-panel" data-testid="length-popover">
      <LengthField
        label={t('wall.length')}
        value={wallLength(wall)}
        min={50}
        autoFocus
        seed={seed}
        onEnter={() => onClose()}
        testId="wall-length-input"
        onCommit={(length) => {
          useApp
            .getState()
            .commitFloor('Change wall length', (f) => setWallLength(f, wallId, length, anchor), true);
        }}
      />
      <div className="two-col">
        <LengthField
          label={t('wall.height')}
          value={wall.height}
          min={100}
          testId="wall-height-input"
          onCommit={(height) =>
            useApp.getState().commitFloor('Change wall height', (f) => {
              const w = f.walls.find((x) => x.id === wallId);
              if (w) w.height = height;
            })
          }
        />
        <LengthField
          label={t('wall.thickness')}
          value={wall.thickness}
          min={25}
          testId="wall-thickness-input"
          onCommit={(thickness) =>
            useApp.getState().commitFloor(
              'Change wall thickness',
              (f) => {
                const w = f.walls.find((x) => x.id === wallId);
                if (w) w.thickness = thickness;
              },
              true,
            )
          }
        />
      </div>
      <SelectField
        label={t('wall.lengthMoves')}
        value={anchor}
        options={[
          { id: 'end', label: t('wall.moveEnd') },
          { id: 'start', label: t('wall.moveStart') },
          { id: 'both', label: t('wall.moveBoth') },
        ]}
        onCommit={setAnchor}
      />
      <button className="btn primary size-done" data-testid="length-done" onClick={onClose}>
        {t('common.done')}
      </button>
    </div>
  );
}

function ContextActions({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  return (
    // Beside the finger, never under it: lifting the finger must not tap a menu item.
    <div
      className="context-menu"
      style={{ left: x + 228 < window.innerWidth ? x + 28 : Math.max(8, x - 228), top: Math.max(30, y - 60) }}
      data-testid="context-menu"
      onClick={onClose}
    >
      <SelectionActions vertical />
    </div>
  );
}

/** A new stair, centred on where it is being placed and facing the chosen way. */
function stairToPlace(at: Vec2, arg: string, floor: Floor, turn: number): Stair {
  const c = STAIR_TYPES.find((x) => x.id === arg) ?? STAIR_TYPES[2];
  const finish = STAIR_FINISHES[c.id];
  const item = createStair(at, {
    catalogId: c.id,
    shape: c.shape,
    name: c.name,
    totalRise: floor.floorToFloor,
    ...(finish ? { treadColor: finish.tread, railColor: finish.rail } : {}),
  });
  item.transform.rotation = turn;
  const middle = stairCenter(item);
  item.transform.x = Math.round(item.transform.x + at.x - middle.x);
  item.transform.y = Math.round(item.transform.y + at.y - middle.y);
  return item;
}

/**
 * A stair drawn by dragging: it starts at the press, climbs the way the drag goes, at any angle, and its
 * treads stretch so it reaches where the drag ended. Close to square with the walls, it snaps square.
 */
function stairFromDrag(start: Vec2, end: Vec2, arg: string, floor: Floor): Stair {
  const item = stairToPlace(start, arg, floor, 0);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const square = Math.round(deg / 90) * 90;
  deg = (Math.abs(deg - square) <= 4 ? square : Math.round(deg / 5) * 5) % 360;
  const reach = Math.hypot(dx, dy);
  const at = (s: Stair) => ({ ...s, transform: { ...s.transform, x: 0, y: 0, rotation: 0 } });
  if (item.shape === 'spiral') {
    item.width = Math.round(Math.max(600, Math.min(1500, reach / 2)));
  } else {
    // How far the stair runs grows steadily with its tread, so two sizes give the tread for any reach.
    const run = (tread: number) => {
      const ys = stairLayout(at({ ...item, tread })).outline.map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    const perMm = (run(300) - run(250)) / 50;
    const fixed = run(250) - perMm * 250;
    item.tread = Math.round(Math.max(220, Math.min(400, (reach - fixed) / Math.max(1, perMm))));
  }
  item.transform.rotation = deg;
  const foot = stairLayout({ ...item, transform: { ...item.transform, x: 0, y: 0 } }).path[0];
  item.transform.x = Math.round(start.x - foot.x);
  item.transform.y = Math.round(start.y - foot.y);
  return item;
}

const HANDLE_CURSOR = { corner: 'nwse-resize', edge: 'ew-resize', rotate: 'grab', point: 'move' } as const;

/** Handles worth showing at this zoom: corners on something tiny would only get in the way of dragging it. */
function visibleHandles(floor: Floor, ref: ItemRef, zoom: number) {
  const all = itemHandles(floor, ref, 34 / zoom);
  const corners = all.filter((h) => h.shape === 'corner');
  if (corners.length >= 2 && dist(corners[0].at, corners[1].at) * zoom < 26) {
    return all.filter((h) => h.shape !== 'corner');
  }
  return all;
}

/** A box square to the plan, which on a turned plan is turned on screen too. */
function planBox(ctx: CanvasRenderingContext2D, v: View, a: Vec2, b: Vec2, keepPath = false) {
  if (!keepPath) ctx.beginPath();
  const pts = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map((p) => toScreen(v, p));
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function orderClockwise(points: Vec2[]): Vec2[] {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += p.x * q.y - q.x * p.y;
  }
  return area >= 0 ? points : [...points].reverse();
}
