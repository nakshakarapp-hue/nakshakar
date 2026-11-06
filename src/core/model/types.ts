/**
 * Nakshakar data model. Every length is stored in millimetres; display units are a view concern.
 * Plan coordinates: +x points right, +y points down the screen. Height is a separate z value.
 */

export const SCHEMA_VERSION = 1;

export type Mm = number;
export type Id = string;
export interface Vec2 {
  x: Mm;
  y: Mm;
}

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'ftin' | 'yd' | 'gaj' | 'hath';
export type AngleUnit = 'deg' | 'rad';
export type ThemeName = 'light' | 'dark' | 'outdoor';
export type Language = 'en' | 'hi' | 'te' | 'ta' | 'kn' | 'ml' | 'mr' | 'gu' | 'bn';
export type Side = 'N' | 'E' | 'S' | 'W';
export type DisplayPrecision = 0 | 1 | 2 | 3 | 'eighth';

export interface SnapOptions {
  grid: boolean;
  endpoint: boolean;
  midpoint: boolean;
  centerLine: boolean;
  face: boolean;
  intersection: boolean;
  perpendicular: boolean;
  parallel: boolean;
  angle: boolean;
  equalLength: boolean;
  haptics: boolean;
}

export interface ProjectSettings {
  displayUnit: LengthUnit;
  secondaryUnit: LengthUnit;
  angleUnit: AngleUnit;
  currency: string;
  language: Language;
  northAngleDeg: number;
  gridSize: Mm;
  snapEnabled: boolean;
  snapOptions: SnapOptions;
  theme: ThemeName;
  precision: DisplayPrecision;
  dimensionMode: 'outer' | 'inner' | 'center';
  showDimensions: boolean;
  showArea: boolean;
  showFurnitureLabels: boolean;
  dimensionTextScale: number;
  /** End marks on automatic dimensions. */
  dimensionArrow?: 'tick' | 'arrow' | 'dot';
  dimensionBold?: boolean;
}

export interface Site {
  plot: Vec2[];
  plotWidth: Mm;
  plotLength: Mm;
  roadSide: Side | 'none';
  setbacks: { front: Mm; rear: Mm; left: Mm; right: Mm };
  /** One setback per plot side, in plot order, for plots that are not four-sided. */
  setbackList?: Mm[];
  groundLevelOffset: Mm;
  slopeDirection: Side | 'none';
  slopePercent: number;
}

export type WallType = 'outer' | 'inner' | 'parapet' | 'retaining' | 'compound' | 'half' | 'glass';
export type WallMaterial =
  | 'red_brick'
  | 'fly_ash_brick'
  | 'aac_block'
  | 'concrete_block'
  | 'stone'
  | 'rcc'
  | 'glass'
  | 'wood'
  | 'mud_brick';
export type Justification = 'center' | 'left' | 'right';
export type TextureId = 'none' | 'brick' | 'stone' | 'tile' | 'wood' | 'concrete' | 'grass' | 'marble';

export interface Wall {
  id: Id;
  start: Vec2;
  end: Vec2;
  /** Intermediate vertices for polyline walls. Ignored when bulge is non-zero. */
  points?: Vec2[];
  /** Arc bulge (tan of a quarter of the included angle); 0 is straight, 1 is a semicircle. */
  bulge: number;
  thickness: Mm;
  height: Mm;
  baseOffset: Mm;
  type: WallType;
  material: WallMaterial;
  leftColor: string;
  rightColor: string;
  leftTexture: TextureId;
  rightTexture: TextureId;
  topColor: string;
  plasterLeft: Mm;
  plasterRight: Mm;
  skirtingHeight: Mm;
  dadoHeight: Mm;
  dadoColor: string;
  justification: Justification;
  loadBearing: boolean;
  dampProof: boolean;
  /** Extra height at the wall's midpoint, producing a gable top. */
  gableRise: Mm;
  locked?: boolean;
  hidden?: boolean;
  name?: string;
  note?: string;
}

export type SwingSide = 'left' | 'right';
export type SwingDir = 'in' | 'out';

export interface Opening {
  id: Id;
  wallId: Id;
  kind: 'door' | 'window';
  /** Distance along the wall from its start to the opening's centre. */
  position: Mm;
  width: Mm;
  height: Mm;
  sillHeight: Mm;
  lintelHeight: Mm;
  frameThickness: Mm;
  frameMaterial: string;
  frameColor: string;
  shutterMaterial: string;
  shutterColor: string;
  glassType: string;
  glassTint: string;
  swingDirection: SwingDir;
  swingSide: SwingSide;
  panels: number;
  catalogId: string;
  grill: boolean;
  grillPattern: 'bars' | 'grid' | 'diamond';
  mosquitoNet: boolean;
  curtain: boolean;
  curtainColor: string;
  costOverride?: number;
  isMainEntrance?: boolean;
  name?: string;
  note?: string;
}

