import { netArea, polygonArea, unionPolygons } from '../core/geometry/polygon';
import { buildWallGraph, wallLength } from '../core/geometry/wallGraph';
import type { Floor, Project, Wall, WallMaterial } from '../core/model/types';
import { stairLayout } from '../catalog/stairs';
import { QUALITY_FACTOR, RATE_SPREAD, rateDefByKey } from './rates';

/** Every money, quantity and time figure carries three values. A bare number is never shown. */
export interface Range {
  min: number;
  likely: number;
  max: number;
}

export const range = (likely: number, minFactor: number, maxFactor: number): Range => ({
  min: likely * minFactor,
  likely,
  max: likely * maxFactor,
});

export const addRanges = (a: Range, b: Range): Range => ({
  min: a.min + b.min,
  likely: a.likely + b.likely,
  max: a.max + b.max,
});
const ZERO: Range = { min: 0, likely: 0, max: 0 };

export interface LineItem {
  id: string;
  stage: string;
  name: string;
  unit: string;
  quantity: Range;
  /** Cost of the item, using the matching ends of the quantity and rate ranges. */
  cost: Range;
  /** Rate key this line prices against. */
  rateKey: string;
  assumption: string;
}

export interface MaterialTotal {
  key: string;
  name: string;
  unit: string;
  quantity: Range;
}

export interface ScheduleTask {
  id: string;
  name: string;
  days: Range;
  note: string;
}

export interface CuringTask {
  element: string;
  /** Minimum wet-curing days. */
  cureDays: Range;
  /** Days before formwork or props may be struck, where applicable. */
  stripDays?: Range;
  note: string;
}

export interface EstimateResult {
  builtUpSqm: number;
  carpetSqm: number;
  lines: LineItem[];
  stages: { stage: string; cost: Range }[];
  materials: MaterialTotal[];
  contingency: Range;
  total: Range;
  perSqft: Range;
  schedule: ScheduleTask[];
  totalDays: Range;
  curing: CuringTask[];
  assumptions: string[];
  /** Rates still at the app's starting value, which the user should replace. */
  defaultRatesUsed: string[];
  isEmpty: boolean;
}

/** Bricks or blocks per cubic metre of masonry including mortar joints, and the volume method. */
const UNITS_PER_CUM: Partial<Record<WallMaterial, { units: number; rateKey: string; name: string }>> = {
  red_brick: { units: 500, rateKey: 'red_brick', name: 'Red bricks' },
  fly_ash_brick: { units: 500, rateKey: 'fly_ash_brick', name: 'Fly ash bricks' },
  mud_brick: { units: 400, rateKey: 'mud_brick', name: 'Mud bricks' },
  aac_block: { units: 41.7, rateKey: 'aac_block', name: 'AAC blocks' },
  concrete_block: { units: 62.5, rateKey: 'concrete_block', name: 'Concrete blocks' },
};

const STRUCTURE_SPACING_SQM = 12;
const SQFT_PER_SQM = 10.7639;

class Builder {
  lines: LineItem[] = [];
  materials = new Map<string, MaterialTotal>();
  usedDefaults = new Set<string>();
  constructor(private readonly p: Project) {}

  rate(key: string, factor = 1): Range {
    const typed = this.p.estimate.rates[key];
    const def = rateDefByKey.get(key);
    if (typed === undefined && def) this.usedDefaults.add(def.label);
    const value = (typed ?? def?.value ?? 0) * factor;
    return range(value, RATE_SPREAD.min, RATE_SPREAD.max);
  }

  line(
    id: string,
    stage: string,
    name: string,
    unit: string,
    quantity: Range,
    rateKey: string,
    assumption: string,
    factor = 1,
  ): void {
    if (quantity.likely <= 0) return;
    const r = this.rate(rateKey, factor);
    this.lines.push({
      id,
      stage,
      name,
      unit,
      quantity,
      rateKey,
      assumption,
      cost: { min: quantity.min * r.min, likely: quantity.likely * r.likely, max: quantity.max * r.max },
    });
  }

  material(key: string, name: string, unit: string, q: Range): void {
    if (q.likely <= 0) return;
    const m = this.materials.get(key);
    if (m) m.quantity = addRanges(m.quantity, q);
    else this.materials.set(key, { key, name, unit, quantity: q });
  }
}

