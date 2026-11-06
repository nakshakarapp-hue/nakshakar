import {
  createFloor,
  createLabel,
  createObject,
  createOpening,
  createPillar,
  createPlant,
  createProject,
  createStair,
  createWall,
  DEFAULT_INNER_THICKNESS,
} from '../core/model/defaults';
import type { Floor, Project, RoomType, Vec2, Wall } from '../core/model/types';
import { pointInPolygon } from '../core/geometry/polygon';
import { syncRooms } from '../editor2d/commands';
import { objectById, openingTypeById, plantById } from './catalog';

const P = (x: number, y: number): Vec2 => ({ x, y });

/** House outline used by the sample: 8 m wide, 11 m deep, on a 30 ft x 50 ft plot. North is up. */
const W = 8000;
const D = 11000;

function outer(floor: Floor): Wall[] {
  const pts = [P(0, 0), P(W, 0), P(W, D), P(0, D)];
  const walls = pts.map((p, i) =>
    createWall(p, pts[(i + 1) % 4], { type: 'outer', leftColor: '#e9dcc3', rightColor: '#f4efe6' }),
  );
  floor.walls.push(...walls);
  return walls;
}

function inner(floor: Floor, a: Vec2, b: Vec2): Wall {
  const w = createWall(a, b, {
    type: 'inner',
    thickness: DEFAULT_INNER_THICKNESS,
    leftColor: '#f4efe6',
    rightColor: '#f4efe6',
  });
  floor.walls.push(w);
  return w;
}

function fit(
  floor: Floor,
  wall: Wall,
  typeId: string,
  position: number,
  over: Partial<ReturnType<typeof createOpening>> = {},
) {
  const t = openingTypeById.get(typeId)!;
  floor.openings.push(
    createOpening(wall.id, position, t.kind, {
      catalogId: t.id,
      width: t.width,
      height: t.height,
      sillHeight: t.sill,
      lintelHeight: t.sill + t.height,
      panels: t.panels,
      shutterMaterial: t.shutterMaterial,
      shutterColor: t.shutterColor,
      frameColor: t.frameColor,
      ...over,
    }),
  );
}

function place(floor: Floor, id: string, x: number, y: number, rotation = 0) {
  const c = objectById.get(id)!;
  const item = createObject(
    id,
    P(x, y),
    { width: c.width, depth: c.depth, height: c.height },
    c.name,
    { ...c.colors },
    c.mount ?? 0,
  );
  item.transform.rotation = rotation;
  floor.objects.push(item);
}

function name(floor: Floor, at: Vec2, label: string, type: RoomType) {
  const room = floor.rooms.find((r) => pointInPolygon(at, r.centerline));
  if (!room) throw new Error(`Sample house has no room at ${at.x},${at.y} for ${label}`);
  room.name = label;
  room.type = type;
  room.userNamed = true;
  if (type === 'toilet' || type === 'bathroom') {
    room.floorFinish = 'ceramic';
    room.floorColor = '#c9d3d6';
  }
  if (type === 'bathroom' || type === 'toilet' || type === 'kitchen') room.ceilingType = 'plain';
}

