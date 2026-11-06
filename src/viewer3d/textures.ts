import * as THREE from 'three';
import type { BucketKey } from './builder';

const SIZE = 128;

/** Paints a repeating pattern in light greys. It multiplies with vertex colours, so any colour can be chosen. */
function paint(draw: (ctx: CanvasRenderingContext2D) => void, repeatPerMetre: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatPerMetre, repeatPerMetre);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

/** Deterministic speckle, so the same scene always looks the same. */
function speckle(ctx: CanvasRenderingContext2D, count: number, tone: number, seed = 11) {
  let s = seed;
  const next = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  ctx.fillStyle = `rgba(0,0,0,${tone})`;
  for (let i = 0; i < count; i++) ctx.fillRect(next() * SIZE, next() * SIZE, 1 + next() * 3, 1 + next() * 3);
}

const GENERATORS: Record<string, () => THREE.CanvasTexture> = {
  brick: () =>
    paint((c) => {
      c.fillStyle = '#d9c8c0';
      c.fillRect(0, 0, SIZE, SIZE);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 3;
      for (let row = 0; row < 4; row++) {
        const y = (row * SIZE) / 4;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(SIZE, y);
        c.stroke();
        for (let col = 0; col < 2; col++) {
          const x = ((col + (row % 2) * 0.5) * SIZE) / 2;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x, y + SIZE / 4);
          c.stroke();
        }
      }
    }, 3),
  stone: () =>
    paint((c) => {
      speckle(c, 500, 0.08);
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.lineWidth = 2;
      c.strokeRect(1, 1, SIZE - 2, SIZE / 2 - 2);
      c.strokeRect(1, SIZE / 2 + 1, SIZE / 2, SIZE / 2 - 2);
      c.strokeRect(SIZE / 2 + 1, SIZE / 2 + 1, SIZE / 2 - 2, SIZE / 2 - 2);
    }, 1.2),
  tile: () =>
    paint((c) => {
      c.strokeStyle = 'rgba(0,0,0,0.2)';
      c.lineWidth = 2;
      c.strokeRect(0, 0, SIZE, SIZE);
    }, 1.67),
  wood: () =>
    paint((c) => {
      c.fillStyle = '#efe6dc';
      c.fillRect(0, 0, SIZE, SIZE);
      c.strokeStyle = 'rgba(70,40,10,0.18)';
      for (let i = 0; i < 18; i++) {
        c.beginPath();
        const x = (i * SIZE) / 18;
        c.moveTo(x, 0);
        c.bezierCurveTo(x + 3, SIZE / 3, x - 3, (2 * SIZE) / 3, x, SIZE);
        c.stroke();
      }
    }, 1.5),
  concrete: () => paint((c) => speckle(c, 900, 0.05), 1),
  grass: () => paint((c) => speckle(c, 1400, 0.14), 2),
  marble: () =>
    paint((c) => {
      c.strokeStyle = 'rgba(0,0,0,0.12)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(0, 30);
      c.bezierCurveTo(40, 60, 80, 10, SIZE, 50);
      c.moveTo(20, SIZE);
      c.bezierCurveTo(50, 90, 100, 110, SIZE, 80);
      c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.2)';
      c.lineWidth = 2;
      c.strokeRect(0, 0, SIZE, SIZE);
    }, 1),
};

/** One material per texture kind, built once per viewer. Vertex colours carry every user colour. */
export function createMaterials(): { get(key: BucketKey): THREE.Material; dispose(): void } {
  const made = new Map<BucketKey, THREE.Material>();
  const textures: THREE.Texture[] = [];
  return {
    get(key) {
      let m = made.get(key);
      if (m) return m;
      if (key === 'glass') {
        m = new THREE.MeshLambertMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      } else {
        const gen = GENERATORS[key];
        const map = gen ? gen() : null;
        if (map) textures.push(map);
        m = new THREE.MeshLambertMaterial({ vertexColors: true, map, side: THREE.FrontSide });
      }
      made.set(key, m);
      return m;
    },
    dispose() {
      made.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