/** Net masonry measured from the junction footprint, so corners are not counted twice. */
function wallMeasures(floor: Floor) {
  const graph = buildWallGraph(floor.walls);
  const footprintByWall = new Map<string, number>();
  for (const e of graph.edges)
    footprintByWall.set(e.wallId, (footprintByWall.get(e.wallId) ?? 0) + polygonArea(e.polygon));
  return floor.walls.map((wall) => {
    const openings = floor.openings.filter((o) => o.wallId === wall.id);
    const openingFace = openings.reduce((s, o) => s + (o.width * Math.min(o.height, wall.height)) / 1e6, 0);
    const length = wallLength(wall) / 1000;
    const area = (footprintByWall.get(wall.id) ?? 0) / 1e6;
    const faceArea = Math.max(0, (length * wall.height) / 1000 - openingFace);
    const volume = Math.max(0, (area * wall.height) / 1000 - (openingFace * wall.thickness) / 1000);
    return { wall, length, faceArea, volume, openings };
  });
}

/** Built-up footprint: the union of wall footprints and the rooms they enclose. */
function footprintSqm(floor: Floor): number {
  const graph = buildWallGraph(floor.walls.filter((w) => w.type !== 'compound' && w.type !== 'retaining'));
  const polys = [...graph.edges.map((e) => e.polygon), ...floor.rooms.map((r) => r.polygon)];
  try {
    return netArea(unionPolygons(polys)) / 1e6;
  } catch {
    return polys.reduce((s, q) => s + polygonArea(q), 0) / 1e6;
  }
}

const isStructural = (w: Wall) =>
  w.type !== 'compound' && w.type !== 'retaining' && w.type !== 'parapet' && w.type !== 'glass';