function groundFloor(): Floor {
  const f = createFloor('Ground Floor', 0, 0);
  const [north, east, south, west] = outer(f);
  const midH = inner(f, P(0, 6500), P(W, 6500));
  const v1 = inner(f, P(3500, 0), P(3500, 6500));
  const toiletH = inner(f, P(0, 2400), P(3500, 2400));
  const foyerH = inner(f, P(3500, 1800), P(W, 1800));
  const poojaV = inner(f, P(6200, 0), P(6200, 1800));
  const masterV = inner(f, P(3200, 6500), P(3200, D));
  const stairE = inner(f, P(5400, 6500), P(5400, D));
  const stairN = inner(f, P(3200, 7500), P(5400, 7500));
  const kitchenN = inner(f, P(5400, 8300), P(W, 8300));
  syncRooms(f, 0);

  name(f, P(1700, 1200), 'Toilet', 'toilet');
  name(f, P(1700, 4500), 'Guest Bedroom', 'guest_room');
  name(f, P(4800, 900), 'Entrance Foyer', 'verandah');
  name(f, P(7100, 900), 'Pooja', 'pooja');
  name(f, P(5700, 4100), 'Living Room', 'living');
  name(f, P(1600, 8700), 'Master Bedroom', 'master_bedroom');
  name(f, P(4300, 7000), 'Dining', 'dining');
  name(f, P(4300, 9200), 'Staircase', 'staircase');
  name(f, P(6700, 7400), 'Utility', 'utility');
  name(f, P(6700, 9600), 'Kitchen', 'kitchen');

  // Doors. Positions run along each wall from its start point.
  fit(f, north, 'door_main', 4850, { isMainEntrance: true, name: 'Main entrance' });
  fit(f, foyerH, 'door_double', 1350);
  fit(f, poojaV, 'door_pooja', 900);
  fit(f, v1, 'door_single', 4400, { swingSide: 'right' });
  fit(f, toiletH, 'door_bath', 2800);
  fit(f, midH, 'door_single', 2700, { swingSide: 'right' });
  fit(f, midH, 'door_arch', 4300);
  fit(f, stairN, 'door_arch', 1100);
  fit(f, stairE, 'door_single', 1000);
  fit(f, kitchenN, 'door_single', 1300);

  // Windows.
  fit(f, north, 'win_vent', 1750);
  fit(f, east, 'win_sliding', 3800);
  fit(f, east, 'win_sliding', 9600);
  fit(f, east, 'win_vent', 7400);
  fit(f, south, 'win_sliding', 6500);
  fit(f, west, 'win_sliding', 2300);
  fit(f, west, 'win_sliding', 6500);
  fit(f, masterV, 'door_single', 800);

  const stair = createStair(P(3300, 10800), {
    catalogId: 'stair_u',
    shape: 'u',
    width: 950,
    tread: 250,
    riser: 166,
    totalRise: 3150,
  });
  f.stairs.push(stair);
  for (const c of [P(0, 0), P(W, 0), P(W, D), P(0, D), P(3500, 6500), P(5400, 6500)])
    f.pillars.push(createPillar(c, { width: 300, depth: 380 }));

  place(f, 'sofa_3', 5700, 5800, 180);
  place(f, 'table_coffee', 5700, 4700);
  place(f, 'tv_unit', 6900, 2150);
  place(f, 'bed_queen', 1600, 7650);
  place(f, 'wardrobe_2', 1000, 10550);
  place(f, 'bed_single', 2300, 4300, 90);
  place(f, 'dining_4', 4300, 7000);
  place(f, 'counter', 6900, 10650);
  place(f, 'stove', 7300, 10650);
  place(f, 'fridge', 5800, 8750);
  place(f, 'wc_western', 700, 700);
  place(f, 'basin', 2300, 400);
  place(f, 'mandir', 7300, 500);
  place(f, 'washing_machine', 7500, 6800);
  f.plants.push(
    createPlant(
      'tulsi',
      P(9000, -700),
      450,
      900,
      plantById.get('tulsi')!.name,
      plantById.get('tulsi')!.foliage,
      plantById.get('tulsi')!.trunk,
    ),
    createPlant(
      'tree_neem',
      P(-1500, 12500),
      3500,
      6000,
      plantById.get('tree_neem')!.name,
      plantById.get('tree_neem')!.foliage,
      plantById.get('tree_neem')!.trunk,
    ),
    createPlant(
      'shrub',
      P(9000, 3000),
      800,
      900,
      plantById.get('shrub')!.name,
      plantById.get('shrub')!.foliage,
      plantById.get('shrub')!.trunk,
    ),
  );
  f.electrical.push(
    { id: crypto.randomUUID(), at: P(5900, 4000), kind: 'fan', height: 2700, note: '' },
    { id: crypto.randomUUID(), at: P(3620, 2000), kind: 'switch', height: 1200, note: '' },
  );
  f.plumbing.push(
    { id: crypto.randomUUID(), at: P(7600, -600), kind: 'borewell', note: '' },
    { id: crypto.randomUUID(), at: P(-500, 1000), kind: 'septic', note: '' },
  );
  f.labels.push(createLabel(P(W / 2, -900), 'Main road side'));
  return f;
}

