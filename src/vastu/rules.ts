import { bbox, pointInPolygon, polygonArea, signedArea, simplifyPolygon } from '../core/geometry/polygon';
import { bearingOf, compassZone, floorExtents, zoneFromBearing } from '../core/geometry/rooms';
import { leftNormal } from '../core/geometry/vec';
import { pointOnWall } from '../core/geometry/wallGraph';
import type {
  CompassZone,
  Floor,
  Opening,
  Project,
  Room,
  RoomType,
  Side,
  Vec2,
  Wall,
} from '../core/model/types';

export type VastuStatus = 'good' | 'okay' | 'poor' | 'na';

export interface VastuFinding {
  ruleId: string;
  title: string;
  status: VastuStatus;
  weight: number;
  /** Where it was found, in the user's own terms. */
  detail: string;
  /** The same sentence with its values apart, so it can be translated. */
  template: string;
  vars: Record<string, string>;
  /** What to change. Empty when nothing needs changing. */
  suggestion: string;
  floor?: string;
}

export interface VastuReport {
  /** Weighted score out of 100, or null when nothing could be assessed yet. */
  score: number | null;
  band: 'excellent' | 'good' | 'fair' | 'needs_work' | 'unknown';
  findings: VastuFinding[];
  assessed: number;
}

interface ZoneRule {
  id: string;
  title: string;
  types: RoomType[];
  good: CompassZone[];
  okay: CompassZone[];
  weight: number;
  advice: string;
}

/**
 * Placement rules follow commonly published Vastu Shastra guidance. Schools differ on details, so
 * every rule can be excluded from the score in project settings.
 */
const ZONE_RULES: ZoneRule[] = [
  {
    id: 'kitchen',
    title: 'Kitchen placement',
    types: ['kitchen'],
    good: ['SE'],
    okay: ['NW', 'E', 'S'],
    weight: 10,
    advice: 'Prefer the south-east (Agni) corner; north-west is the accepted alternative.',
  },
  {
    id: 'master_bedroom',
    title: 'Master bedroom placement',
    types: ['master_bedroom'],
    good: ['SW'],
    okay: ['S', 'W'],
    weight: 10,
    advice: 'Prefer the south-west corner for the head of the household.',
  },
  {
    id: 'pooja',
    title: 'Pooja room placement',
    types: ['pooja'],
    good: ['NE'],
    okay: ['E', 'N'],
    weight: 10,
    advice: 'Prefer the north-east (Ishan) corner; east or north are acceptable.',
  },
  {
    id: 'toilet',
    title: 'Toilet and bathroom placement',
    types: ['toilet', 'bathroom'],
    good: ['NW', 'W'],
    okay: ['S', 'SE', 'N', 'E'],
    weight: 9,
    advice: 'Keep toilets out of the north-east, south-west and centre; north-west or west is preferred.',
  },
  {
    id: 'staircase',
    title: 'Staircase placement',
    types: ['staircase'],
    good: ['S', 'W', 'SW'],
    okay: ['SE', 'NW'],
    weight: 6,
    advice: 'Prefer the south, west or south-west; avoid the north-east and centre.',
  },
  {
    id: 'living',
    title: 'Living room placement',
    types: ['living', 'drawing'],
    good: ['N', 'E', 'NE'],
    okay: ['NW', 'C'],
    weight: 5,
    advice: 'Prefer the north, east or north-east for living spaces.',
  },
  {
    id: 'dining',
    title: 'Dining placement',
    types: ['dining'],
    good: ['W', 'E'],
    okay: ['S', 'N', 'C', 'SE'],
    weight: 3,
    advice: 'West or east of the kitchen suits dining.',
  },
  {
    id: 'bedroom',
    title: 'Other bedroom placement',
    types: ['bedroom'],
    good: ['S', 'W', 'SW'],
    okay: ['NW', 'N'],
    weight: 3,
    advice: 'South or west suits bedrooms; avoid the south-east.',
  },
  {
    id: 'kids',
    title: "Children's room placement",
    types: ['kids_room'],
    good: ['W', 'NW'],
    okay: ['E', 'N', 'S'],
    weight: 2,
    advice: 'West or north-west suits children.',
  },
  {
    id: 'guest',
    title: 'Guest room placement',
    types: ['guest_room'],
    good: ['NW'],
    okay: ['N', 'W', 'E'],
    weight: 2,
    advice: 'North-west suits guests.',
  },
  {
    id: 'study',
    title: 'Study placement',
    types: ['study'],
    good: ['N', 'E', 'NE'],
    okay: ['W', 'NW'],
    weight: 2,
    advice: 'North, east or north-east suits study.',
  },
  {
    id: 'store',
    title: 'Store room placement',
    types: ['store'],
    good: ['NW', 'SW'],
    okay: ['S', 'W'],
    weight: 2,
    advice: 'North-west or south-west suits storage.',
  },
  {
    id: 'balcony',
    title: 'Balcony and verandah placement',
    types: ['balcony', 'verandah'],
    good: ['N', 'E', 'NE'],
    okay: ['NW', 'SE'],
    weight: 3,
    advice: 'Open space belongs on the north and east sides.',
  },
  {
    id: 'garage',
    title: 'Garage placement',
    types: ['garage', 'porch'],
    good: ['NW', 'SE'],
    okay: ['N', 'E'],
    weight: 2,
    advice: 'North-west or south-east suits parking.',
  },
  {
    id: 'utility',
    title: 'Utility and wash area placement',
    types: ['utility', 'wash_area'],
    good: ['NW', 'SE'],
    okay: ['W', 'S'],
    weight: 1,
    advice: 'North-west or south-east suits wash areas.',
  },
];

