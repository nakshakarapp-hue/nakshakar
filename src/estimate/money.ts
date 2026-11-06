import { formatIndian } from '../core/units';

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];

const SYMBOLS: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ' };

export function currencySymbol(currency?: string): string {
  return SYMBOLS[currency ?? 'INR'] ?? `${currency} `;
}

/** Whole-number amount: Indian digit grouping for rupees, thousands for everything else. */
export function formatMoney(value: number, currency: string = 'INR'): string {
  const digits =
    currency === 'INR'
      ? formatIndian(value)
      : Math.round(value)
          .toString()
          .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currencySymbol(currency)}${digits}`;
}
