import { ArrowLeft, ChevronsUp, Eye, PaintBucket, Plus, SlidersHorizontal } from 'lucide-react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Motion } from '@capacitor/motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useT } from '../app/i18n';
import { useApp } from '../app/store';
import { objectById, OBJECTS, plantById, PLANTS } from '../catalog/catalog';
import { createObject, createPlant } from '../core/model/defaults';
import { segmentIntersection } from '../core/geometry/vec';
import type { Project } from '../core/model/types';
import { ToggleField } from '../ui/fields';
import { PaintBar } from '../ui/PaintBar';
import { ItemThumb } from '../ui/ItemThumb';
import { buildHouse, type BuiltHouse, type MovablePart, type SurfaceTag } from './builder';
import { createCharacter, type Character } from './character';
import { createMaterials } from './textures';
import { EYE_HEIGHT_M, floorAtHeight, nextFeetHeight, standHeights, moveWithCollisions } from './walk';
import { createWorld, type World } from './world';

type Mode = 'orbit' | 'walk' | 'vr' | 'look360';
type Placing = { kind: 'plant' | 'object'; id: string } | null;

interface Orbit {
  theta: number;
  phi: number;
  radius: number;
  target: THREE.Vector3;
}

const WALK_SPEED = 2.4;
const RUN_SPEED = 5.2;
const TURN_SPEED = 1.9;
const JUMP_SPEED = 4.2;
const GRAVITY = 11;
const IPD = 0.063;
/** Metres behind the character. Further on a tall screen, so the character does not fill it. */
const followDistance = (aspect: number) => (aspect < 1 ? 4.8 : 3.6);

interface MovableMesh {
  part: MovablePart;
  mesh: THREE.Mesh;
  amount: number;
}

interface Built {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  movables: MovableMesh[];
}

function buildGroup(
  house: BuiltHouse,
  materials: ReturnType<typeof createMaterials>,
  shadows: boolean,
): Built {
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  for (const [key, bucket] of house.buckets) {
    if (!bucket.positions.length) continue;
    const mesh = new THREE.Mesh(bucket.toGeometry(), materials.get(key));
    mesh.renderOrder = key === 'glass' ? 2 : 0;
    mesh.userData.tags = bucket.tags;
    if (shadows && key !== 'glass') {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    group.add(mesh);
    meshes.push(mesh);
  }
  const movables: MovableMesh[] = house.movables.map((part) => {
    const geometry = part.bucket.toGeometry();
    geometry.translate(-part.pivot[0], -part.pivot[1], -part.pivot[2]);
    const mesh = new THREE.Mesh(geometry, materials.get(part.bucketKey));
    mesh.position.set(...part.pivot);
    mesh.userData.tags = part.bucket.tags;
    mesh.renderOrder = part.bucketKey === 'glass' ? 2 : 0;
    if (shadows && part.bucketKey !== 'glass') mesh.castShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    return { part, mesh, amount: 0 };
  });
  return { group, meshes, movables };
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
  });
}

/** Paints whatever a tap in 3D landed on, as one undoable step. */
function applyPaint(tag: SurfaceTag, color: string): void {
  const s = useApp.getState();
  const inFloor = (d: Project, id: string) => d.floors.find((f) => f.id === id);
  switch (tag.kind) {
    case 'wall':
      s.commit('Paint wall', (d) => {
        // An elevation colour would hide a painted outer face, so painting ends that override.
        const f = inFloor(d, tag.floorId);
        const w = f?.walls.find((x) => x.id === tag.id);
        if (w) {
          if (w.type === 'outer') d.elevationOverrides.wallColor = undefined;
          w[tag.side === 'left' ? 'leftColor' : 'rightColor'] = color;
        }
      });
      break;
    case 'floor':
      s.commit('Paint floor', (d) => {
        const r = inFloor(d, tag.floorId)?.rooms.find((x) => x.id === tag.id);
        if (r) r.floorColor = color;
      });
      break;
    case 'ceiling':
      s.commit('Paint ceiling', (d) => {
        const r = inFloor(d, tag.floorId)?.rooms.find((x) => x.id === tag.id);
        if (r) r.ceilingColor = color;
      });
      break;
    case 'roof':
      s.commit('Paint roof', (d) => {
        d.roof.color = color;
      });
      break;
    case 'object':
      s.commit('Paint item', (d) => {
        const o = inFloor(d, tag.floorId)?.objects.find((x) => x.id === tag.id);
        if (o) o.colors[tag.part] = color;
      });
      break;
    case 'plant':
      s.commit('Paint plant', (d) => {
        const o = inFloor(d, tag.floorId)?.plants.find((x) => x.id === tag.id);
        if (o) o.foliageColor = color;
      });
      break;
    case 'pillar':
      s.commit('Paint pillar', (d) => {
        const o = inFloor(d, tag.floorId)?.pillars.find((x) => x.id === tag.id);
        if (o) o.color = color;
      });
      break;
    case 'opening':
      s.commit('Paint door or window', (d) => {
        const o = inFloor(d, tag.floorId)?.openings.find((x) => x.id === tag.id);
        if (o) o.shutterColor = color;
      });
      break;
  }
}

/** How long the camera takes to come down behind the character when Explore opens. */
const INTRO_SECONDS = 2.2;