/** A sentence with named {slots}: filled in for English, kept apart for translating. */
function said(template: string, vars: Record<string, string> = {}) {
  let detail = template;
  for (const [name, value] of Object.entries(vars)) detail = detail.split(`{${name}}`).join(value);
  return { detail, template, vars };
}

function assessZone(rule: ZoneRule, room: Room, floor: Floor): VastuFinding {
  const status: VastuStatus = rule.good.includes(room.zone)
    ? 'good'
    : rule.okay.includes(room.zone)
      ? 'okay'
      : 'poor';
  return {
    ruleId: rule.id,
    title: rule.title,
    status,
    weight: rule.weight,
    floor: floor.name,
    ...said('{room} is in the {zone} zone.', { room: room.name, zone: room.zone }),
    suggestion: status === 'good' ? '' : rule.advice,
  };
}

/** The compass direction an opening faces when seen from inside the house, looking out. */
export function openingFacing(opening: Opening, wall: Wall, floor: Floor, north: number): CompassZone {
  const { point, dir } = pointOnWall(wall, opening.position);
  const n = leftNormal(dir);
  const probe = 200;
  const left: Vec2 = { x: point.x + n.x * probe, y: point.y + n.y * probe };
  const right: Vec2 = { x: point.x - n.x * probe, y: point.y - n.y * probe };
  const inRoom = (p: Vec2) => floor.rooms.some((r) => pointInPolygon(p, r.centerline));
  const leftIn = inRoom(left);
  const rightIn = inRoom(right);
  // Outward is away from the rooms. For an inner wall, fall back to the left normal.
  const out = leftIn && !rightIn ? { x: -n.x, y: -n.y } : n;
  return zoneFromBearing(bearingOf(out.x, out.y, north));
}

function single(
  ruleId: string,
  title: string,
  weight: number,
  status: VastuStatus,
  sentence: ReturnType<typeof said>,
  suggestion = '',
): VastuFinding {
  return { ruleId, title, weight, status, ...sentence, suggestion };
}

function entranceRule(p: Project): VastuFinding {
  const title = 'Main entrance direction';
  for (const floor of p.floors) {
    const main = floor.openings.find((o) => o.isMainEntrance);
    const wall = main && floor.walls.find((w) => w.id === main.wallId);
    if (main && wall) {
      const facing = openingFacing(main, wall, floor, p.settings.northAngleDeg);
      const status: VastuStatus = ['N', 'E', 'NE'].includes(facing)
        ? 'good'
        : ['W', 'NW', 'SE'].includes(facing)
          ? 'okay'
          : 'poor';
      return {
        ...single(
          'entrance',
          title,
          12,
          status,
          said('The main door faces {zone}.', { zone: facing }),
          status === 'good' ? '' : 'North, east or north-east entrances are preferred.',
        ),
        floor: floor.name,
      };
    }
  }
  return single(
    'entrance',
    title,
    12,
    'na',
    said('No door is marked as the main entrance.'),
    'Select the front door and turn on "Main entrance".',
  );
}