export interface Transform {
  x: Mm;
  y: Mm;
  z: Mm;
  /** Rotation around the vertical axis in degrees, clockwise on the plan. */
  rotation: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export type StairShape = 'straight' | 'l' | 'u' | 'spiral';

export interface Stair {
  id: Id;
  catalogId: string;
  transform: Transform;
  shape: StairShape;
  width: Mm;
  riser: Mm;
  tread: Mm;
  totalRise: Mm;
  turnLeft: boolean;
  treadColor: string;
  railColor: string;
  hasRailing: boolean;
  name: string;
  note: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface Pillar {
  id: Id;
  catalogId: string;
  transform: Transform;
  shape: 'rect' | 'round';
  width: Mm;
  depth: Mm;
  height: Mm;
  color: string;
  name: string;
  note: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface Beam {
  id: Id;
  catalogId: string;
  start: Vec2;
  end: Vec2;
  width: Mm;
  depth: Mm;
  /** Height of the beam soffit above floor level. */
  soffit: Mm;
  color: string;
  name: string;
  note: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface Slab {
  id: Id;
  catalogId: string;
  polygon: Vec2[];
  holes: Vec2[][];
  thickness: Mm;
  zOffset: Mm;
  color: string;
  name: string;
  note: string;
}

export type RoofType = 'flat' | 'gable' | 'hip' | 'shed';

export interface Roof {
  type: RoofType;
  overhang: Mm;
  rise: Mm;
  ridgeAlongX: boolean;
  thickness: Mm;
  color: string;
  parapetHeight: Mm;
  parapetColor: string;
}

export interface PlacedObject {
  id: Id;
  catalogId: string;
  transform: Transform;
  width: Mm;
  depth: Mm;
  height: Mm;
  /** Colour per named catalogue part. */
  colors: Record<string, string>;
  name: string;
  note: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface Plant {
  id: Id;
  catalogId: string;
  transform: Transform;
  spread: Mm;
  height: Mm;
  foliageColor: string;
  trunkColor: string;
  name: string;
  note: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface DimensionAnnotation {
  id: Id;
  a: Vec2;
  b: Vec2;
  offset: Mm;
  arrow: 'tick' | 'arrow' | 'dot';
}

export interface Label {
  id: Id;
  at: Vec2;
  text: string;
  size: Mm;
  color: string;
}

export type ElectricalKind = 'switch' | 'socket' | 'light' | 'fan' | 'ac' | 'db';
export interface ElectricalPoint {
  id: Id;
  at: Vec2;
  kind: ElectricalKind;
  height: Mm;
  note: string;
}

export type PlumbingKind =
  'inlet' | 'drain' | 'tap' | 'floor_trap' | 'septic' | 'borewell' | 'sump' | 'overhead_tank';
export interface PlumbingPoint {
  id: Id;
  at: Vec2;
  kind: PlumbingKind;
  note: string;
}

export const ROOM_TYPES = [
  'living',
  'drawing',
  'dining',
  'kitchen',
  'master_bedroom',
  'bedroom',
  'kids_room',
  'guest_room',
  'pooja',
  'study',
  'store',
  'toilet',
  'bathroom',
  'wash_area',
  'utility',
  'balcony',
  'verandah',
  'porch',
  'staircase',
  'passage',
  'garage',
  'terrace',
  'open_court',
  'other',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export type CompassZone = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'C';
export type FloorFinish =
  'vitrified' | 'ceramic' | 'marble' | 'granite' | 'kota' | 'wood' | 'cement' | 'grass';

export interface Room {
  id: Id;
  name: string;
  type: RoomType;
  /** Clear (finished-face) outline, used for area, flooring and 3D floors. */
  polygon: Vec2[];
  holes: Vec2[][];
  /** Centre-line outline as detected; used to keep room identity between edits. */
  centerline: Vec2[];
  /** Clear area in square metres. */
  area: number;
  perimeter: Mm;
  floorFinish: FloorFinish;
  floorColor: string;
  ceilingType: 'plain' | 'pop' | 'gypsum' | 'wood';
  ceilingColor: string;
  ceilingHeight: Mm;
  wallPaintColor: string;
  centroid: Vec2;
  zone: CompassZone;
  userNamed: boolean;
}

export interface Floor {
  id: Id;
  name: string;
  levelIndex: number;
  elevation: Mm;
  floorToFloor: Mm;
  slabThickness: Mm;
  finishThickness: Mm;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  stairs: Stair[];
  pillars: Pillar[];
  beams: Beam[];
  slabs: Slab[];
  objects: PlacedObject[];
  plants: Plant[];
  dimensions: DimensionAnnotation[];
  labels: Label[];
  electrical: ElectricalPoint[];
  plumbing: PlumbingPoint[];
  visible: boolean;
  locked: boolean;
  colorTag: string;
  hiddenCategories: string[];
}

export interface VastuSettings {
  enabled: boolean;
  /** Rule ids the user has chosen to exclude from the score. */
  ignoredRules: string[];
}

export interface EstimateSettings {
  /** Rate key -> user-typed unit rate. Anything absent falls back to the editable defaults. */
  rates: Record<string, number>;
  quality: 'economy' | 'standard' | 'premium';
  foundation: 'isolated' | 'strip' | 'raft';
  includeInteriors: boolean;
  includeCompound: boolean;
  contingencyPercent: number;
  crewSize: number;
  cementType: 'OPC' | 'PPC';
}

export interface MaterialOverride {
  color?: string;
  texture?: TextureId;
}

export interface Project {
  id: Id;
  name: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  settings: ProjectSettings;
  site: Site;
  floors: Floor[];
  elevationStyleId: string;
  elevationOverrides: { wallColor?: string; accentColor?: string };
  roof: Roof;
  materials: Record<string, MaterialOverride>;
  estimate: EstimateSettings;
  vastu: VastuSettings;
  notes: string;
  tags: string[];
  thumbnail: string;
}

export interface ProjectMeta {
  id: Id;
  name: string;
  updatedAt: number;
  createdAt: number;
  thumbnail: string;
  floorCount: number;
  tags: string[];
}

/** Item categories that can be hidden per floor. */
export const LAYER_CATEGORIES = [
  'walls',
  'openings',
  'stairs',
  'pillars',
  'beams',
  'objects',
  'plants',
  'dimensions',
  'labels',
  'electrical',
  'plumbing',
] as const;
export type LayerCategory = (typeof LAYER_CATEGORIES)[number];