/** Works out quantities, costs, materials, schedule and curing for a project. */
export function estimateProject(p: Project): EstimateResult {
  const b = new Builder(p);
  const q = QUALITY_FACTOR[p.estimate.quality];
  const floors = p.floors;
  const ground = floors.find((f) => f.levelIndex === 0) ?? floors[0];
  const built = floors.filter((f) => f.rooms.some((r) => r.type !== 'terrace'));
  const builtUp = built.reduce((s, f) => s + footprintSqm(f), 0);
  const groundArea = ground ? footprintSqm(ground) : 0;
  const carpet = built.reduce((s, f) => s + f.rooms.reduce((a, r) => a + r.area, 0), 0);
  const assumptions: string[] = [
    'Planning estimate from the drawn plan. It is not a structural design or a contractor quote.',
    'Structural members are sized by rule of thumb. A licensed engineer must design footings, columns, beams and slabs for your soil and loads.',
    `Minimum, most likely and maximum combine quantity allowances with a rate spread of ${Math.round((RATE_SPREAD.min - 1) * 100)}% to +${Math.round((RATE_SPREAD.max - 1) * 100)}%.`,
  ];

  // Foundation.
  const drawnPillars = ground?.pillars.length ?? 0;
  const columns = Math.max(drawnPillars, Math.ceil(groundArea / STRUCTURE_SPACING_SQM));
  const storeys = Math.max(1, built.length);
  let excavation = 0;
  let pcc = 0;
  let footingConcrete = 0;
  const basementArea = floors.filter((f) => f.levelIndex < 0).reduce((s, f) => s + footprintSqm(f), 0);
  if (basementArea > 0) {
    excavation += basementArea * 3.3;
    assumptions.push(
      `Basement excavation of about 3.3 m depth over ${basementArea.toFixed(1)} sq m. Shoring and waterproofing depend on the site.`,
    );
  }
  if (groundArea > 0) {
    if (p.estimate.foundation === 'isolated') {
      const pad = 1.2 + 0.2 * storeys;
      excavation += columns * (pad + 0.3) ** 2 * 1.5;
      pcc = columns * pad ** 2 * 0.1;
      footingConcrete = columns * pad ** 2 * 0.35;
      assumptions.push(
        `${columns} isolated footings of about ${pad.toFixed(1)} m square at 1.5 m depth.${drawnPillars ? '' : ' Column count estimated at one per 12 sq m because none were drawn.'}`,
      );
    } else if (p.estimate.foundation === 'strip') {
      const run = (ground?.walls.filter(isStructural).reduce((s, w) => s + wallLength(w), 0) ?? 0) / 1000;
      excavation += run * 1 * 1.2;
      pcc = run * 0.9 * 0.1;
      footingConcrete = run * 0.75 * 0.3;
      assumptions.push(`Strip footings 0.9 m wide under ${run.toFixed(1)} m of walls at 1.2 m depth.`);
    } else {
      excavation += groundArea * 1.15 * 1;
      pcc = groundArea * 1.1 * 0.1;
      footingConcrete = groundArea * 1.1 * 0.3;
      assumptions.push('Raft foundation 300 mm thick at 1 m depth with a 10% projection.');
    }
  }
  b.line(
    'excavation',
    'Foundation',
    'Excavation',
    'cu m',
    range(excavation, 0.9, 1.3),
    'labour_excavation',
    'Includes working space; rock or high water table cost more.',
  );
  const pccRange = range(pcc, 0.95, 1.15);
  const concreteBy = (
    id: string,
    stage: string,
    name: string,
    vol: Range,
    steelKgPerCum: Range,
    formPerCum: number,
    note: string,
  ) => {
    if (vol.likely <= 0) return;
    const cement = { min: vol.min * 7.5, likely: vol.likely * 8, max: vol.max * 8.8 };
    const sand = { min: vol.min * 0.4, likely: vol.likely * 0.44, max: vol.max * 0.5 };
    const agg = { min: vol.min * 0.8, likely: vol.likely * 0.86, max: vol.max * 0.95 };
    const steel = {
      min: vol.min * steelKgPerCum.min,
      likely: vol.likely * steelKgPerCum.likely,
      max: vol.max * steelKgPerCum.max,
    };
    b.material('cement', 'Cement', 'bag', cement);
    b.material('sand', 'Sand', 'cu m', sand);
    b.material('aggregate', 'Coarse aggregate', 'cu m', agg);
    b.line(
      `${id}_cement`,
      stage,
      `${name}: cement`,
      'bag',
      cement,
      'cement',
      'M20 nominal mix, about 8 bags per cu m.',
    );
    b.line(`${id}_sand`, stage, `${name}: sand`, 'cu m', sand, 'sand', 'Includes bulking and wastage.');
    b.line(`${id}_agg`, stage, `${name}: aggregate`, 'cu m', agg, 'aggregate', 'Includes wastage.');
    if (steelKgPerCum.likely > 0) {
      b.material('steel', 'Reinforcement steel', 'kg', steel);
      b.line(
        `${id}_steel`,
        stage,
        `${name}: steel`,
        'kg',
        steel,
        'steel',
        `Thumb rule of ${steelKgPerCum.min} to ${steelKgPerCum.max} kg per cu m; the engineer's drawings decide the real figure.`,
      );
      b.line(
        `${id}_bending`,
        stage,
        `${name}: bar bending`,
        'kg',
        steel,
        'labour_steel',
        'Cut, bend and tie.',
      );
    }
    if (formPerCum > 0)
      b.line(
        `${id}_form`,
        stage,
        `${name}: formwork`,
        'sq m',
        range(vol.likely * formPerCum, 0.9, 1.15),
        'formwork',
        'Hire and fixing.',
      );
    b.line(`${id}_labour`, stage, `${name}: labour`, 'cu m', vol, 'labour_rcc', note);
  };
  concreteBy(
    'pcc',
    'Foundation',
    'PCC bed',
    pccRange,
    { min: 0, likely: 0, max: 0 },
    0,
    '100 mm lean concrete below footings.',
  );
  concreteBy(
    'footing',
    'Foundation',
    'Footings',
    range(footingConcrete, 0.92, 1.15),
    { min: 60, likely: 75, max: 95 },
    2,
    'Sized by rule of thumb; soil report decides.',
  );

  // Frame.
  const structuralRun =
    built.reduce((s, f) => s + f.walls.filter(isStructural).reduce((a, w) => a + wallLength(w), 0), 0) / 1000;
  const plinthRun = (ground?.walls.filter(isStructural).reduce((s, w) => s + wallLength(w), 0) ?? 0) / 1000;
  const plinth = plinthRun * 0.23 * 0.38;
  concreteBy(
    'plinth',
    'Foundation',
    'Plinth beams',
    range(plinth, 0.95, 1.15),
    { min: 100, likely: 125, max: 160 },
    6,
    '230 x 380 mm under structural walls.',
  );
  const columnVol = floors.reduce((sum, f) => {
    const drawn = f.pillars.reduce((a, c) => {
      const plan = c.shape === 'round' ? (Math.PI * c.width * c.width) / 4 : c.width * c.depth;
      return a + (plan * c.height) / 1e9;
    }, 0);
    if (drawn > 0 || !f.rooms.length || f.rooms.every((r) => r.type === 'terrace')) return sum + drawn;
    return sum + columns * 0.23 * 0.38 * (f.floorToFloor / 1000);
  }, 0);
  concreteBy(
    'columns',
    'Structure',
    'Columns',
    range(columnVol, 0.95, 1.2),
    { min: 130, likely: 170, max: 220 },
    10,
    'Includes drawn pillars, or 230 x 380 mm columns when none are drawn.',
  );
  concreteBy(
    'beams',
    'Structure',
    'Floor beams',
    range(structuralRun * 0.23 * 0.3, 0.9, 1.2),
    { min: 110, likely: 140, max: 180 },
    8,
    '230 x 300 mm drop under structural walls, below the slab.',
  );
  const slabArea = floors.reduce((sum, f, i) => {
    const below = floors[i - 1];
    return below && f.rooms.length ? sum + footprintSqm(below) : sum;
  }, 0);
  const finalRoof =
    p.roof.type === 'flat' && floors.every((f) => !f.rooms.some((r) => r.type === 'terrace'))
      ? footprintSqm(floors[floors.length - 1])
      : 0;
  const slabThk = (ground?.slabThickness ?? 125) / 1000;
  concreteBy(
    'slab',
    'Structure',
    'Roof and floor slabs',
    range((slabArea + finalRoof) * slabThk, 0.95, 1.12),
    { min: 70, likely: 85, max: 110 },
    1 / slabThk,
    `${Math.round(slabThk * 1000)} mm thick over ${(slabArea + finalRoof).toFixed(1)} sq m.`,
  );
  const extraSlabs = floors.reduce(
    (sum, f) => sum + f.slabs.reduce((a, s) => a + (polygonArea(s.polygon) * s.thickness) / 1e9, 0),
    0,
  );
  concreteBy(
    'extra_slabs',
    'Structure',
    'Porch slabs and sunshades',
    range(extraSlabs, 0.95, 1.12),
    { min: 70, likely: 85, max: 110 },
    8,
    'The slabs you drew, at their own thickness.',
  );
  let flights = 0;
  let railRun = 0;
  for (const f of floors) {
    for (const s of f.stairs) {
      const layout = stairLayout(s);
      const stepArea = layout.steps.reduce((a, st) => a + polygonArea(st.polygon), 0) / 1e6;
      flights += stepArea * 0.25;
      if (s.hasRailing) railRun += (layout.steps.length * s.tread + s.width * 2) / 1000;
    }
  }
  concreteBy(
    'stairs',
    'Structure',
    'Staircase',
    range(flights, 0.9, 1.2),
    { min: 90, likely: 110, max: 140 },
    5,
    'Waist slab and steps, about 250 mm average.',
  );
  b.line(
    'railing',
    'Finishes',
    'Stair railing',
    'rmt',
    range(railRun, 0.95, 1.1),
    'railing',
    'Mild steel or SS, measured along the flights.',
    q,
  );

  // Masonry.
  let plasterArea = 0;
  let exteriorPaint = 0;
  let interiorPaint = 0;
  let dadoArea = 0;
  let masonryVol = 0;
  // Plaster material follows the typed thickness; 12 mm on a face counts as one unit of area.
  let plasterEquivalent = 0;
  let dampProofArea = 0;
  for (const f of floors) {
    for (const m of wallMeasures(f)) {
      if (m.wall.type === 'compound' && !p.estimate.includeCompound) continue;
      const u = UNITS_PER_CUM[m.wall.material];
      const vol = range(m.volume, 0.96, 1.05);
      masonryVol += m.volume;
      if (u) {
        const units = {
          min: vol.min * u.units * 1.03,
          likely: vol.likely * u.units * 1.05,
          max: vol.max * u.units * 1.1,
        };
        b.material(`unit_${m.wall.material}`, u.name, 'each', units);
      } else if (m.wall.material === 'stone') {
        b.line(
          `stone_${m.wall.id}`,
          'Masonry',
          'Stone masonry',
          'cu m',
          vol,
          'stone',
          'Measured from the drawn wall.',
        );
      }
      const faces = m.faceArea * 2;
      const isOuter = m.wall.type === 'outer' || m.wall.type === 'parapet';
      plasterArea += faces;
      plasterEquivalent += (m.faceArea * (m.wall.plasterLeft + m.wall.plasterRight)) / 12;
      if (m.wall.dampProof && f.levelIndex === 0 && isStructural(m.wall))
        dampProofArea += (m.length * m.wall.thickness) / 1000;
      exteriorPaint += isOuter ? m.faceArea : 0;
      interiorPaint += isOuter ? m.faceArea : faces;
      if (m.wall.dadoHeight > 0) dadoArea += (m.length * m.wall.dadoHeight) / 1000;
    }
  }
  for (const mat of b.materials.values()) {
    if (!mat.key.startsWith('unit_')) continue;
    const material = mat.key.slice(5) as WallMaterial;
    const u = UNITS_PER_CUM[material]!;
    b.line(
      `units_${material}`,
      'Masonry',
      u.name,
      'each',
      mat.quantity,
      u.rateKey,
      'Includes 3% to 10% breakage and cutting.',
    );
  }
  const mortar = range(masonryVol, 0.96, 1.05);
  const mortarCement = { min: mortar.min * 1.3, likely: mortar.likely * 1.55, max: mortar.max * 1.9 };
  const mortarSand = { min: mortar.min * 0.27, likely: mortar.likely * 0.32, max: mortar.max * 0.38 };
  b.material('cement', 'Cement', 'bag', mortarCement);
  b.material('sand', 'Sand', 'cu m', mortarSand);
  b.line(
    'mortar_cement',
    'Masonry',
    'Mortar: cement',
    'bag',
    mortarCement,
    'cement',
    '1:6 cement mortar; block walls need less.',
  );
  b.line('mortar_sand', 'Masonry', 'Mortar: sand', 'cu m', mortarSand, 'sand', '1:6 cement mortar.');
  b.line(
    'masonry_labour',
    'Masonry',
    'Masonry labour',
    'cu m',
    mortar,
    'labour_masonry',
    'Laying, scaffolding, curing water.',
  );

  // Plaster.
  const plaster = range(plasterArea, 0.97, 1.08);
  const plasterMix = range(plasterEquivalent, 0.97, 1.08);
  const plasterCement = {
    min: plasterMix.min * 0.09,
    likely: plasterMix.likely * 0.11,
    max: plasterMix.max * 0.14,
  };
  const plasterSand = {
    min: plasterMix.min * 0.016,
    likely: plasterMix.likely * 0.019,
    max: plasterMix.max * 0.024,
  };
  b.material('cement', 'Cement', 'bag', plasterCement);
  b.material('sand', 'Sand', 'cu m', plasterSand);
  b.line(
    'plaster_cement',
    'Plaster',
    'Plaster: cement',
    'bag',
    plasterCement,
    'cement',
    'Follows the plaster thickness set on each wall, 1:4 to 1:6.',
  );
  b.line('plaster_sand', 'Plaster', 'Plaster: sand', 'cu m', plasterSand, 'sand', 'Includes wastage.');
  b.line(
    'plaster_labour',
    'Plaster',
    'Plastering labour',
    'sq m',
    plaster,
    'labour_plaster',
    'Both wall faces, net of openings.',
  );

  b.line(
    'damp_proof',
    'Masonry',
    'Damp-proof course',
    'sq m',
    range(dampProofArea, 1, 1.1),
    'waterproofing',
    'At plinth level, under ground floor walls marked for it.',
  );

  // Floors, roof, finishes.
  let dryFloor = 0;
  let wetFloor = 0;
  let ceilingArea = 0;
  let falseCeiling = 0;
  let terraceArea = 0;
  for (const f of floors) {
    for (const r of f.rooms) {
      if (r.type === 'terrace' || r.floorFinish === 'cement' || r.floorFinish === 'grass') {
        terraceArea += r.type === 'terrace' ? r.area : 0;
        continue;
      }
      const wet = ['toilet', 'bathroom', 'wash_area'].includes(r.type);
      if (wet) {
        wetFloor += r.area;
        dadoArea += (r.perimeter / 1000) * 2.1;
      } else {
        dryFloor += r.area;
      }
      ceilingArea += r.area;
      if (r.ceilingType !== 'plain') falseCeiling += r.area;
    }
  }
  b.line(
    'floor_tile',
    'Finishes',
    'Floor tiles',
    'sq m',
    range(dryFloor * 1.07, 0.96, 1.05),
    'tile',
    'Includes 3% to 12% cutting wastage.',
    q,
  );
  b.line(
    'floor_wet',
    'Finishes',
    'Bathroom floor tiles',
    'sq m',
    range(wetFloor * 1.1, 0.955, 1.045),
    'tile_wet',
    'Includes cutting wastage.',
    q,
  );
  b.line(
    'dado',
    'Finishes',
    'Wall tiles and dado',
    'sq m',
    range(dadoArea * 1.05, 0.95, 1.07),
    'tile_wet',
    'Bathrooms tiled to 2.1 m, plus any dado you drew.',
    q,
  );
  b.line(
    'tile_labour',
    'Finishes',
    'Tiling labour',
    'sq m',
    range(dryFloor + wetFloor + dadoArea, 0.97, 1.08),
    'labour_tile',
    'Laying with adhesive or mortar.',
  );
  const paintInside = range(interiorPaint + ceilingArea, 0.95, 1.1);
  b.line(
    'paint_int',
    'Finishes',
    'Interior paint',
    'sq m',
    paintInside,
    'paint_interior',
    'Walls and ceilings, putty, primer and two coats.',
    q,
  );
  b.line(
    'paint_int_labour',
    'Finishes',
    'Interior painting labour',
    'sq m',
    paintInside,
    'labour_paint',
    'Walls and ceilings.',
  );
  b.line(
    'paint_ext',
    'Finishes',
    'Exterior paint',
    'sq m',
    range(exteriorPaint, 0.95, 1.12),
    'paint_exterior',
    'Weatherproof, two coats.',
    q,
  );
  b.line(
    'paint_ext_labour',
    'Finishes',
    'Exterior painting labour',
    'sq m',
    range(exteriorPaint, 0.95, 1.12),
    'labour_paint',
    'Includes scaffolding moves.',
  );
  const roofFootprint = floors.length ? footprintSqm(floors[floors.length - 1]) : 0;
  b.line(
    'waterproofing',
    'Finishes',
    'Waterproofing',
    'sq m',
    range(terraceArea + (p.roof.type === 'flat' ? roofFootprint * 0.2 : 0) + wetFloor, 1, 1.15),
    'waterproofing',
    'Terrace, bathrooms and sunken slabs.',
  );
  if (p.roof.type !== 'flat') {
    const hyp = Math.hypot(Math.sqrt(Math.max(roofFootprint, 1)) / 2, p.roof.rise / 1000);
    const slopeFactor = hyp / (Math.sqrt(Math.max(roofFootprint, 1)) / 2);
    b.line(
      'roof_cover',
      'Finishes',
      'Sloped roof covering',
      'sq m',
      range(roofFootprint * slopeFactor * 1.15, 0.97, 1.1),
      'roof_covering',
      'Sloped area including overhangs.',
      q,
    );
  }

  // Openings.
  let doorArea = 0;
  let windowArea = 0;
  let grillArea = 0;
  let overrideTotal = 0;
  for (const f of floors) {
    for (const o of f.openings) {
      const area = (o.width * o.height) / 1e6;
      if (o.costOverride !== undefined) overrideTotal += o.costOverride;
      else if (o.kind === 'door') doorArea += o.shutterMaterial === 'none' ? 0 : area;
      else windowArea += area;
      if (o.grill) grillArea += area;
    }
  }
  b.line(
    'doors',
    'Doors and windows',
    'Doors with frames',
    'sq m',
    range(doorArea, 1, 1.05),
    'door',
    'Priced by opening area.',
    q,
  );
  b.line(
    'windows',
    'Doors and windows',
    'Windows with frames and glass',
    'sq m',
    range(windowArea, 1, 1.05),
    'window',
    'Priced by opening area.',
    q,
  );
  b.line(
    'grills',
    'Doors and windows',
    'Window grills',
    'sq m',
    range(grillArea, 1, 1.05),
    'grill',
    'Only where switched on.',
    q,
  );
  if (overrideTotal > 0) {
    b.lines.push({
      id: 'opening_overrides',
      stage: 'Doors and windows',
      name: 'Doors and windows with your own prices',
      unit: 'lump sum',
      quantity: range(1, 1, 1),
      cost: range(overrideTotal, 1, 1),
      rateKey: 'door',
      assumption: 'Exactly the prices you typed on those openings.',
    });
  }

  // Services.
  const drawnElectrical = floors.reduce((s, f) => s + f.electrical.length, 0);
  const estElectrical = Math.round(carpet * 0.45);
  const elecCount = Math.max(drawnElectrical, estElectrical);
  b.line(
    'electrical',
    'Services',
    'Electrical points',
    'point',
    range(elecCount, 0.9, 1.25),
    'electrical',
    drawnElectrical >= estElectrical
      ? 'Counted from the points you drew.'
      : 'About one point per 2.2 sq m because few were drawn. Includes wire, conduit and switches.',
    q,
  );
  const wetRooms = floors.reduce(
    (s, f) =>
      s +
      f.rooms.filter((r) => ['toilet', 'bathroom', 'kitchen', 'wash_area', 'utility'].includes(r.type))
        .length,
    0,
  );
  const drawnPlumbing = floors.reduce((s, f) => s + f.plumbing.length, 0);
  const estPlumbing = wetRooms * 4;
  b.line(
    'plumbing',
    'Services',
    'Plumbing and sanitary points',
    'point',
    range(Math.max(drawnPlumbing, estPlumbing), 0.9, 1.25),
    'plumbing',
    'About 4 points per wet room, including fittings.',
    q,
  );

  // Optional scope.
  // Drawn compound walls are already measured as masonry; only an undrawn one is priced by length.
  const compoundDrawn = floors.some((f) => f.walls.some((w) => w.type === 'compound'));
  if (p.estimate.includeCompound && !compoundDrawn) {
    const plot = p.site.plot;
    const run =
      plot.length >= 3
        ? plot.reduce(
            (s, a, i) =>
              s + Math.hypot(plot[(i + 1) % plot.length].x - a.x, plot[(i + 1) % plot.length].y - a.y),
            0,
          ) / 1000
        : (2 * (p.site.plotWidth + p.site.plotLength)) / 1000;
    b.line(
      'compound',
      'Site',
      'Compound wall',
      'rmt',
      range(run, 1, 1.05),
      'compound_wall',
      'All-in rate around the plot boundary.',
    );
  }
  if (p.estimate.includeInteriors) {
    const kitchens = floors.flatMap((f) => f.rooms.filter((r) => r.type === 'kitchen'));
    const counterRun = kitchens.reduce((s, r) => s + (r.perimeter / 1000) * 0.45, 0);
    b.line(
      'modular_kitchen',
      'Interiors',
      'Modular kitchen',
      'rmt',
      range(counterRun, 0.85, 1.25),
      'modular_kitchen',
      'About 45% of the kitchen perimeter.',
      q,
    );
    const beds = floors.flatMap((f) =>
      f.rooms.filter((r) => ['master_bedroom', 'bedroom', 'kids_room', 'guest_room'].includes(r.type)),
    );
    b.line(
      'wardrobes',
      'Interiors',
      'Fitted wardrobes',
      'sq m',
      range(beds.length * 4, 0.75, 1.3),
      'wardrobe',
      'About 4 sq m of front per bedroom.',
      q,
    );
    b.line(
      'false_ceiling',
      'Interiors',
      'False ceiling',
      'sq m',
      range(falseCeiling || carpet * 0.3, 0.9, 1.15),
      'false_ceiling',
      falseCeiling ? 'Rooms you marked with a false ceiling.' : 'About 30% of carpet area.',
      q,
    );
  }

  // Totals.
  const stagesMap = new Map<string, Range>();
  for (const l of b.lines) stagesMap.set(l.stage, addRanges(stagesMap.get(l.stage) ?? ZERO, l.cost));
  const subTotal = b.lines.reduce((s, l) => addRanges(s, l.cost), ZERO);
  const c = p.estimate.contingencyPercent / 100;
  const contingency: Range = {
    min: subTotal.min * c * 0.5,
    likely: subTotal.likely * c,
    max: subTotal.max * c * 1.5,
  };
  const total = addRanges(subTotal, contingency);
  const sqft = builtUp * SQFT_PER_SQM;
  const perSqft: Range =
    sqft > 0 ? { min: total.min / sqft, likely: total.likely / sqft, max: total.max / sqft } : ZERO;

  // Schedule.
  const crew = Math.max(1, p.estimate.crewSize);
  const crewFactor = 8 / crew;
  const concreteTotal = footingConcrete + plinth + columnVol + (slabArea + finalRoof) * slabThk + flights;
  const curingDays = p.estimate.cementType === 'OPC' ? 7 : 10;
  const task = (
    id: string,
    name: string,
    likely: number,
    note: string,
    minF = 0.8,
    maxF = 1.4,
  ): ScheduleTask => ({
    id,
    name,
    days: range(Math.max(1, Math.ceil(likely)), minF, maxF),
    note,
  });
  const upper = Math.max(0, built.length - 1);
  const schedule: ScheduleTask[] = [];
  if (groundArea > 0) {
    schedule.push(task('marking', 'Site clearing and marking', 2, 'Survey, levels, line-out.', 1, 1.5));
    schedule.push(
      task(
        'foundation',
        'Excavation and foundation',
        (excavation / 15 + footingConcrete / 3) * crewFactor + 3,
        'Depends on soil and water table.',
      ),
    );
    schedule.push(
      task(
        'plinth',
        'Plinth beam and filling',
        (plinth / 2) * crewFactor + 4,
        'Includes backfilling and compaction.',
      ),
    );
    schedule.push(
      task(
        'frame',
        'Columns, beams and slabs',
        storeys * 12 * crewFactor + (slabArea + finalRoof) / 12 + upper * 4,
        `Includes about ${curingDays} days before work continues on each lift.`,
      ),
    );
    schedule.push(
      task(
        'masonry',
        'Masonry',
        (masonryVol / 4.5) * crewFactor + 2,
        'About 4.5 cu m a day for an 8-person crew.',
      ),
    );
    schedule.push(
      task(
        'services_rough',
        'Electrical and plumbing rough-in',
        5 + built.length * 4,
        'Concealed conduits and pipes before plaster.',
        0.8,
        1.3,
      ),
    );
    schedule.push(
      task(
        'plaster',
        'Plastering and curing',
        (plasterArea / 60) * crewFactor + curingDays,
        `${curingDays} days of curing after the last coat.`,
      ),
    );
    schedule.push(
      task(
        'flooring',
        'Flooring and wall tiles',
        ((dryFloor + wetFloor + dadoArea) / 22) * crewFactor + 2,
        'About 22 sq m a day.',
      ),
    );
    schedule.push(
      task(
        'joinery',
        'Doors and windows',
        Math.max(3, floors.reduce((s, f) => s + f.openings.length, 0) / 3),
        'Fixing frames and shutters.',
        0.8,
        1.5,
      ),
    );
    schedule.push(
      task(
        'painting',
        'Painting',
        ((interiorPaint + ceilingArea + exteriorPaint) / 70) * crewFactor + 3,
        'Putty, primer and two coats.',
      ),
    );
    schedule.push(
      task(
        'finishing',
        'Final fittings and handover',
        7 + built.length * 2,
        'Sanitary, electrical fixtures, snag list.',
        0.8,
        1.6,
      ),
    );
    if (p.estimate.includeInteriors)
      schedule.push(
        task(
          'interiors',
          'Interiors',
          20 + carpet / 10,
          'Modular kitchen, wardrobes and false ceilings.',
          0.8,
          1.6,
        ),
      );
  }
  const totalDays = schedule.reduce((s, t) => addRanges(s, t.days), ZERO);

  // Curing and striking times follow IS 456:2000 clauses 13.5 and 11.3.1 as minimums.
  const curing: CuringTask[] =
    concreteTotal > 0 || masonryVol > 0
      ? [
          {
            element: 'Footings and columns',
            cureDays: range(curingDays, 1, 1.4),
            stripDays: range(1, 1, 2),
            note: 'Vertical formwork off after 16 to 48 hours. Keep wet throughout.',
          },
          {
            element: 'Slabs, span up to 4.5 m',
            cureDays: range(curingDays, 1, 1.4),
            stripDays: range(7, 1, 1.5),
            note: 'Soffit sheeting 3 days; props stay for 7 days. Pond the slab with water.',
          },
          {
            element: 'Slabs, span over 4.5 m',
            cureDays: range(curingDays, 1, 1.4),
            stripDays: range(14, 1, 1.25),
            note: 'Props stay for 14 days.',
          },
          {
            element: 'Beams, span up to 6 m',
            cureDays: range(curingDays, 1, 1.4),
            stripDays: range(14, 1, 1.25),
            note: 'Soffit sheeting 7 days; props stay for 14 days.',
          },
          {
            element: 'Beams, span over 6 m',
            cureDays: range(curingDays, 1, 1.4),
            stripDays: range(21, 1, 1.2),
            note: 'Props stay for 21 days.',
          },
          { element: 'Masonry walls', cureDays: range(7, 1, 1.4), note: 'Water twice a day.' },
          {
            element: 'Plaster',
            cureDays: range(7, 1, 1.45),
            note: 'Start the next day; do not let it dry out.',
          },
        ]
      : [];
  assumptions.push(
    `${p.estimate.cementType} cement: at least ${curingDays} days of wet curing, per IS 456:2000. Hot, dry or windy weather needs more.`,
  );
  assumptions.push(`Finishes priced at the "${p.estimate.quality}" level. Crew of ${crew} on the schedule.`);
  assumptions.push(
    `Contingency of ${p.estimate.contingencyPercent}% on the most likely figure, halved for minimum and raised by half for maximum.`,
  );
  if (!p.estimate.includeCompound) assumptions.push('Compound wall not included; switch it on to add it.');
  if (!p.estimate.includeInteriors) assumptions.push('Interiors not included; switch them on to add them.');
  assumptions.push(
    'Excludes land, approvals, architect and engineer fees, soil test, utility connections, GST changes and price escalation.',
  );

  return {
    builtUpSqm: builtUp,
    carpetSqm: carpet,
    lines: b.lines,
    stages: [...stagesMap.entries()].map(([stage, cost]) => ({ stage, cost })),
    materials: [...b.materials.values()],
    contingency,
    total,
    perSqft,
    schedule,
    totalDays,
    curing,
    assumptions,
    defaultRatesUsed: [...b.usedDefaults],
    isEmpty: b.lines.length === 0,
  };
}