function brahmasthanRule(p: Project): VastuFinding[] {
  const out: VastuFinding[] = [];
  const blocked: RoomType[] = ['toilet', 'bathroom', 'kitchen', 'staircase'];
  const floor = p.floors.find((f) => f.levelIndex === 0) ?? p.floors[0];
  if (!floor?.rooms.length) return out;
  const bad = floor.rooms.filter((r) => r.zone === 'C' && blocked.includes(r.type));
  const north = p.settings.northAngleDeg;
  const extents = floorExtents(floor.walls);
  const pillars = floor.pillars.filter(
    (c) => compassZone({ x: c.transform.x, y: c.transform.y }, extents, north) === 'C',
  );
  out.push({
    ...single(
      'brahmasthan',
      'Centre of the house (Brahmasthan)',
      8,
      bad.length ? 'poor' : pillars.length ? 'okay' : 'good',
      bad.length
        ? said('{rooms} is in the centre zone.', { rooms: bad.map((r) => r.name).join(', ') })
        : pillars.length
          ? said('{n} pillar(s) stand in the centre zone.', { n: String(pillars.length) })
          : said('The centre zone is free of toilets, kitchens, stairs and pillars.'),
      bad.length
        ? 'Keep the centre open or use it as a living or circulation space.'
        : pillars.length
          ? 'Move pillars out of the centre if the structure allows; check with your engineer first.'
          : '',
    ),
    floor: floor.name,
  });
  return out;
}

function plotShapeRule(p: Project): VastuFinding {
  const title = 'Plot shape';
  const raw = p.site.plot;
  if (raw.length < 3) {
    const r = p.site.plotLength / Math.max(1, p.site.plotWidth);
    const ratio = Math.max(r, 1 / r);
    return single(
      'plot_shape',
      title,
      4,
      ratio <= 2 ? 'good' : 'okay',
      said('Rectangular plot with a {ratio} : 1 proportion.', { ratio: ratio.toFixed(2) }),
      ratio <= 2 ? '' : 'Proportions up to 2 : 1 are preferred.',
    );
  }
  const poly = simplifyPolygon(raw, 5);
  const box = bbox(poly);
  const fill = polygonArea(poly) / Math.max(1, (box.maxX - box.minX) * (box.maxY - box.minY));
  const regular = poly.length === 4 && fill > 0.97;
  return single(
    'plot_shape',
    title,
    4,
    regular ? 'good' : fill > 0.85 ? 'okay' : 'poor',
    said('Plot has {n} sides and fills {pct}% of its bounding rectangle.', {
      n: String(poly.length),
      pct: String(Math.round(fill * 100)),
    }),
    regular
      ? ''
      : 'Square or rectangular plots are preferred; regularise cuts with a compound wall or landscaping.',
  );
}

function sideRule(
  id: string,
  title: string,
  weight: number,
  side: Side | 'none',
  good: Side[],
  okay: Side[],
  what: string,
  advice: string,
): VastuFinding {
  if (side === 'none')
    return single(
      id,
      title,
      weight,
      'na',
      said('{what} is not set in Site and roof.', { what }),
      'Set this in Site and roof to include it in the score.',
    );
  const status: VastuStatus = good.includes(side) ? 'good' : okay.includes(side) ? 'okay' : 'poor';
  return single(
    id,
    title,
    weight,
    status,
    said('{what}: {side}.', { what, side }),
    status === 'good' ? '' : advice,
  );
}

const POINT_NAMES: Record<string, string> = {
  borewell: 'Borewell',
  sump: 'Underground sump',
  overhead_tank: 'Overhead tank',
  septic: 'Septic tank',
};

function pointZoneRule(
  p: Project,
  id: string,
  title: string,
  weight: number,
  kinds: string[],
  good: CompassZone[],
  okay: CompassZone[],
  advice: string,
): VastuFinding[] {
  const out: VastuFinding[] = [];
  const north = p.settings.northAngleDeg;
  for (const floor of p.floors) {
    const extents = floorExtents(floor.walls);
    for (const pt of floor.plumbing) {
      if (!kinds.includes(pt.kind)) continue;
      const zone = compassZone(pt.at, extents, north);
      const status: VastuStatus = good.includes(zone) ? 'good' : okay.includes(zone) ? 'okay' : 'poor';
      out.push({
        ...single(
          id,
          title,
          weight,
          status,
          said('{point} is in the {zone} zone.', { point: POINT_NAMES[pt.kind] ?? pt.kind, zone }),
          status === 'good' ? '' : advice,
        ),
        floor: floor.name,
      });
    }
  }
  return out;
}

