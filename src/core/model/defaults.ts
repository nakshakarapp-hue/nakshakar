import { newId } from './ids';
import {
  SCHEMA_VERSION,
  type Beam,
  type Floor,
  type Label,
  type Opening,
  type Pillar,
  type PlacedObject,
  type Plant,
  type Project,
  type ProjectSettings,
  type Roof,
  type Room,
  type Slab,
  type Stair,
  type Transform,
  type Vec2,
  type Wall,
} from './types';

export const APP_NAME = 'Nakshakar';
export const DEFAULT_WALL_THICKNESS = 230;
export const DEFAULT_INNER_THICKNESS = 115;
export const DEFAULT_WALL_HEIGHT = 3000;

export function defaultSettings(): ProjectSettings {
  return {
    displayUnit: 'ftin',
    secondaryUnit: 'm',
    angleUnit: 'deg',
    currency: 'INR',
    language: 'en',
    northAngleDeg: 0,
    gridSize: 100,
    snapEnabled: true,
    snapOptions: {
      grid: true,
      endpoint: true,
      midpoint: true,
      centerLine: true,
      face: true,
      intersection: true,
      perpendicular: true,
      parallel: true,
      angle: true,
      equalLength: false,
      haptics: true,
    },
    theme: 'light',
    precision: 'eighth',
    dimensionMode: 'center',
    showDimensions: true,
    showArea: true,
    showFurnitureLabels: false,
    dimensionTextScale: 1,
  };
}

export function defaultRoof(): Roof {
  return {
    type: 'flat',
    overhang: 450,
    rise: 1500,
    ridgeAlongX: true,
    thickness: 125,
    color: '#a8563a',
    parapetHeight: 1000,
    parapetColor: '#f4efe6',
  };
}

export function identityTransform(x = 0, y = 0, z = 0, rotation = 0): Transform {
  return { x, y, z, rotation, scaleX: 1, scaleY: 1, scaleZ: 1 };
}

export function createWall(start: Vec2, end: Vec2, over: Partial<Wall> = {}): Wall {
  return {
    id: newId(),
    start: { ...start },
    end: { ...end },
    bulge: 0,
    thickness: DEFAULT_WALL_THICKNESS,
    height: DEFAULT_WALL_HEIGHT,
    baseOffset: 0,
    type: 'outer',
    material: 'red_brick',
    leftColor: '#f4efe6',
    rightColor: '#f4efe6',
    leftTexture: 'none',
    rightTexture: 'none',
    topColor: '#d9d4c8',
    plasterLeft: 12,
    plasterRight: 12,
    skirtingHeight: 100,
    dadoHeight: 0,
    dadoColor: '#dfe6ea',
    justification: 'center',
    loadBearing: false,
    dampProof: true,
    gableRise: 0,
    ...over,
  };
}

export function createOpening(
  wallId: string,
  position: number,
  kind: 'door' | 'window',
  over: Partial<Opening> = {},
): Opening {
  const isDoor = kind === 'door';
  return {
    id: newId(),
    wallId,
    kind,
    position,
    width: isDoor ? 900 : 1200,
    height: isDoor ? 2100 : 1200,
    sillHeight: isDoor ? 0 : 900,
    lintelHeight: 2100,
    frameThickness: 75,
    frameMaterial: isDoor ? 'teak' : 'upvc',
    frameColor: isDoor ? '#6b4423' : '#f5f5f5',
    shutterMaterial: isDoor ? 'flush' : 'glass',
    shutterColor: isDoor ? '#8a5a2b' : '#bcd9e6',
    glassType: 'clear',
    glassTint: '#bcd9e6',
    swingDirection: 'in',
    swingSide: 'left',
    panels: isDoor ? 1 : 2,
    catalogId: isDoor ? 'door_single' : 'win_sliding',
    grill: false,
    grillPattern: 'bars',
    mosquitoNet: false,
    curtain: false,
    curtainColor: '#c9a66b',
    ...over,
  };
}

export function createPillar(at: Vec2, over: Partial<Pillar> = {}): Pillar {
  return {
    id: newId(),
    catalogId: 'pillar_rect',
    transform: identityTransform(at.x, at.y),
    shape: 'rect',
    width: 300,
    depth: 300,
    height: DEFAULT_WALL_HEIGHT,
    color: '#d9d4c8',
    name: 'Pillar',
    note: '',
    ...over,
  };
}

