import type { DisplayPrecision, LengthUnit } from '../model/types';
import { CUM_PER, KG_PER, MM_PER, SQM_PER, type AreaUnit, type VolumeUnit, type WeightUnit } from './convert';

const LENGTH_LABEL: Record<LengthUnit, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  in: 'in',
  ft: 'ft',
  ftin: '',
  yd: 'yd',
  gaj: 'gaj',
  hath: 'hath',
};

export const AREA_LABEL: Record<AreaUnit, string> = {
  sqmm: 'sq mm',
  sqm: 'sq m',
  sqft: 'sq ft',
  sqyd: 'sq yd',
  gaj2: 'gaj',
  cent: 'cent',
  guntha: 'guntha',
  acre: 'acre',
  bigha: 'bigha',
  ankanam: 'ankanam',
  marla: 'marla',
  kani: 'kani',
  hectare: 'hectare',
};

export const VOLUME_LABEL: Record<VolumeUnit, string> = { cum: 'cu m', cuft: 'cu ft', litre: 'litre' };
export const WEIGHT_LABEL: Record<WeightUnit, string> = {
  kg: 'kg',
  quintal: 'quintal',
  tonne: 'tonne',
  bag: 'bag',
};

function trimNumber(value: number, decimals: number): string {
  return Number(value.toFixed(decimals)).toString();
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** Formats inches as a whole number with an optional reduced fraction, such as 6 1/2. */
function inchesText(eighths: number): string {
  const whole = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (rest === 0) return `${whole}`;
  const g = greatestCommonDivisor(rest, 8);
  const fraction = `${rest / g}/${8 / g}`;
  return whole === 0 ? fraction : `${whole} ${fraction}`;
}

/** Formats a length in feet and inches, such as 12'6" or 5'6 1/2". */
function formatFeetInches(mm: number, precision: DisplayPrecision): string {
  const sign = mm < 0 ? '-' : '';
  const totalInches = Math.abs(mm) / MM_PER.in;
  if (precision === 'eighth') {
    const totalEighths = Math.round(totalInches * 8);
    const feet = Math.floor(totalEighths / 96);
    return `${sign}${feet}'${inchesText(totalEighths - feet * 96)}"`;
  }
  const factor = 10 ** precision;
  const rounded = Math.round(totalInches * factor) / factor;
  const feet = Math.floor(rounded / 12);
  return `${sign}${feet}'${trimNumber(rounded - feet * 12, precision)}"`;
}

/** Formats millimetres in the chosen display unit and precision. */
export function formatLength(mm: number, unit: LengthUnit, precision: DisplayPrecision = 2): string {
  if (unit === 'ftin') return formatFeetInches(mm, precision);
  const value = mm / MM_PER[unit];
  if (precision === 'eighth') {
    if (unit === 'in') {
      const sign = mm < 0 ? '-' : '';
      return `${sign}${inchesText(Math.round(Math.abs(value) * 8))} in`;
    }
    return `${trimNumber(value, unit === 'mm' ? 0 : 2)} ${LENGTH_LABEL[unit]}`;
  }
  return `${trimNumber(value, precision)} ${LENGTH_LABEL[unit]}`;
}

/** Value for an editable numeric field: no unit suffix unless the unit is feet-and-inches. */
export function lengthInputText(mm: number, unit: LengthUnit): string {
  if (unit === 'ftin') return formatFeetInches(mm, 'eighth');
  return trimNumber(mm / MM_PER[unit], 3);
}

export function formatArea(sqm: number, unit: AreaUnit, decimals = 2): string {
  return `${trimNumber(sqm / SQM_PER[unit], decimals)} ${AREA_LABEL[unit]}`;
}

export function formatVolume(cum: number, unit: VolumeUnit, decimals = 2): string {
  return `${trimNumber(cum / CUM_PER[unit], decimals)} ${VOLUME_LABEL[unit]}`;
}

export function formatWeight(kg: number, unit: WeightUnit, decimals = 2): string {
  return `${trimNumber(kg / KG_PER[unit], decimals)} ${WEIGHT_LABEL[unit]}`;
}

/** The area unit that naturally pairs with a length unit. */
export function areaUnitFor(unit: LengthUnit): AreaUnit {
  if (unit === 'm' || unit === 'cm' || unit === 'mm') return 'sqm';
  return unit === 'yd' || unit === 'gaj' ? 'sqyd' : 'sqft';
}

/** Indian digit grouping, such as 12,34,567. */
export function formatIndian(value: number): string {
  const rounded = Math.round(Math.abs(value));
  const digits = rounded.toString();
  const sign = value < 0 && rounded !== 0 ? '-' : '';
  if (digits.length <= 3) return sign + digits;
  const last3 = digits.slice(-3);
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${head},${last3}`;
}
