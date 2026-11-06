import * as THREE from 'three';
import type { Side } from '../core/model/types';

export interface World {
  group: THREE.Group;
  /** The surface a tap can plant on. */
  ground: THREE.Mesh;
  setNight(night: boolean): void;
  dispose(): void;
}

function speckleTexture(base: string, flecks: string[], count: number, repeat: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d')!;
  c.fillStyle = base;
  c.fillRect(0, 0, size, size);
  let seed = 19;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  c.globalAlpha = 0.5;
  for (let i = 0; i < count; i++) {
    c.fillStyle = flecks[Math.floor(next() * flecks.length)];
    c.fillRect(next() * size, next() * size, 1 + next() * 2, 1 + next() * 2.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A soft round puff, for clouds. */
function puffTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size / 2;
  const c = canvas.getContext('2d')!;
  let seed = 41;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 26; i++) {
    const x = size * (0.16 + next() * 0.68);
    const y = (size / 2) * (0.42 + next() * 0.2);
    const r = 18 + next() * 30;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Everything around the house: sky, sun, ground, road, far hills, trees and clouds, in natural muted
 * colours. It uses very few draw calls, because the trees are instanced.
 */
export function createWorld(
  center: THREE.Vector3,
  radius: number,
  roadSide: Side | 'none',
  north: number,
  groundY: number,
  shadows: boolean,
  /** Where the visitor starts; the way from there to the house is kept clear. */
  start: { x: number; z: number },
): World {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const rng = (() => {
    let seed = 7;
    return () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
  })();

  // Sky: a gradient dome, with a soft sun.
  const skyUniforms = {
    top: { value: new THREE.Color('#6f9fc9') },
    bottom: { value: new THREE.Color('#e6edf1') },
    sunColor: { value: new THREE.Color('#fff4e0') },
    sunDir: { value: new THREE.Vector3(0.5, 0.75, 0.35).normalize() },
    sunStrength: { value: 1 },
  };
  const sky = new THREE.Mesh(
    keep(new THREE.SphereGeometry(900, 24, 12)),
    keep(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: skyUniforms,
        vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec3 vDir; uniform vec3 top; uniform vec3 bottom; uniform vec3 sunColor; uniform vec3 sunDir; uniform float sunStrength;
          void main() {
            float h = clamp(vDir.y * 1.5, 0.0, 1.0);
            vec3 col = mix(bottom, top, pow(h, 0.7));
            float d = max(dot(normalize(vDir), sunDir), 0.0);
            col += sunColor * (pow(d, 600.0) * 1.2 + pow(d, 16.0) * 0.12) * sunStrength;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    ),
  );
  sky.position.copy(center);
  sky.renderOrder = -10;
  group.add(sky);

  // Ground.
  const grassTex = keep(speckleTexture('#74895a', ['#6b8052', '#7c9162', '#657a4d', '#84966a'], 26000, 300));
  const ground = new THREE.Mesh(
    keep(new THREE.CircleGeometry(800, 48)),
    keep(new THREE.MeshLambertMaterial({ map: grassTex })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, groundY - 0.012, center.z);
  ground.receiveShadow = shadows;
  group.add(ground);

  // A road on the side the house faces, or behind the plot when none is set.
  const a = (north * Math.PI) / 180;
  const sideAngle: Record<string, number> = {
    N: 0,
    E: Math.PI / 2,
    S: Math.PI,
    W: -Math.PI / 2,
    none: Math.PI,
  };
  const bearing = a + (sideAngle[roadSide] ?? Math.PI);
  const out = new THREE.Vector3(Math.sin(bearing), 0, -Math.cos(bearing));
  const roadOffset = radius + 9;
  const asphalt = keep(speckleTexture('#5a5c5e', ['#525456', '#626466', '#4c4e50'], 16000, 1));
  asphalt.repeat.set(2, 160);
  const road = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(8, 1600)),
    keep(new THREE.MeshLambertMaterial({ map: asphalt })),
  );
  road.rotation.x = -Math.PI / 2;
  road.rotation.z = -bearing + Math.PI / 2;
  road.position.set(center.x + out.x * roadOffset, groundY - 0.004, center.z + out.z * roadOffset);
  road.receiveShadow = shadows;
  group.add(road);
  const dash = keep(new THREE.MeshBasicMaterial({ color: '#cfcdc4' }));
  const dashGeom = keep(new THREE.PlaneGeometry(0.15, 2.4));
  const dashes = new THREE.InstancedMesh(dashGeom, dash, 120);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const along = new THREE.Vector3(out.z, 0, -out.x);
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -bearing + Math.PI));
  for (let i = 0; i < 120; i++) {
    const t = (i - 60) * 8;
    m.compose(
      new THREE.Vector3(road.position.x + along.x * t, groundY + 0.004, road.position.z + along.z * t),
      tilt,
      new THREE.Vector3(1, 1, 1),
    );
    dashes.setMatrixAt(i, m);
  }
  group.add(dashes);

  // Far hills: low rounded mounds, softened by haze.
  const hillMat = keep(new THREE.MeshLambertMaterial({ color: '#73876f' }));
  const hillGeom = keep(new THREE.SphereGeometry(1, 16, 10));
  const hills = new THREE.InstancedMesh(hillGeom, hillMat, 40);
  for (let i = 0; i < 40; i++) {
    const ang = (i / 40) * Math.PI * 2 + rng() * 0.1;
    const r = 560 + rng() * 160;
    const w = 110 + rng() * 170;
    const h = 22 + rng() * 42;
    q.identity();
    m.compose(
      new THREE.Vector3(center.x + Math.cos(ang) * r, groundY - 4, center.z + Math.sin(ang) * r),
      q,
      new THREE.Vector3(w, h, w * 0.7),
    );
    hills.setMatrixAt(i, m);
  }
  group.add(hills);

  // Trees: several rounded masses of leaves to each, with darker and lighter ones among them.
  const trunkGeom = keep(new THREE.CylinderGeometry(0.1, 0.2, 1, 7));
  const crownGeom = keep(new THREE.IcosahedronGeometry(1, 2));
  const trunkMat = keep(new THREE.MeshLambertMaterial({ color: '#5a4a3a' }));
  const crownMat = keep(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  const TREES = 130;
  const LUMPS = 4;
  const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, TREES);
  const crowns = new THREE.InstancedMesh(crownGeom, crownMat, TREES * LUMPS);
  const tone = new THREE.Color();
  for (let i = 0; i < TREES; i++) {
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 12; tries++) {
      const ang = rng() * Math.PI * 2;
      const r = radius + 26 + rng() * 320;
      x = center.x + Math.cos(ang) * r;
      z = center.z + Math.sin(ang) * r;
      const dx = x - road.position.x;
      const dz = z - road.position.z;
      const offRoad = Math.abs(dx * out.x + dz * out.z) > 9;
      // Distance from the straight walk between the start and the house.
      const wx = start.x - center.x;
      const wz = start.z - center.z;
      const along = Math.max(
        0,
        Math.min(1, ((x - center.x) * wx + (z - center.z) * wz) / (wx * wx + wz * wz || 1)),
      );
      const offPath = Math.hypot(x - center.x - wx * along, z - center.z - wz * along) > 14;
      if (offRoad && offPath) break;
    }
    const height = 3.6 + rng() * 3.6;
    const spread = 1.8 + rng() * 1.7;
    q.identity();
    m.compose(
      new THREE.Vector3(x, groundY + height * 0.3, z),
      q,
      new THREE.Vector3(1 + spread * 0.45, height * 0.6, 1 + spread * 0.45),
    );
    trunks.setMatrixAt(i, m);
    const hue = 0.24 + rng() * 0.05;
    const light = 0.2 + rng() * 0.08;
    for (let k = 0; k < LUMPS; k++) {
      const off = k === 0 ? 0 : spread * 0.62;
      const ang = (k / (LUMPS - 1)) * Math.PI * 2 + rng();
      const size = spread * (k === 0 ? 1 : 0.68 + rng() * 0.2);
      q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, 0));
      m.compose(
        new THREE.Vector3(
          x + Math.cos(ang) * off,
          groundY + height * (k === 0 ? 0.78 : 0.62 + rng() * 0.12),
          z + Math.sin(ang) * off,
        ),
        q,
        new THREE.Vector3(size, size * 0.86, size),
      );
      crowns.setMatrixAt(i * LUMPS + k, m);
      crowns.setColorAt(i * LUMPS + k, tone.setHSL(hue, 0.32, light + (k === 0 ? 0.03 : 0)));
    }
  }
  group.add(trunks, crowns);

  // Clouds: soft, thin and high.
  const puff = keep(puffTexture());
  const cloudMat = keep(
    new THREE.SpriteMaterial({ map: puff, transparent: true, opacity: 0.75, depthWrite: false, fog: false }),
  );
  for (let i = 0; i < 16; i++) {
    const sprite = new THREE.Sprite(cloudMat);
    const ang = rng() * Math.PI * 2;
    const r = 260 + rng() * 420;
    sprite.position.set(
      center.x + Math.cos(ang) * r,
      groundY + 95 + rng() * 80,
      center.z + Math.sin(ang) * r,
    );
    const w = 110 + rng() * 150;
    sprite.scale.set(w, w * 0.32, 1);
    group.add(sprite);
  }

  const setNight = (night: boolean) => {
    skyUniforms.top.value.set(night ? '#0a1222' : '#6f9fc9');
    skyUniforms.bottom.value.set(night ? '#1d2a3f' : '#e6edf1');
    skyUniforms.sunStrength.value = night ? 0.1 : 1;
    cloudMat.opacity = night ? 0.12 : 0.75;
  };

  return {
    group,
    ground,
    setNight,
    dispose() {
      disposables.forEach((d) => d.dispose());
      dashes.dispose();
      hills.dispose();
      trunks.dispose();
      crowns.dispose();
    },
  };
}