function firstFloor(elevation: number): Floor {
  const f = createFloor('First Floor', 1, elevation);
  const [north, east, south, west] = outer(f);
  const midH = inner(f, P(0, 6500), P(W, 6500));
  const v1 = inner(f, P(3500, 0), P(3500, 6500));
  const bathH = inner(f, P(0, 2400), P(3500, 2400));
  const masterV = inner(f, P(3200, 6500), P(3200, D));
  const stairE = inner(f, P(5400, 6500), P(5400, D));
  const stairN = inner(f, P(3200, 7500), P(5400, 7500));
  syncRooms(f, 0);
  name(f, P(1700, 1200), 'Bathroom', 'bathroom');
  name(f, P(1700, 4500), 'Kids Room', 'kids_room');
  name(f, P(5700, 3200), 'Family Lounge', 'living');
  name(f, P(1600, 8700), 'Master Bedroom 2', 'master_bedroom');
  name(f, P(4300, 7000), 'Passage', 'passage');
  name(f, P(4300, 9200), 'Staircase', 'staircase');
  name(f, P(6700, 8700), 'Study', 'study');

  fit(f, north, 'door_sliding', 5700, { name: 'Balcony door' });
  fit(f, north, 'win_vent', 1750);
  fit(f, east, 'win_sliding', 3800);
  fit(f, east, 'win_sliding', 8800);
  fit(f, south, 'win_sliding', 6500);
  fit(f, west, 'win_sliding', 2300);
  fit(f, west, 'win_sliding', 6500);
  fit(f, v1, 'door_single', 4400, { swingSide: 'right' });
  fit(f, bathH, 'door_bath', 2800);
  fit(f, midH, 'door_single', 4300);
  fit(f, midH, 'door_single', 2700, { swingSide: 'right' });
  fit(f, stairN, 'door_arch', 1100);
  fit(f, stairE, 'door_single', 1000);
  fit(f, masterV, 'door_single', 800);

  f.stairs.push(
    createStair(P(3300, 10800), {
      catalogId: 'stair_u',
      shape: 'u',
      width: 950,
      tread: 250,
      riser: 166,
      totalRise: 3150,
    }),
  );
  for (const c of [P(0, 0), P(W, 0), P(W, D), P(0, D), P(3500, 6500), P(5400, 6500)])
    f.pillars.push(createPillar(c, { width: 300, depth: 380 }));
  place(f, 'bed_queen', 1600, 7650);
  place(f, 'wardrobe_3', 1300, 10550);
  place(f, 'bed_single', 2300, 4300, 90);
  place(f, 'sofa_2', 5700, 4800, 180);
  place(f, 'study_desk', 6700, 10500);
  place(f, 'office_chair', 6700, 9900);
  place(f, 'wc_western', 700, 700);
  place(f, 'basin', 2300, 400);
  return f;
}

function terrace(elevation: number): Floor {
  const f = createFloor('Terrace', 2, elevation, { floorToFloor: 1000 });
  const pts = [P(0, 0), P(W, 0), P(W, D), P(0, D)];
  f.walls.push(
    ...pts.map((p, i) => createWall(p, pts[(i + 1) % 4], { type: 'parapet', height: 1000, thickness: 150 })),
  );
  syncRooms(f, 0);
  name(f, P(W / 2, D / 2), 'Terrace', 'terrace');
  f.rooms[0].floorFinish = 'cement';
  f.rooms[0].floorColor = '#c9c5bb';
  place(f, 'water_tank', 700, 10000);
  return f;
}

/** A complete worked example: two storeys and a terrace, with stairs, doors, furniture and plants. */
export function createSampleProject(extraFloors = 0): Project {
  const p = createProject(extraFloors ? 'Sample three-storey house' : 'Sample two-storey house');
  p.site.plotWidth = 9144 * 1.25;
  p.site.plotLength = 15240;
  p.site.plot = [P(-1500, -2000), P(9500, -2000), P(9500, 13240), P(-1500, 13240)];
  p.site.roadSide = 'N';
  p.tags = ['sample'];
  p.notes =
    'Worked example. Sizes are illustrative; have a licensed engineer check the structure before building.';
  const step = 3150;
  p.floors = [groundFloor(), firstFloor(step)];
  for (let i = 0; i < extraFloors; i++) {
    const copy = firstFloor(step * (i + 2));
    copy.name = `Upper Floor ${i + 2}`;
    copy.levelIndex = i + 2;
    p.floors.push(copy);
  }
  p.floors.push(terrace(step * (2 + extraFloors)));
  p.elevationOverrides = { wallColor: '#f3e3c8', accentColor: '#b85c3e' };
  return p;
}
