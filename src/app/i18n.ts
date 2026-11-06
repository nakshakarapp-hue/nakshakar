import type { Language } from '../core/model/types';
import en from '../locales/en.json';
import hi from '../locales/hi.json';
import te from '../locales/te.json';
import ta from '../locales/ta.json';
import kn from '../locales/kn.json';
import ml from '../locales/ml.json';
import mr from '../locales/mr.json';
import gu from '../locales/gu.json';
import bn from '../locales/bn.json';
import phrases from '../locales/phrases.json';
import { useApp } from './store';

type Dict = Record<string, string>;

const DICTS: Record<Language, Dict> = { en, hi, te, ta, kn, ml, mr, gu, bn };

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'te', label: 'తెలుగు' },
  { id: 'ta', label: 'தமிழ்' },
  { id: 'kn', label: 'ಕನ್ನಡ' },
  { id: 'ml', label: 'മലയാളം' },
  { id: 'mr', label: 'मराठी' },
  { id: 'gu', label: 'ગુજરાતી' },
  { id: 'bn', label: 'বাংলা' },
];

/** Translates a key, falling back to English and then to the fallback text given. */
export function translate(lang: Language, key: string, fallback?: string): string {
  return DICTS[lang]?.[key] ?? (en as Dict)[key] ?? fallback ?? key;
}

const PHRASES = phrases as Record<string, string[]>;
const PHRASE_SLOT: Partial<Record<Language, 0 | 1>> = { hi: 0, te: 1 };
const FROM_ENGLISH = new Map(Object.entries(en as Dict).map(([key, value]) => [value, key]));
const VERBS = /^(Add|Apply|Restore) (.+)$/;

function phrase(lang: Language, text: string): string | null {
  const slot = PHRASE_SLOT[lang];
  if (slot === undefined) return null;
  return PHRASES[text]?.[slot] ?? null;
}

/**
 * Translates a sentence produced by the app's logic, such as an estimate note or a history step.
 * Numbers are carried across, so "18 footings" and "24 footings" share one translation. Anything
 * unknown, such as a name the user typed, comes back unchanged.
 */
export function translateText(lang: Language, text: string): string {
  if (!text || lang === 'en') return text;
  const key = FROM_ENGLISH.get(text);
  if (key && DICTS[lang]?.[key]) return DICTS[lang][key];
  const exact = phrase(lang, text);
  if (exact) return exact;
  const numbers: string[] = [];
  const pattern = text.replace(/\d[\d,]*(?:\.\d+)?/g, (n) => {
    numbers.push(n);
    return '#';
  });
  const numbered = phrase(lang, pattern);
  if (numbered) {
    let i = 0;
    return numbered.replace(/#/g, () => numbers[i++] ?? '');
  }
  const colon = text.indexOf(': ');
  if (colon > 0) {
    const head = translateText(lang, text.slice(0, colon));
    const tail = translateText(lang, text.slice(colon + 2));
    if (head !== text.slice(0, colon) || tail !== text.slice(colon + 2)) return `${head}: ${tail}`;
  }
  const verb = VERBS.exec(text);
  if (verb) {
    const template = phrase(lang, `${verb[1]} {x}`);
    if (template) return template.replace('{x}', translateText(lang, verb[2]));
  }
  return text;
}

/** Fills a template's {slots}, translating the template and each value. */
export function translateTemplate(
  lang: Language,
  template: string,
  vars: Record<string, string> = {},
): string {
  let out = translateText(lang, template);
  for (const [name, value] of Object.entries(vars))
    out = out.split(`{${name}}`).join(translateText(lang, value));
  return out;
}

export type T = (key: string, fallback?: string) => string;

export function useT(): T {
  const lang = useApp((s) => s.prefs.language);
  return (key, fallback) => translate(lang, key, fallback);
}
