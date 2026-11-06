import type { LengthUnit } from '../model/types';
import { CUM_PER, KG_PER, MM_PER, SQM_PER, type AreaUnit, type VolumeUnit, type WeightUnit } from './convert';

export type ParseResult<T = number> = { ok: true; value: T } | { ok: false; hint: string };

const fail = (hint: string): { ok: false; hint: string } => ({ ok: false, hint });

const NUM = String.raw`\d+(?:\.\d*)?|\.\d+`;
const FRACTION = String.raw`\d+\s*/\s*\d+`;

/** Maps every spelling a site user is likely to type onto a unit. */
const LENGTH_ALIASES: Record<string, LengthUnit> = {
  mm: 'mm',
  millimetre: 'mm',
  millimeter: 'mm',
  millimetres: 'mm',
  millimeters: 'mm',
  cm: 'cm',
  centimetre: 'cm',
  centimeter: 'cm',
  centimetres: 'cm',
  centimeters: 'cm',
  m: 'm',
  mtr: 'm',
  mtrs: 'm',
  metre: 'm',
  meter: 'm',
  metres: 'm',
  meters: 'm',
  in: 'in',
  inch: 'in',
  inches: 'in',
  '"': 'in',
  '″': 'in',
  "''": 'in',
  ft: 'ft',
  foot: 'ft',
  feet: 'ft',
  "'": 'ft',
  '′': 'ft',
  yd: 'yd',
  yard: 'yd',
  yards: 'yd',
  yds: 'yd',
  gaj: 'gaj',
  gaz: 'gaj',
  hath: 'hath',
  haath: 'hath',
  cubit: 'hath',
  cubits: 'hath',
};

function parseFraction(text: string): number | null {
  const [n, d] = text.split('/').map((s) => Number(s.trim()));
  return d === 0 ? null : n / d;
}

/** Parses "5", "5.5", "1/2" or "5 1/2" as a plain quantity. Returns null if it is anything else. */
function parseQuantity(text: string): number | null {
  const t = text.trim();
  if (new RegExp(`^(?:${NUM})$`).test(t)) return Number(t);
  if (new RegExp(`^${FRACTION}$`).test(t)) return parseFraction(t);
  const mixed = new RegExp(`^(\\d+)[\\s-]+(${FRACTION})$`).exec(t);
  if (mixed) {
    const f = parseFraction(mixed[2]);
    return f === null ? null : Number(mixed[1]) + f;
  }
  return null;
}

function normalise(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ');
}