export function createBeam(start: Vec2, end: Vec2, over: Partial<Beam> = {}): Beam {
  return {
    id: newId(),
    catalogId: 'beam_rect',
    start: { ...start },
    end: { ...end },
    width: 230,
    depth: 450,
    soffit: DEFAULT_WALL_HEIGHT - 450,
    color: '#d9d4c8',
    name: 'Beam',
    note: '',
    ...over,
  };
}

export function createSlab(polygon: Vec2[], over: Partial<Slab> = {}): Slab {
  return {
    id: newId(),
    catalogId: 'slab_rcc',
    polygon: polygon.map((p) => ({ ...p })),
    holes: [],
    thickness: 125,
    zOffset: 0,
    color: '#cfcfcf',
    name: 'Slab',
    note: '',
    ...over,
  };
}

export function createStair(at: Vec2, over: Partial<Stair> = {}): Stair {
  return {
    id: newId(),
    catalogId: 'stair_u',
    transform: identityTransform(at.x, at.y),
    shape: 'u',
    width: 1000,
    riser: 170,
    tread: 250,
    totalRise: 3150,
    turnLeft: false,
    treadColor: '#b9b2a3',
    railColor: '#3d3d3d',
    hasRailing: true,
    name: 'Stairs',
    note: '',
    ...over,
  };
}

export function createObject(
  catalogId: string,
  at: Vec2,
  size: { width: number; depth: number; height: number },
  name: string,
  colors: Record<string, string>,
  z = 0,
): PlacedObject {
  return {
    id: newId(),
    catalogId,
    transform: identityTransform(at.x, at.y, z),
    ...size,
    colors,
    name,
    note: '',
  };
}

export function createPlant(
  catalogId: string,
  at: Vec2,
  spread: number,
  height: number,
  name: string,
  foliageColor = '#3f8f3f',
  trunkColor = '#6b4a2b',
): Plant {
  return {
    id: newId(),
    catalogId,
    transform: identityTransform(at.x, at.y),
    spread,
    height,
    foliageColor,
    trunkColor,
    name,
    note: '',
  };
}

export function createLabel(at: Vec2, text: string): Label {
  return { id: newId(), at: { ...at }, text, size: 200, color: '#1b2733' };
}

export function createFloor(
  name: string,
  levelIndex: number,
  elevation: number,
  over: Partial<Floor> = {},
): Floor {
  return {
    id: newId(),
    name,
    levelIndex,
    elevation,
    floorToFloor: 3150,
    slabThickness: 125,
    finishThickness: 25,
    walls: [],
    openings: [],
    rooms: [],
    stairs: [],
    pillars: [],
    beams: [],
    slabs: [],
    objects: [],
    plants: [],
    dimensions: [],
    labels: [],
    electrical: [],
    plumbing: [],
    visible: true,
    locked: false,
    colorTag: '#4a90d9',
    hiddenCategories: [],
    ...over,
  };
}

export function createRoom(
  partial: Partial<Room> & Pick<Room, 'polygon' | 'centerline' | 'area' | 'perimeter' | 'centroid' | 'zone'>,
): Room {
  return {
    id: newId(),
    name: 'Room',
    type: 'other',
    holes: [],
    floorFinish: 'vitrified',
    floorColor: '#e8e2d6',
    ceilingType: 'plain',
    ceilingColor: '#fbfaf7',
    ceilingHeight: DEFAULT_WALL_HEIGHT,
    wallPaintColor: '#f4efe6',
    userNamed: false,
    ...partial,
  };
}

export function createProject(name: string): Project {
  const now = Date.now();
  return {
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(),
    site: {
      plot: [],
      plotWidth: 12192,
      plotLength: 18288,
      roadSide: 'none',
      setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
      groundLevelOffset: 450,
      slopeDirection: 'none',
      slopePercent: 0,
    },
    floors: [createFloor('Ground Floor', 0, 0)],
    elevationStyleId: 'modern_flat',
    elevationOverrides: {},
    roof: defaultRoof(),
    materials: {},
    estimate: {
      rates: {},
      quality: 'standard',
      foundation: 'isolated',
      includeInteriors: false,
      includeCompound: false,
      contingencyPercent: 5,
      crewSize: 8,
      cementType: 'PPC',
    },
    vastu: { enabled: true, ignoredRules: [] },
    notes: '',
    tags: [],
    thumbnail: '',
  };
}