function windowBalance(p: Project): VastuFinding {
  const counts = { good: 0, poor: 0 };
  const north = p.settings.northAngleDeg;
  for (const floor of p.floors) {
    for (const o of floor.openings) {
      if (o.kind !== 'window') continue;
      const wall = floor.walls.find((w) => w.id === o.wallId);
      if (!wall || wall.type !== 'outer') continue;
      const facing = openingFacing(o, wall, floor, north);
      if (['N', 'E', 'NE', 'NW', 'SE'].includes(facing)) counts.good += o.width;
      else counts.poor += o.width;
    }
  }
  const total = counts.good + counts.poor;
  if (!total) return single('windows', 'Windows on north and east', 3, 'na', said('No outer windows yet.'));
  const share = counts.good / total;
  return single(
    'windows',
    'Windows on north and east',
    3,
    share >= 0.6 ? 'good' : share >= 0.4 ? 'okay' : 'poor',
    said('{pct}% of window width faces north or east.', { pct: String(Math.round(share * 100)) }),
    share >= 0.6 ? '' : 'Add or enlarge windows on the north and east sides for morning light.',
  );
}

function objectRules(p: Project): VastuFinding[] {
  const out: VastuFinding[] = [];
  const north = p.settings.northAngleDeg;
  for (const floor of p.floors) {
    for (const item of floor.objects) {
      if (item.catalogId.startsWith('bed_')) {
        // Beds are modelled with the headboard towards local -y.
        const r = (item.transform.rotation * Math.PI) / 180;
        const head = { x: Math.sin(r), y: -Math.cos(r) };
        const towards = zoneFromBearing(bearingOf(head.x, head.y, north));
        const status: VastuStatus = ['S', 'SE', 'SW'].includes(towards)
          ? 'good'
          : ['E', 'W'].includes(towards)
            ? 'okay'
            : 'poor';
        out.push({
          ...single(
            'bed_head',
            'Bed head direction',
            2,
            status,
            said('{name}: head points {zone}.', { name: item.name, zone: towards }),
            status === 'good'
              ? ''
              : 'Sleep with the head to the south (east is the accepted alternative); avoid north.',
          ),
          floor: floor.name,
        });
      }
      if (item.catalogId === 'stove') {
        const room = floor.rooms.find((rm) =>
          pointInPolygon({ x: item.transform.x, y: item.transform.y }, rm.polygon),
        );
        if (!room) continue;
        const zone = compassZone({ x: item.transform.x, y: item.transform.y }, room.polygon, north);
        const status: VastuStatus =
          zone === 'SE' ? 'good' : ['E', 'S', 'NW'].includes(zone) ? 'okay' : 'poor';
        out.push({
          ...single(
            'stove',
            'Stove position within the kitchen',
            3,
            status,
            said('Stove is in the {zone} part of {room}.', { zone, room: room.name }),
            status === 'good'
              ? ''
              : 'Place the stove towards the south-east of the kitchen so the cook can face east.',
          ),
          floor: floor.name,
        });
      }
    }
  }
  return out;
}

function plantRules(p: Project): VastuFinding[] {
  const out: VastuFinding[] = [];
  const north = p.settings.northAngleDeg;
  for (const floor of p.floors) {
    const extents = floorExtents(floor.walls);
    for (const plant of floor.plants) {
      const zone = compassZone({ x: plant.transform.x, y: plant.transform.y }, extents, north);
      if (plant.catalogId === 'tulsi') {
        const status: VastuStatus = ['NE', 'N', 'E'].includes(zone) ? 'good' : 'okay';
        out.push({
          ...single(
            'tulsi',
            'Tulsi plant',
            1,
            status,
            said('Tulsi is in the {zone} zone.', { zone }),
            status === 'good' ? '' : 'North-east, north or east suits tulsi.',
          ),
          floor: floor.name,
        });
      } else if (plant.height >= 3000) {
        const status: VastuStatus = ['S', 'W', 'SW'].includes(zone)
          ? 'good'
          : ['SE', 'NW'].includes(zone)
            ? 'okay'
            : 'poor';
        out.push({
          ...single(
            'tall_tree',
            'Tall trees',
            2,
            status,
            said('{name} is in the {zone} zone.', { name: plant.name, zone }),
            status === 'good'
              ? ''
              : 'Tall trees belong on the south and west sides, away from the north-east.',
          ),
          floor: floor.name,
        });
      }
    }
  }
  return out;
}