export function View3D({ explore = false }: { explore?: boolean }) {
  const t = useT();
  const project = useApp((s) => s.project);
  const go = useApp((s) => s.go);
  const showToast = useApp((s) => s.showToast);
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(explore ? 'walk' : 'orbit');
  const [topFloor, setTopFloor] = useState(99);
  const [allOpen, setAllOpen] = useState(false);
  const [night, setNight] = useState(false);
  const [showRoof, setShowRoof] = useState(true);
  const [firstPerson, setFirstPerson] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [tool3d, setTool3d] = useState<'none' | 'paint' | 'add'>('none');
  const [placing, setPlacing] = useState<Placing>(null);
  const [addTab, setAddTab] = useState<'plants' | 'furniture'>('plants');
  const [stats, setStats] = useState({ fps: 0, triangles: 0, calls: 0, scale: 1 });
  const [webglError, setWebglError] = useState('');
  const [sensorMissing, setSensorMissing] = useState(false);
  const [nearby, setNearby] = useState<{ id: string; kind: 'door' | 'window'; open: boolean } | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [stickPos, setStickPos] = useState<{ x: number; y: number } | null>(null);

  const engine = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    left: THREE.PerspectiveCamera;
    right: THREE.PerspectiveCamera;
    house: BuiltHouse | null;
    built: Built | null;
    world: World | null;
    character: Character;
    blob: THREE.Mesh;
    materials: ReturnType<typeof createMaterials>;
    sun: THREE.DirectionalLight;
    hemi: THREE.HemisphereLight;
    needsRender: boolean;
    shadows: boolean;
  } | null>(null);

  const orbit = useRef<Orbit>({ theta: Math.PI * 0.75, phi: 1.1, radius: 26, target: new THREE.Vector3() });
  // yaw and pitch belong to the camera; bodyYaw is where the character faces. They are separate on purpose.
  const intro = useRef(0);
  const player = useRef({
    x: 0,
    z: 0,
    feet: 0,
    vy: 0,
    yaw: 0,
    pitch: -0.12,
    bodyYaw: 0,
    eye: EYE_HEIGHT_M,
    speed: 0,
    airborne: false,
    camDist: 4,
  });
  const moveInput = useRef({ x: 0, y: 0 });
  const keys = useRef(new Set<string>());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef({ dist: 0, mid: { x: 0, y: 0 } });
  const stick = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const device = useRef<{
    alpha: number;
    beta: number;
    gamma: number;
    seen: boolean;
    baseYaw: number | null;
  }>({ alpha: 0, beta: 90, gamma: 0, seen: false, baseYaw: null });
  const gazeWalk = useRef(false);
  const tap = useRef<{ x: number; y: number; at: number } | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const firstPersonRef = useRef(firstPerson);
  firstPersonRef.current = firstPerson;
  const openState = useRef(new Set<string>());
  const toolRef = useRef(tool3d);
  toolRef.current = tool3d;
  const placingRef = useRef(placing);
  placingRef.current = placing;

  const requestRender = useCallback(() => {
    if (engine.current) engine.current.needsRender = true;
  }, []);

  const placeOrbit = useCallback(() => {
    const e = engine.current;
    if (!e) return;
    const o = orbit.current;
    const sinP = Math.sin(o.phi);
    e.camera.position.set(
      o.target.x + o.radius * sinP * Math.sin(o.theta),
      o.target.y + o.radius * Math.cos(o.phi),
      o.target.z + o.radius * sinP * Math.cos(o.theta),
    );
    e.camera.lookAt(o.target);
    e.needsRender = true;
  }, []);

  /** far: the Explore start, in front of the house. door: just outside the front door, facing it. inside: standing in the house. */
  const placePlayer = useCallback((where: 'far' | 'door' | 'inside') => {
    const e = engine.current;
    if (!e?.house) return;
    const house = e.house;
    const ground = -(useApp.getState().project?.site.groundLevelOffset ?? 0) / 1000;
    const atDoor = where === 'door' && house.explore.fromDoor;
    const spot =
      where === 'far' || atDoor
        ? {
            x: atDoor ? house.explore.door.x : house.explore.x,
            z: atDoor ? house.explore.door.z : house.explore.z,
            yaw: house.explore.yaw,
            feet: ground,
          }
        : {
            x: house.start.x,
            z: house.start.z,
            yaw: house.start.yaw,
            feet: house.walk[house.start.floorIndex]?.level ?? 0,
          };
    // Arriving at the house: the camera starts high and wide, then settles behind the character.
    intro.current = where === 'far' ? INTRO_SECONDS : 0;
    player.current = {
      ...player.current,
      x: spot.x,
      z: spot.z,
      feet: spot.feet,
      vy: 0,
      yaw: spot.yaw,
      bodyYaw: spot.yaw,
      pitch: -0.1,
      eye: spot.feet + EYE_HEIGHT_M,
      speed: 0,
      airborne: false,
    };
  }, []);

  const toggleOpening = useCallback(
    (id: string) => {
      if (openState.current.has(id)) openState.current.delete(id);
      else openState.current.add(id);
      requestRender();
    },
    [requestRender],
  );

  // One renderer for the life of the screen.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : String(err));
      return;
    }
    const touchDevice = navigator.maxTouchPoints > 0;
    const ratio = Math.min(window.devicePixelRatio || 1, touchDevice ? 1.5 : 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // Sun shadows always; on phones they are computed once per change rather than every frame.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = !touchDevice;
    host.appendChild(renderer.domElement);
    renderer.domElement.dataset.testid = 'view3d-canvas';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#cfe6f3', 180, 800);
    const hemi = new THREE.HemisphereLight('#e8f2ff', '#8f8a70', 1.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff0d8', 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(touchDevice ? 1024 : 2048, touchDevice ? 1024 : 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    const camera = new THREE.PerspectiveCamera(
      58,
      host.clientWidth / Math.max(1, host.clientHeight),
      0.06,
      1800,
    );
    const left = new THREE.PerspectiveCamera(80, 1, 0.06, 1800);
    const right = new THREE.PerspectiveCamera(80, 1, 0.06, 1800);
    const character = createCharacter(!touchDevice);
    scene.add(character.group);
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 20),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.renderOrder = 1;
    scene.add(blob);
    engine.current = {
      renderer,
      scene,
      camera,
      left,
      right,
      house: null,
      built: null,
      world: null,
      character,
      blob,
      materials: createMaterials(),
      sun,
      hemi,
      needsRender: true,
      shadows: true,
    };

    const resize = () => {
      const e = engine.current;
      if (!e || !host.clientWidth) return;
      e.renderer.setSize(host.clientWidth, host.clientHeight);
      e.camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      e.camera.updateProjectionMatrix();
      e.needsRender = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsAt = last;
    let scale = 1;
    let rescale = false;
    let lowStreak = 0;
    let hudAt = 0;

    const stepPlayer = (dt: number) => {
      const e = engine.current;
      if (!e?.house) return;
      const w = player.current;
      const input = { ...moveInput.current };
      const k = keys.current;
      // By physical key, so they work with any keyboard layout and with Caps Lock on.
      const stickFull = Math.hypot(input.x, input.y) > 0.92;
      if (k.has('KeyW') || k.has('ArrowUp')) input.y += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) input.y -= 1;
      if (k.has('KeyA')) input.x -= 1;
      if (k.has('KeyD')) input.x += 1;
      if (k.has('ArrowLeft')) w.yaw += TURN_SPEED * dt;
      if (k.has('ArrowRight')) w.yaw -= TURN_SPEED * dt;
      if (modeRef.current === 'vr' && gazeWalk.current) input.y = 1;
      const len = Math.hypot(input.x, input.y);
      const running = k.has('ShiftLeft') || k.has('ShiftRight') || stickFull;
      const floors = useApp.getState().project?.floors.filter((f) => f.visible) ?? [];
      const here = floorAtHeight(w.feet, e.house.walk);
      let speed = 0;
      if (len > 0.04) {
        const clamp = len > 1 ? 1 / len : 1;
        // The stick moves the body relative to where the camera looks.
        const fx = -Math.sin(w.yaw);
        const fz = -Math.cos(w.yaw);
        const rx = Math.cos(w.yaw);
        const rz = -Math.sin(w.yaw);
        const dirX = (fx * input.y + rx * input.x) * clamp;
        const dirZ = (fz * input.y + rz * input.x) * clamp;
        speed = (running ? RUN_SPEED : WALK_SPEED) * Math.min(1, len * 1.15);
        const moved = moveWithCollisions(
          { x: w.x * 1000, y: w.z * 1000 },
          { x: dirX * speed * dt * 1000, y: dirZ * speed * dt * 1000 },
          here,
          openState.current,
        );
        const actualX = moved.x / 1000 - w.x;
        const actualZ = moved.y / 1000 - w.z;
        w.x += actualX;
        w.z += actualZ;
        // The body turns smoothly to face the way it is walking.
        const target = Math.atan2(-dirX, -dirZ);
        let delta = target - w.bodyYaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        w.bodyYaw += delta * Math.min(1, dt * 11);
        // Pushing against a wall or a shut door: no running on the spot.
        speed = Math.min(speed, Math.hypot(actualX, actualZ) / Math.max(dt, 0.001));
        if (speed < 0.3) speed = 0;
      }
      w.speed += (speed - w.speed) * Math.min(1, dt * 12);

      const ground = -(useApp.getState().project?.site.groundLevelOffset ?? 0) / 1000;
      const heights = standHeights({ x: w.x * 1000, y: w.z * 1000 }, e.house.walk, floors);
      const stand = nextFeetHeight(w.airborne ? w.feet + 0.05 : w.feet, heights, ground);
      if (w.airborne || w.vy > 0) {
        w.vy -= GRAVITY * dt;
        w.feet += w.vy * dt;
        if (w.feet <= stand && w.vy <= 0) {
          w.feet = stand;
          w.vy = 0;
          w.airborne = false;
        }
      } else if (stand < w.feet - 0.55) {
        w.airborne = true;
        w.vy = 0;
      } else {
        // Steps are walked smoothly rather than popped.
        w.feet += (stand - w.feet) * Math.min(1, dt * 14);
      }
      w.eye += (w.feet + EYE_HEIGHT_M - w.eye) * Math.min(1, dt * 12);

      // What can be opened from here?
      if (performance.now() - hudAt > 160) {
        hudAt = performance.now();
        const built = e.built;
        let best: { id: string; kind: 'door' | 'window'; d: number } | null = null;
        for (const m of built?.movables ?? []) {
          if (Math.abs(m.part.pivot[1] - w.feet) > 1.9) continue;
          const d = Math.hypot(m.part.pivot[0] - w.x, m.part.pivot[2] - w.z);
          if (d < 2.5 && (!best || d < best.d)) best = { id: m.part.openingId, kind: m.part.kind, d };
        }
        setNearby((prev) => {
          const open = best ? openState.current.has(best.id) : false;
          if (!best) return prev ? null : prev;
          if (prev && prev.id === best.id && prev.open === open) return prev;
          return { id: best.id, kind: best.kind, open };
        });
        const box = e.house.bounds;
        const cx = Math.max(box.minX, Math.min(box.maxX, w.x));
        const cz = Math.max(box.minZ, Math.min(box.maxZ, w.z));
        setDistance(Math.round(Math.hypot(w.x - cx, w.z - cz)));
      }
    };

    /** Places the third-person camera, pulling it in front of any wall between it and the character. */
    const placeFollowCamera = (dt: number) => {
      const e = engine.current;
      if (!e?.house) return;
      const w = player.current;
      const cosP = Math.cos(w.pitch);
      const dirX = -Math.sin(w.yaw) * cosP;
      const dirY = Math.sin(w.pitch);
      const dirZ = -Math.cos(w.yaw) * cosP;
      const tx = w.x;
      const ty = w.feet + 1.3;
      const tz = w.z;
      let want = firstPersonRef.current ? 0 : followDistance(e.camera.aspect);
      if (want > 0) {
        const floor = floorAtHeight(w.feet, e.house.walk);
        const a = { x: tx * 1000, y: tz * 1000 };
        const b = { x: (tx - dirX * want) * 1000, y: (tz - dirZ * want) * 1000 };
        const span = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const shutDoors = floor?.doors.filter((x) => !openState.current.has(x.id)) ?? [];
        for (const s of [...(floor?.segments ?? []), ...shutDoors]) {
          const hit = segmentIntersection(a, b, s.a, s.b);
          if (hit)
            want = Math.min(
              want,
              Math.max(0.35, (Math.hypot(hit.x - a.x, hit.y - a.y) / span) * want - 0.28),
            );
        }
      }
      // Pull in at once, ease back out, so a wall never pops through the view.
      w.camDist = want < w.camDist ? want : w.camDist + (want - w.camDist) * Math.min(1, dt * 3);
      let d = w.camDist;
      let lift = 0;
      if (intro.current > 0 && !firstPersonRef.current) {
        intro.current = Math.max(0, intro.current - dt);
        const k = intro.current / INTRO_SECONDS;
        const ease = k * k * (3 - 2 * k);
        d += ease * 13;
        lift = ease * 9;
      }
      let cy = ty - dirY * d + lift;
      const inside =
        (e.house.walk[0]?.shape ?? []).length > 0 &&
        standHeights(
          { x: w.x * 1000, y: w.z * 1000 },
          e.house.walk,
          useApp.getState().project?.floors.filter((f) => f.visible) ?? [],
        ).length > 0;
      const floor = floorAtHeight(w.feet, e.house.walk);
      if (inside && floor) cy = Math.min(cy, floor.top - 0.4);
      cy = Math.max(cy, w.feet + 0.25);
      if (firstPersonRef.current) {
        e.camera.position.set(w.x, w.eye, w.z);
      } else {
        // Off to one side, so the character is not standing in the middle of the view.
        const shoulder = Math.min(0.42, d * 0.11);
        e.camera.position.set(
          tx - dirX * d + Math.cos(w.yaw) * shoulder,
          cy,
          tz - dirZ * d - Math.sin(w.yaw) * shoulder,
        );
      }
      e.camera.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
      e.camera.updateMatrixWorld();
      e.character.group.visible = !firstPersonRef.current && d > 0.7;
      e.blob.visible = e.character.group.visible;
    };

    const applyDevice = () => {
      const d = device.current;
      const w = player.current;
      if (!d.seen) return;
      const landscape = window.innerWidth > window.innerHeight;
      const heading = (d.alpha * Math.PI) / 180;
      if (d.baseYaw === null) d.baseYaw = w.yaw - heading;
      w.yaw = heading + d.baseYaw;
      const tilt = landscape ? -(d.gamma > 0 ? d.gamma - 90 : d.gamma + 90) : d.beta - 90;
      w.pitch = Math.max(-1.3, Math.min(1.3, (tilt * Math.PI) / 180));
    };

    const stepOpenings = (dt: number) => {
      const e = engine.current;
      let moving = false;
      for (const m of e?.built?.movables ?? []) {
        const goal = openState.current.has(m.part.openingId) ? 1 : 0;
        if (m.amount === goal) continue;
        moving = true;
        const step = dt * 1.9;
        m.amount = goal > m.amount ? Math.min(goal, m.amount + step) : Math.max(goal, m.amount - step);
        const eased = m.amount * m.amount * (3 - 2 * m.amount);
        m.mesh.rotation.y = m.part.turn * eased;
        m.mesh.position.set(
          m.part.pivot[0] + m.part.move[0] * eased,
          m.part.pivot[1] + m.part.move[1] * eased,
          m.part.pivot[2] + m.part.move[2] * eased,
        );
      }
      if (moving && e) {
        e.needsRender = true;
        e.renderer.shadowMap.needsUpdate = true;
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const e = engine.current;
      if (!e) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const m = modeRef.current;
      const active = m !== 'orbit';
      stepOpenings(dt);
      if (!active && !e.needsRender) return;

      if (active) {
        stepPlayer(dt);
        if (m === 'vr' || m === 'look360') applyDevice();
        const w = player.current;
        if (m === 'walk') {
          placeFollowCamera(dt);
          e.character.group.position.set(w.x, w.feet, w.z);
          e.character.group.rotation.y = w.bodyYaw + Math.PI;
          e.character.animate(dt, w.speed, w.airborne);
          e.blob.position.set(w.x, w.feet + 0.012, w.z);
        } else {
          e.camera.position.set(w.x, w.eye, w.z);
          e.camera.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
          e.camera.updateMatrixWorld();
          e.character.group.visible = false;
          e.blob.visible = false;
        }
      } else {
        e.character.group.visible = false;
        e.blob.visible = false;
      }

      const { renderer: r } = e;
      // Resizing wipes the canvas, so it happens just before a draw. Done after one, a slow
      // device would show a black screen until its next frame.
      if (rescale) {
        rescale = false;
        r.setPixelRatio(ratio * scale);
        r.setSize(host.clientWidth, host.clientHeight);
      }
      const size = r.getSize(new THREE.Vector2());
      if (m === 'vr') {
        const halfW = size.x / 2;
        r.setScissorTest(true);
        for (const [cam, x, shift] of [
          [e.left, 0, -IPD / 2],
          [e.right, halfW, IPD / 2],
        ] as [THREE.PerspectiveCamera, number, number][]) {
          cam.aspect = halfW / Math.max(1, size.y);
          cam.updateProjectionMatrix();
          cam.position.copy(e.camera.position);
          cam.quaternion.copy(e.camera.quaternion);
          cam.translateX(shift);
          cam.updateMatrixWorld();
          r.setViewport(x, 0, halfW, size.y);
          r.setScissor(x, 0, halfW, size.y);
          r.render(e.scene, cam);
        }
        r.setScissorTest(false);
      } else {
        r.setViewport(0, 0, size.x, size.y);
        r.render(e.scene, e.camera);
      }
      e.needsRender = false;

      frames += 1;
      if (now - fpsAt >= 1000) {
        const fps = Math.round((frames * 1000) / (now - fpsAt));
        frames = 0;
        fpsAt = now;
        // Trades sharpness for smoothness on slower phones.
        if (active) {
          lowStreak = fps < 28 ? lowStreak + 1 : 0;
          if (lowStreak >= 2 && scale > 0.55) {
            scale = Math.max(0.55, scale - 0.15);
            rescale = true;
            lowStreak = 0;
          }
        }
        setStats({
          fps: active ? fps : 0,
          triangles: r.info.render.triangles,
          calls: r.info.render.calls,
          scale,
        });
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      const e = engine.current;
      if (e) {
        if (e.built) disposeGroup(e.built.group);
        e.world?.dispose();
        e.character.dispose();
        e.materials.dispose();
        e.renderer.dispose();
        e.renderer.forceContextLoss();
        e.renderer.domElement.remove();
      }
      engine.current = null;
    };
  }, []);

  // Geometry is rebuilt only when the design or view options change.
  useEffect(() => {
    const e = engine.current;
    if (!e || !project) return;
    const house = buildHouse(project, { topFloor, hideRoof: !showRoof, movable: true, noLand: true });
    const built = buildGroup(house, e.materials, e.shadows);
    if (e.built) {
      // Doors keep their position across a rebuild.
      for (const m of built.movables) {
        const before = e.built.movables.find((x) => x.part.openingId === m.part.openingId);
        if (before) {
          m.amount = before.amount;
          const eased = m.amount * m.amount * (3 - 2 * m.amount);
          m.mesh.rotation.y = m.part.turn * eased;
          m.mesh.position.set(
            m.part.pivot[0] + m.part.move[0] * eased,
            m.part.pivot[1] + m.part.move[1] * eased,
            m.part.pivot[2] + m.part.move[2] * eased,
          );
        }
      }
      e.scene.remove(e.built.group);
      disposeGroup(e.built.group);
    }
    e.scene.add(built.group);
    const firstBuild = !e.house;
    e.built = built;
    e.house = house;
    const b = house.bounds;
    const center = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    const span = Math.max(8, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ));
    if (firstBuild) {
      const groundY = -(project.site.groundLevelOffset ?? 0) / 1000;
      const world = createWorld(
        center,
        span / 2 + 6,
        project.site.roadSide,
        project.settings.northAngleDeg,
        groundY,
        true,
        house.explore,
      );
      e.scene.add(world.group);
      e.world = world;
      // Sun over the visitor's shoulder, so the front of the house is lit as they walk up to it.
      const outX = house.explore.x - center.x;
      const outZ = house.explore.z - center.z;
      const outLen = Math.hypot(outX, outZ) || 1;
      e.sun.position.set(
        center.x + ((outX - outZ * 0.7) / outLen) * (span * 0.8 + 14),
        42 + span,
        center.z + ((outZ + outX * 0.7) / outLen) * (span * 0.8 + 14),
      );
      e.sun.target.position.copy(center);
      const shadowRange = span * 0.85 + 14;
      Object.assign(e.sun.shadow.camera, {
        left: -shadowRange,
        right: shadowRange,
        top: shadowRange,
        bottom: -shadowRange,
        near: 1,
        far: 260,
      });
      e.sun.shadow.camera.updateProjectionMatrix();
      orbit.current.target.set(center.x, (b.minY + b.maxY) / 2 - 0.5, center.z);
      const portrait = e.camera.aspect < 1 ? 0.85 / e.camera.aspect : 1;
      orbit.current.radius = Math.max(
        9,
        Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * 1.25 * portrait,
      );
      placePlayer(explore ? 'far' : 'inside');
    }
    e.renderer.shadowMap.needsUpdate = true;
    if (modeRef.current === 'orbit') placeOrbit();
    e.needsRender = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, topFloor, showRoof]);

  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.hemi.intensity = night ? 0.5 : 1.55;
    e.hemi.color.set(night ? '#7f94c8' : '#e8f2ff');
    e.sun.intensity = night ? 0.3 : 2.5;
    e.sun.color.set(night ? '#a6bbff' : '#fff0d8');
    (e.scene.fog as THREE.Fog).color.set(night ? '#101a30' : '#cfe6f3');
    e.world?.setNight(night);
    e.needsRender = true;
  }, [night]);

  useEffect(() => {
    if (mode === 'orbit') {
      placeOrbit();
      return;
    }
    device.current.baseYaw = null;
    if (mode !== 'vr' && mode !== 'look360') return;
    const sensor = device.current;
    let handle: PluginListenerHandle | undefined;
    const read = (ev: { alpha: number | null; beta: number | null; gamma: number | null }) => {
      if (ev.alpha === null) return;
      sensor.alpha = ev.alpha;
      sensor.beta = ev.beta ?? 90;
      sensor.gamma = ev.gamma ?? 0;
      sensor.seen = true;
      setSensorMissing(false);
    };
    const onWindow = (ev: DeviceOrientationEvent) => read(ev);
    const timer = setTimeout(() => {
      if (!sensor.seen) setSensorMissing(true);
    }, 1800);
    (async () => {
      const prompt = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
        .requestPermission;
      if (prompt) await prompt().catch(() => undefined);
      if (Capacitor.isNativePlatform()) handle = await Motion.addListener('orientation', read);
      else window.addEventListener('deviceorientation', onWindow);
    })().catch(() => setSensorMissing(true));
    return () => {
      clearTimeout(timer);
      void handle?.remove();
      window.removeEventListener('deviceorientation', onWindow);
      sensor.seen = false;
    };
  }, [mode, placeOrbit]);

  const jump = useCallback(() => {
    const w = player.current;
    if (!w.airborne) {
      w.vy = JUMP_SPEED;
      w.airborne = true;
    }
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      const c = e.code;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (c === 'Space' || c.startsWith('Arrow')) e.preventDefault();
      if (c === 'Escape') {
        go('editor');
        return;
      }
      keys.current.add(c);
      // In Orbit there is nobody to walk yet, so a walking key starts Walk.
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown'].includes(c) &&
        modeRef.current === 'orbit'
      ) {
        enterRef.current('walk');
      }
      if (e.repeat) return;
      if (c === 'Space') jump();
      if (c === 'KeyE') {
        const near = nearbyRef.current;
        if (near) toggleOpening(near.id);
      }
      if (c === 'KeyF') setFirstPerson((on) => !on);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    // A key let go in another window would otherwise stay held down.
    const clear = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, [go, jump, toggleOpening]);
  const enterRef = useRef<(m: Mode) => void>(() => undefined);
  const nearbyRef = useRef(nearby);
  nearbyRef.current = nearby;

  /** A short tap: paint, place, or open what was tapped. */
  const onTap = (clientX: number, clientY: number) => {
    const e = engine.current;
    const host = hostRef.current;
    if (!e?.built || !host) return;
    const rect = host.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      e.camera,
    );
    const targets: THREE.Object3D[] = [...e.built.meshes];
    if (e.world) targets.push(e.world.ground);
    const hits = ray.intersectObjects(targets, false);
    const hit = hits[0];
    if (!hit) return;
    const tags = hit.object.userData.tags as (SurfaceTag | null)[] | undefined;
    const tag = tags && hit.faceIndex != null ? (tags[Math.floor(hit.faceIndex)] ?? null) : null;

    if (toolRef.current === 'paint') {
      if (tag) applyPaint(tag, useApp.getState().paint.color);
      else showToast(t('paint.tapSurface'));
      return;
    }
    const place = placingRef.current;
    if (toolRef.current === 'add' && place) {
      const s = useApp.getState();
      const p = s.project;
      if (!p) return;
      const at = { x: Math.round(hit.point.x * 1000), y: Math.round(hit.point.z * 1000) };
      const floors = p.floors.filter((f) => f.visible);
      let target = floors.find((f) => f.levelIndex === 0) ?? floors[0];
      for (const f of floors) if (f.elevation / 1000 <= hit.point.y + 0.15) target = f;
      if (hit.point.y < -0.05) target = floors.find((f) => f.levelIndex === 0) ?? target;
      if (place.kind === 'plant') {
        const c = plantById.get(place.id);
        if (c) {
          s.commit(`Add ${c.name}`, (d) => {
            d.floors
              .find((f) => f.id === target.id)
              ?.plants.push(createPlant(c.id, at, c.spread, c.height, c.name, c.foliage, c.trunk));
          });
        }
      } else {
        const c = objectById.get(place.id);
        if (c) {
          s.commit(`Add ${c.name}`, (d) => {
            d.floors
              .find((f) => f.id === target.id)
              ?.objects.push(
                createObject(
                  c.id,
                  at,
                  { width: c.width, depth: c.depth, height: c.height },
                  c.name,
                  { ...c.colors },
                  c.mount ?? 0,
                ),
              );
          });
        }
      }
      return;
    }
    if (tag?.kind === 'opening') toggleOpening(tag.id);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (mode !== 'orbit') return;
    orbit.current.radius = Math.max(2, Math.min(220, orbit.current.radius * (e.deltaY > 0 ? 1.1 : 0.9)));
    placeOrbit();
  };

  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap.current = pointers.current.size === 1 ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
    if (mode === 'vr') gazeWalk.current = !gazeWalk.current;
  };

  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 8)
      tap.current = null;
    if (mode === 'orbit') {
      const o = orbit.current;
      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        o.radius = Math.max(2, Math.min(220, o.radius * (pinch.current.dist / Math.max(1, d))));
        panOrbit(mid.x - pinch.current.mid.x, mid.y - pinch.current.mid.y);
        pinch.current = { dist: d, mid };
      } else if (e.buttons === 2 || e.shiftKey) {
        panOrbit(dx, dy);
      } else {
        o.theta -= dx * 0.006;
        o.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.01, o.phi - dy * 0.005));
      }
      placeOrbit();
    } else if (mode === 'walk' || mode === 'look360') {
      // Swiping anywhere turns only the view; the stick moves the body.
      const w = player.current;
      w.yaw -= dx * 0.0052;
      w.pitch = Math.max(-1.15, Math.min(1.1, w.pitch - dy * 0.0042));
    }
  };

  const panOrbit = (dx: number, dy: number) => {
    const e = engine.current;
    if (!e) return;
    const o = orbit.current;
    const k = o.radius * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(e.camera.matrixWorld, 0);
    o.target.addScaledVector(right, -dx * k).addScaledVector(new THREE.Vector3(0, 1, 0), dy * k);
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (tap.current && performance.now() - tap.current.at < 420) onTap(e.clientX, e.clientY);
    tap.current = null;
  };

  const stickDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    stick.current = { id: e.pointerId, ox: box.left + box.width / 2, oy: box.top + box.height / 2 };
    stickMove(e);
  };
  const stickMove = (e: React.PointerEvent) => {
    const s = stick.current;
    if (!s || s.id !== e.pointerId) return;
    e.stopPropagation();
    const R = 48;
    const dx = e.clientX - s.ox;
    const dy = e.clientY - s.oy;
    const l = Math.hypot(dx, dy);
    const k = l > R ? R / l : 1;
    setStickPos({ x: dx * k, y: dy * k });
    moveInput.current = { x: (dx * k) / R, y: -(dy * k) / R };
  };
  const stickUp = () => {
    stick.current = null;
    setStickPos(null);
    moveInput.current = { x: 0, y: 0 };
  };

  const enter = (m: Mode) => {
    if (m !== 'orbit' && modeRef.current === 'orbit' && engine.current?.house)
      placePlayer(m === 'walk' ? 'door' : 'inside');
    gazeWalk.current = false;
    setMode(m);
    requestRender();
  };

  enterRef.current = enter;

  const openAll = (open: boolean) => {
    const e = engine.current;
    setAllOpen(open);
    for (const m of e?.built?.movables ?? []) {
      if (open) openState.current.add(m.part.openingId);
      else openState.current.delete(m.part.openingId);
    }
    requestRender();
  };

  const floors = project?.floors.filter((f) => f.visible) ?? [];
  const inGame = mode === 'walk';
  const [hintVisible, setHintVisible] = useState(true);
  useEffect(() => {
    if (!inGame) return;
    setHintVisible(true);
    const id = setTimeout(() => setHintVisible(false), 6000);
    return () => clearTimeout(id);
  }, [inGame]);

  return (
    <div className="view3d" data-testid="view3d">
      <div
        ref={hostRef}
        className="view3d-host"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {webglError ? (
        <div className="banner error" role="alert" data-testid="webgl-error">
          {t('view3d.noWebgl')}: {webglError}
        </div>
      ) : null}

      {mode !== 'vr' ? (
        <div className="view3d-top">
          <button
            className="btn glass-btn"
            data-testid="back-editor"
            onClick={() => go('editor')}
            aria-label={t('common.back')}
          >
            <ArrowLeft size={19} aria-hidden="true" />
          </button>
          {explore ? (
            <span className="view3d-title">{t('explore.title')}</span>
          ) : (
            <div className="segmented">
              {(['orbit', 'walk', 'look360', 'vr'] as Mode[]).map((m) => (
                <button
                  key={m}
                  className={mode === m ? 'btn glass-btn active' : 'btn glass-btn'}
                  data-testid={`mode-${m}`}
                  onClick={() => enter(m)}
                >
                  {t(`view3d.${m}`)}
                </button>
              ))}
            </div>
          )}
          <span className="topbar-spacer" />
          <button
            className={optionsOpen ? 'btn glass-btn active' : 'btn glass-btn'}
            data-testid="view-options"
            aria-label={t('view3d.options')}
            onClick={() => setOptionsOpen(!optionsOpen)}
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          className="btn vr-exit"
          data-testid="exit-vr"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => enter('walk')}
        >
          {t('view3d.exitVr')}
        </button>
      )}

      {optionsOpen && mode !== 'vr' ? (
        <div className="view3d-options" data-testid="options-panel">
          <label className="row-label" htmlFor="cutaway">
            {t('view3d.cutaway')}
          </label>
          <select
            id="cutaway"
            className="input"
            data-testid="cutaway"
            value={Math.min(topFloor, floors.length - 1)}
            onChange={(e) => {
              setTopFloor(Number(e.target.value));
              setShowRoof(Number(e.target.value) >= floors.length - 1);
            }}
          >
            {floors.map((f, i) => (
              <option key={f.id} value={i}>
                {t('view3d.upTo')} {f.name}
              </option>
            ))}
          </select>
          <ToggleField
            label={t('view3d.roof')}
            value={showRoof}
            onCommit={setShowRoof}
            testId="toggle-roof"
          />
          <ToggleField label={t('view3d.doors')} value={allOpen} onCommit={openAll} testId="toggle-doors" />
          <ToggleField label={t('view3d.night')} value={night} onCommit={setNight} testId="toggle-night" />
          {stats.fps ? (
            <p className="muted small" data-testid="stats">
              {stats.fps} fps{stats.scale < 1 ? ` · ${Math.round(stats.scale * 100)}%` : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {explore && distance !== null && distance > 1 ? (
        <div className="explore-distance" data-testid="distance">
          {t('explore.distance').replace('{n}', String(distance))}
        </div>
      ) : null}

      {/* Two controls, as in third-person mobile games: this stick moves the body, swiping anywhere else turns the view. */}
      {inGame || mode === 'look360' ? (
        <div
          className="joystick"
          data-testid="joystick"
          onPointerDown={stickDown}
          onPointerMove={stickMove}
          onPointerUp={stickUp}
          onPointerCancel={stickUp}
        >
          <div
            className="joystick-knob"
            style={stickPos ? { transform: `translate(${stickPos.x}px, ${stickPos.y}px)` } : undefined}
          />
        </div>
      ) : null}

      {inGame ? (
        <div className="game-buttons">
          {nearby ? (
            <button
              className="game-btn primary"
              data-testid="toggle-opening"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                toggleOpening(nearby.id);
                setNearby({ ...nearby, open: !nearby.open });
              }}
            >
              {t(`game.${nearby.open ? 'close' : 'open'}_${nearby.kind}`)}
              {navigator.maxTouchPoints > 0 ? null : <kbd>E</kbd>}
            </button>
          ) : null}
          <button
            className="game-btn"
            data-testid="jump"
            onPointerDown={(e) => {
              e.stopPropagation();
              jump();
            }}
            aria-label={t('game.jump')}
          >
            <ChevronsUp size={20} aria-hidden="true" />
            <span>{t('game.jump')}</span>
          </button>
          <button
            className={firstPerson ? 'game-btn active' : 'game-btn'}
            data-testid="toggle-eyes"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setFirstPerson(!firstPerson)}
          >
            <Eye size={20} aria-hidden="true" />
            <span>{t('game.eyes')}</span>
          </button>
        </div>
      ) : null}

      {mode === 'orbit' || inGame ? (
        <div className="tool3d-bar">
          <button
            className={tool3d === 'paint' ? 'btn glass-btn active' : 'btn glass-btn'}
            data-testid="tool3d-paint"
            onClick={() => {
              setPlacing(null);
              setTool3d(tool3d === 'paint' ? 'none' : 'paint');
            }}
          >
            <PaintBucket size={16} aria-hidden="true" /> {t('tool.paint')}
          </button>
          <button
            className={tool3d === 'add' ? 'btn glass-btn active' : 'btn glass-btn'}
            data-testid="tool3d-add"
            onClick={() => setTool3d(tool3d === 'add' ? 'none' : 'add')}
          >
            <Plus size={16} aria-hidden="true" /> {t('common.add')}
          </button>
        </div>
      ) : null}

      {tool3d === 'paint' ? (
        <div className="view3d-sheet" data-testid="paint-sheet">
          <PaintBar compact />
          <p className="small muted">{t('paint.help3d')}</p>
          <button
            className="btn primary sheet-done"
            data-testid="paint3d-done"
            onClick={() => setTool3d('none')}
          >
            {t('common.done')}
          </button>
        </div>
      ) : null}

      {tool3d === 'add' ? (
        <div className="view3d-sheet" data-testid="add-sheet">
          <div className="tabs">
            <button
              className={addTab === 'plants' ? 'tab active' : 'tab'}
              data-testid="add-plants"
              onClick={() => setAddTab('plants')}
            >
              {t('library.plants')}
            </button>
            <button
              className={addTab === 'furniture' ? 'tab active' : 'tab'}
              data-testid="add-furniture"
              onClick={() => setAddTab('furniture')}
            >
              {t('library.furniture')}
            </button>
          </div>
          <div className="thumb-strip">
            {(addTab === 'plants'
              ? PLANTS.map((p) => ({ id: p.id, kind: 'plant' as const, name: p.name }))
              : OBJECTS.filter((o) => !o.mount).map((o) => ({
                  id: o.id,
                  kind: 'object' as const,
                  name: o.name,
                }))
            ).map((item) => (
              <button
                key={item.id}
                className={placing?.id === item.id ? 'thumb-btn active' : 'thumb-btn'}
                data-testid={`add3d-${item.id}`}
                onClick={() => setPlacing({ kind: item.kind, id: item.id })}
              >
                <ItemThumb kind={item.kind} id={item.id} />
                <span>{t(`obj.${item.id}`, item.name)}</span>
              </button>
            ))}
          </div>
          <p className="small muted">{placing ? t('add3d.tapToPlace') : t('add3d.pick')}</p>
          <button
            className="btn primary sheet-done"
            data-testid="add3d-done"
            onClick={() => {
              setPlacing(null);
              setTool3d('none');
            }}
          >
            {t('common.done')}
          </button>
        </div>
      ) : null}

      {mode === 'vr' ? <p className="view3d-hint">{t('view3d.vrHint')}</p> : null}
      {mode === 'orbit' && tool3d === 'none' && navigator.maxTouchPoints === 0 ? (
        <p className="view3d-hint" data-testid="orbit-keys">
          {t('view3d.orbitKeys')}
        </p>
      ) : null}
      {inGame && tool3d === 'none' && hintVisible ? (
        <p className="view3d-hint">{t('view3d.walkHint')}</p>
      ) : null}
      {(mode === 'vr' || mode === 'look360') && sensorMissing ? (
        <p className="banner" role="status" data-testid="sensor-missing">
          {t('view3d.noSensor')}
        </p>
      ) : null}
    </div>
  );
}