/** Handles 12'6, 12' 6", 12ft 6in, 12 ft 6 1/2 in, 12feet 6inch and similar. */
function parseFeetInches(t: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(?:'|′|ft|foot|feet)\s*-?\s*(.+)$/.exec(t);
  if (!m) return null;
  const inchText = m[2].replace(/\s*(?:''|"|″|in|inch|inches)$/, '').trim();
  const inches = parseQuantity(inchText);
  if (inches === null) return null;
  return Number(m[1]) * MM_PER.ft + inches * MM_PER.in;
}

function parsePositiveLength(t: string, defaultUnit: LengthUnit): number | null {
  const feetAndInches = parseFeetInches(t);
  if (feetAndInches !== null) return feetAndInches;

  // "12-6" means 12 feet 6 inches on Indian sites, regardless of the default unit.
  const dashed = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (dashed) return Number(dashed[1]) * MM_PER.ft + Number(dashed[2]) * MM_PER.in;

  const plain = parseQuantity(t);
  if (plain !== null) return plain * MM_PER[defaultUnit];

  const withUnit = /^(.*?)\s*([a-z'"″′]+)$/.exec(t);
  if (!withUnit) return null;
  const unit = LENGTH_ALIASES[withUnit[2]];
  const qty = parseQuantity(withUnit[1]);
  if (!unit || qty === null) return null;
  return qty * MM_PER[unit];
}

/**
 * Parses a length typed in any supported form and returns millimetres.
 * A bare number uses `defaultUnit`; a 'ftin' default reads a bare number as feet.
 */
export function parseLength(input: string, defaultUnit: LengthUnit = 'mm'): ParseResult {
  let t = normalise(input);
  if (t === '') return fail('Enter a length, for example 12\'6" or 3.2m');

  let sign = 1;
  if (t.startsWith('-')) {
    sign = -1;
    t = t.slice(1).trim();
  } else if (t.startsWith('+')) {
    t = t.slice(1).trim();
  }

  const mm = parsePositiveLength(t, defaultUnit);
  if (mm === null) return fail(`Could not read "${input.trim()}". Try 12'6", 3.2m, 320cm or 5 1/2 in`);
  return { ok: true, value: sign * mm };
}

const AREA_ALIASES: Record<string, AreaUnit> = {
  'sq mm': 'sqmm',
  sqmm: 'sqmm',
  'sq m': 'sqm',
  sqm: 'sqm',
  'sq.m': 'sqm',
  'sq mt': 'sqm',
  'sq mtr': 'sqm',
  m2: 'sqm',
  'm²': 'sqm',
  'sq ft': 'sqft',
  sqft: 'sqft',
  'sq.ft': 'sqft',
  sft: 'sqft',
  ft2: 'sqft',
  'ft²': 'sqft',
  'sq yd': 'sqyd',
  sqyd: 'sqyd',
  'sq.yd': 'sqyd',
  yd2: 'sqyd',
  'yd²': 'sqyd',
  gaj: 'gaj2',
  'sq gaj': 'gaj2',
  cent: 'cent',
  cents: 'cent',
  guntha: 'guntha',
  gunta: 'guntha',
  gunthas: 'guntha',
  guntas: 'guntha',
  acre: 'acre',
  acres: 'acre',
  bigha: 'bigha',
  bighas: 'bigha',
  ankanam: 'ankanam',
  ankanams: 'ankanam',
  marla: 'marla',
  marlas: 'marla',
  kani: 'kani',
  kanis: 'kani',
  hectare: 'hectare',
  hectares: 'hectare',
  ha: 'hectare',
};

const VOLUME_ALIASES: Record<string, VolumeUnit> = {
  'cu m': 'cum',
  cum: 'cum',
  'cu.m': 'cum',
  m3: 'cum',
  'm³': 'cum',
  'cu ft': 'cuft',
  cuft: 'cuft',
  'cu.ft': 'cuft',
  cft: 'cuft',
  ft3: 'cuft',
  'ft³': 'cuft',
  l: 'litre',
  ltr: 'litre',
  litre: 'litre',
  litres: 'litre',
  liter: 'litre',
  liters: 'litre',
};

const WEIGHT_ALIASES: Record<string, WeightUnit> = {
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  quintal: 'quintal',
  quintals: 'quintal',
  q: 'quintal',
  qtl: 'quintal',
  t: 'tonne',
  tonne: 'tonne',
  tonnes: 'tonne',
  ton: 'tonne',
  tons: 'tonne',
  mt: 'tonne',
  bag: 'bag',
  bags: 'bag',
};

function parseScaled<U extends string>(
  input: string,
  aliases: Record<string, U>,
  factors: Record<U, number>,
  defaultUnit: U,
  example: string,
): ParseResult {
  const t = normalise(input);
  if (t === '') return fail(`Enter a value, for example ${example}`);
  const m = /^(.*?)\s*([a-z²³][a-z.²³0-9 ]*)$/.exec(t);
  const qty = parseQuantity(m ? m[1] : t);
  if (qty === null) return fail(`Could not read "${input.trim()}". Try ${example}`);
  if (!m) return { ok: true, value: qty * factors[defaultUnit] };
  const unit = aliases[m[2].trim()];
  if (!unit) return fail(`Unknown unit "${m[2].trim()}". Try ${example}`);
  return { ok: true, value: qty * factors[unit] };
}

/** Parses an area and returns square metres. */
export function parseArea(
  input: string,
  defaultUnit: AreaUnit = 'sqft',
  bighaSqm: number = SQM_PER.bigha,
): ParseResult {
  const factors = { ...SQM_PER, bigha: bighaSqm };
  return parseScaled(input, AREA_ALIASES, factors, defaultUnit, '1200 sq ft or 5 cent');
}

/** Parses a volume and returns cubic metres. */
export function parseVolume(input: string, defaultUnit: VolumeUnit = 'cum'): ParseResult {
  return parseScaled(input, VOLUME_ALIASES, CUM_PER, defaultUnit, '12 cu ft or 3 cu m');
}

/** Parses a weight and returns kilograms. */
export function parseWeight(input: string, defaultUnit: WeightUnit = 'kg'): ParseResult {
  return parseScaled(input, WEIGHT_ALIASES, KG_PER, defaultUnit, '50 kg or 2 bags');
}

/** Parses an angle in degrees, accepting 45, 45deg and 45°. */
export function parseAngle(input: string): ParseResult {
  const t = normalise(input).replace(/\s*(?:°|deg|degree|degrees)$/, '');
  if (t === '') return fail('Enter an angle, for example 90');
  const value = Number(t);
  return Number.isFinite(value) ? { ok: true, value } : fail(`Could not read "${input.trim()}" as an angle`);
}