function northEastCutRule(p: Project): VastuFinding {
  const floor = p.floors.find((f) => f.levelIndex === 0) ?? p.floors[0];
  const extents = floor ? floorExtents(floor.walls) : [];
  if (!floor?.rooms.length)
    return single('ne_corner', 'North-east corner', 4, 'na', said('Draw rooms first.'));
  const north = p.settings.northAngleDeg;
  const inNE = floor.rooms.filter((r) => compassZone(r.centroid, extents, north) === 'NE');
  const areaNE = inNE.reduce((s, r) => s + r.area, 0);
  const total = floor.rooms.reduce((s, r) => s + r.area, 0);
  const box = bbox(extents);
  const clockwiseArea = Math.abs(
    signedArea([
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ]),
  );
  const expected = (clockwiseArea / 1e6 / 9) * 0.4;
  const status: VastuStatus = areaNE >= expected ? 'good' : areaNE > 0 ? 'okay' : 'poor';
  return {
    ...single(
      'ne_corner',
      'North-east corner',
      4,
      status,
      said('{a} sq m of {b} sq m is in the north-east zone.', { a: areaNE.toFixed(1), b: total.toFixed(1) }),
      status === 'good'
        ? ''
        : 'A cut or missing north-east corner is considered unfavourable; extend or keep that corner regular.',
    ),
    floor: floor.name,
  };
}

/** Runs every rule against a project. Excluded rules still appear, but do not count towards the score. */
export function assessVastu(p: Project): VastuReport {
  const findings: VastuFinding[] = [];
  findings.push(entranceRule(p));
  for (const floor of p.floors) {
    for (const room of floor.rooms) {
      const rule = ZONE_RULES.find((r) => r.types.includes(room.type));
      if (rule) findings.push(assessZone(rule, room, floor));
    }
  }
  findings.push(...brahmasthanRule(p));
  findings.push(plotShapeRule(p));
  findings.push(
    sideRule(
      'road_side',
      'Road side',
      3,
      p.site.roadSide,
      ['N', 'E'],
      ['W'],
      'Road side',
      'North or east-facing roads are preferred. Compensate with the entrance position.',
    ),
  );
  findings.push(
    sideRule(
      'slope',
      'Slope of the plot',
      3,
      p.site.slopeDirection,
      ['N', 'E'],
      ['W'],
      'Slope falls towards',
      'Land should fall towards the north or east; regrade if practical.',
    ),
  );
  findings.push(
    ...pointZoneRule(
      p,
      'water_source',
      'Borewell and underground sump',
      4,
      ['borewell', 'sump'],
      ['NE', 'N', 'E'],
      ['NW'],
      'Underground water belongs in the north-east.',
    ),
  );
  findings.push(
    ...pointZoneRule(
      p,
      'overhead_tank',
      'Overhead water tank',
      3,
      ['overhead_tank'],
      ['SW', 'W', 'S'],
      ['NW'],
      'Overhead tanks belong in the south-west or west.',
    ),
  );
  findings.push(
    ...pointZoneRule(
      p,
      'septic',
      'Septic tank',
      3,
      ['septic'],
      ['NW', 'W'],
      ['SE', 'N'],
      'Septic tanks belong in the north-west; avoid the north-east and south-west.',
    ),
  );
  findings.push(windowBalance(p));
  findings.push(northEastCutRule(p));
  findings.push(...objectRules(p));
  findings.push(...plantRules(p));

  const ignored = new Set(p.vastu.ignoredRules);
  const value: Record<VastuStatus, number> = { good: 1, okay: 0.6, poor: 0, na: 0 };
  let earned = 0;
  let possible = 0;
  let assessed = 0;
  for (const f of findings) {
    if (f.status === 'na' || ignored.has(f.ruleId)) continue;
    earned += value[f.status] * f.weight;
    possible += f.weight;
    assessed += 1;
  }
  const score = possible ? Math.round((earned / possible) * 100) : null;
  const band =
    score === null
      ? 'unknown'
      : score >= 85
        ? 'excellent'
        : score >= 70
          ? 'good'
          : score >= 50
            ? 'fair'
            : 'needs_work';
  const order: Record<VastuStatus, number> = { poor: 0, okay: 1, na: 2, good: 3 };
  findings.sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight);
  return { score, band, findings, assessed };
}
