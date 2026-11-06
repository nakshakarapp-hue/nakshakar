import type { LengthUnit } from '../model/types';

/** Millimetres per length unit. 'ftin' shares the foot value; only its display differs. */
export const MM_PER: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
  ftin: 304.8,
  yd: 914.4,
  gaj: 914.4,
  hath: 457.2,
};

export type AreaUnit =
  | 'sqmm'
  | 'sqm'
  | 'sqft'
  | 'sqyd'
  | 'gaj2'
  | 'cent'
  | 'guntha'
  | 'acre'
  | 'bigha'
  | 'ankanam'
  | 'marla'
  | 'kani'
  | 'hectare';
export type VolumeUnit = 'cum' | 'cuft' | 'litre';
export type WeightUnit = 'kg' | 'quintal' | 'tonne' | 'bag';

/** Bigha varies by state, so the area value is selectable. Square metres per bigha. */
export const BIGHA_VARIANTS: Record<string, number> = {
  default: 1618,
  assam: 1337.8,
  bihar: 2529.3,
  gujarat: 1618.7,
  haryana: 2529.3,
  himachal: 809.4,
  rajasthan_pucca: 2529.3,
  rajasthan_kachha: 1618.7,
  up: 2529.3,
  west_bengal: 1337.8,
};

export const SQM_PER: Record<AreaUnit, number> = {
  sqmm: 1e-6,
  sqm: 1,
  sqft: 0.09290304,
  sqyd: 0.83612736,
  gaj2: 0.83612736,
  cent: 40.47,
  guntha: 101.17,
  acre: 4046.8564224,
  bigha: BIGHA_VARIANTS.default,
  ankanam: 72 * 0.09290304,
  marla: 25.29285264,
  kani: 5351.2,
  hectare: 10000,
};

export const CUM_PER: Record<VolumeUnit, number> = { cum: 1, cuft: 0.028316846592, litre: 0.001 };
export const KG_PER: Record<WeightUnit, number> = { kg: 1, quintal: 100, tonne: 1000, bag: 50 };

export const LENGTH_UNITS: LengthUnit[] = ['ftin', 'ft', 'in', 'm', 'cm', 'mm', 'yd', 'gaj', 'hath'];
export const AREA_UNITS = Object.keys(SQM_PER).filter((u) => u !== 'sqmm') as AreaUnit[];
export const VOLUME_UNITS = Object.keys(CUM_PER) as VolumeUnit[];
export const WEIGHT_UNITS = Object.keys(KG_PER) as WeightUnit[];

export function lengthToMm(value: number, unit: LengthUnit): number {
  return value * MM_PER[unit];
}

export function mmToLength(mm: number, unit: LengthUnit): number {
  return mm / MM_PER[unit];
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  return (value * MM_PER[from]) / MM_PER[to];
}

export function convertArea(
  value: number,
  from: AreaUnit,
  to: AreaUnit,
  bighaSqm: number = BIGHA_VARIANTS.default,
): number {
  const fromFactor = from === 'bigha' ? bighaSqm : SQM_PER[from];
  const toFactor = to === 'bigha' ? bighaSqm : SQM_PER[to];
  return (value * fromFactor) / toFactor;
}

export function convertVolume(value: number, from: VolumeUnit, to: VolumeUnit): number {
  return (value * CUM_PER[from]) / CUM_PER[to];
}

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  return (value * KG_PER[from]) / KG_PER[to];
}

/** Rounds to the 0.5 mm commit grid so stored coordinates never accumulate floating drift. */
export function snapMm(mm: number): number {
  return Math.round(mm * 2) / 2;
}
