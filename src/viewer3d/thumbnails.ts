import * as THREE from 'three';
import { objectById, openingTypeById, plantById, STAIR_FINISHES, STAIR_TYPES } from '../catalog/catalog';
import {
  createObject,
  createOpening,
  createPillar,
  createPlant,
  createProject,
  createStair,
  createWall,
} from '../core/model/defaults';
import type { WallType } from '../core/model/types';
import { buildHouse } from './builder';
import { createMaterials } from './textures';

export type ThumbKind = 'object' | 'opening' | 'stair' | 'plant' | 'wall' | 'pillar';

const cache = new Map<string, string>();
const WIDTH = 240;
const HEIGHT = 180;

let renderer: THREE.WebGLRenderer | null = null;
let materials: ReturnType<typeof createMaterials> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function sampleProject(kind: ThumbKind, id: string) {
  const p = createProject('thumb');
  const f = p.floors[0];
  p.site.groundLevelOffset = 0;
  switch (kind) {
    case 'object': {
      const c = objectById.get(id);
      if (c)
        f.objects.push(
          createObject(
            c.id,
            { x: 0, y: 0 },
            { width: c.width, depth: c.depth, height: c.height },
            c.name,
            { ...c.colors },
            0,
          ),
        );
      break;
    }
    case 'plant': {
      const c = plantById.get(id);
      if (c) f.plants.push(createPlant(c.id, { x: 0, y: 0 }, c.spread, c.height, c.name, c.foliage, c.trunk));
      break;
    }
    case 'stair': {
      const c = STAIR_TYPES.find((x) => x.id === id);
      if (c) {
        const finish = STAIR_FINISHES[id];
        f.stairs.push(
          createStair(
            { x: 0, y: 0 },
            {
              shape: c.shape,
              catalogId: c.id,
              totalRise: 2800,
              ...(finish ? { treadColor: finish.tread, railColor: finish.rail } : {}),
            },
          ),
        );
      }
      break;
    }
    case 'opening': {
      const t = openingTypeById.get(id);
      if (t) {
        const half = t.width / 2 + 260;
        const wall = createWall(
          { x: -half, y: 0 },
          { x: half, y: 0 },
          {
            thickness: 150,
            height: Math.max(2600, t.sill + t.height + 350),
            leftColor: '#efe9dc',
            rightColor: '#efe9dc',
            skirtingHeight: 0,
          },
        );
        f.walls.push(wall);
        f.openings.push(
          createOpening(wall.id, half, t.kind, {
            catalogId: t.id,
            width: t.width,
            height: t.height,
            sillHeight: t.sill,
            lintelHeight: t.sill + t.height,
            panels: t.panels,
            shutterMaterial: t.shutterMaterial,
            shutterColor: t.shutterColor,
            frameColor: t.frameColor,
          }),
        );
      }
      break;
    }
    case 'pillar':
      f.pillars.push(
        createPillar({ x: 0, y: 0 }, { shape: id === 'round' ? 'round' : 'rect', height: 2700 }),
      );
      break;
    case 'wall': {
      const type = id as WallType;
      const height = type === 'half' || type === 'parapet' ? 1000 : type === 'compound' ? 1500 : 2700;
      const color =
        type === 'glass'
          ? '#bcd9e6'
          : type === 'compound'
            ? '#b5b1a7'
            : type === 'retaining'
              ? '#8d8a80'
              : '#efe9dc';
      f.walls.push(
        createWall(
          { x: -1500, y: 0 },
          { x: 1500, y: 0 },
          {
            type,
            height,
            thickness: type === 'inner' ? 115 : type === 'glass' ? 40 : 230,
            leftColor: color,
            rightColor: color,
            skirtingHeight: 0,
            material: type === 'glass' ? 'glass' : 'red_brick',
          },
        ),
      );
      break;
    }
  }
  return p;
}

function paint(kind: ThumbKind, id: string): string {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(WIDTH, HEIGHT);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    materials = createMaterials();
  }
  const house = buildHouse(sampleProject(kind, id), { hideRoof: true, bare: true, doorsOpen: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b4ad9b', 2.1));
  const sun = new THREE.DirectionalLight('#fff6e4', 2.1);
  sun.position.set(2, 4, 5);
  scene.add(sun);
  const made: THREE.BufferGeometry[] = [];
  for (const [key, bucket] of house.buckets) {
    if (!bucket.positions.length) continue;
    const geometry = bucket.toGeometry();
    made.push(geometry);
    scene.add(new THREE.Mesh(geometry, materials!.get(key)));
  }
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(28, WIDTH / HEIGHT, 0.01, 500);
  const reach = Math.max(size.x, size.y * 1.2, size.z, 0.2) / Math.tan((14 * Math.PI) / 180) / 1.75;
  camera.position.copy(center).add(new THREE.Vector3(0.55, 0.5, 1).normalize().multiplyScalar(reach));
  camera.lookAt(center);
  renderer.clear();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  made.forEach((g) => g.dispose());
  return url;
}

/** A picture of a catalogue item, drawn by the same code as the real 3D model. */
export function itemThumbnail(kind: ThumbKind, id: string): Promise<string> {
  const key = `${kind}:${id}`;
  const known = cache.get(key);
  if (known !== undefined) return Promise.resolve(known);
  // One at a time, yielding between pictures, so opening the catalogue never freezes the screen.
  const job = queue.then(
    () =>
      new Promise<string>((resolve) => {
        setTimeout(() => {
          let url = '';
          try {
            url = paint(kind, id);
          } catch (err) {
            console.warn('thumb failed', kind, id, err);
            url = '';
          }
          cache.set(key, url);
          resolve(url);
        }, 0);
      }),
  );
  queue = job;
  return job;
}
