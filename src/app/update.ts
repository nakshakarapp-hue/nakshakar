import { Capacitor, registerPlugin } from '@capacitor/core';

/** This build's version, from package.json. */
export const APP_VERSION: string = __APP_VERSION__;

/**
 * Where new versions are announced: a small file on the website, written when a release is published.
 * Only this file is ever fetched, and nothing about the person or their houses is sent with it.
 * When the site moves to its own domain, this is the one line to change.
 */
export const SITE_URL = 'https://nakshakarapp-hue.github.io/nakshakar/';
const UPDATE_URL = `${SITE_URL}version.json`;

export interface Release {
  version: string;
  /** ISO date the version was published. */
  date: string;
  /** What changed, one line each, already written for people rather than developers. */
  notes: string[];
  android?: { url: string; size: number };
  windows?: { url: string; size: number };
}

export type Channel = 'web' | 'windows' | 'play' | 'direct' | 'ios';

interface AppUpdaterPlugin {
  channel(): Promise<{ channel: string; versionName: string; versionCode: number }>;
  downloadAndInstall(options: { url: string }): Promise<{ started: boolean; needsPermission?: boolean }>;
  openStore(): Promise<void>;
}

/** Native side of updating on Android; see AppUpdaterPlugin.java. */
export const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

export async function currentChannel(): Promise<Channel> {
  if (Capacitor.getPlatform() === 'android') {
    try {
      const { channel } = await AppUpdater.channel();
      return channel === 'play' ? 'play' : 'direct';
    } catch {
      return 'direct';
    }
  }
  if (Capacitor.getPlatform() === 'ios') return 'ios';
  return location.protocol === 'file:' ? 'windows' : 'web';
}

/** True when version a is later than version b. Versions are numbers separated by dots. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** Reads the announcement, checking every field: it comes over the network. */
export function parseRelease(data: unknown): Release | null {
  const r = data as Partial<Release> | null;
  if (!r || typeof r.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(r.version)) return null;
  const link = (x: unknown) => {
    const l = x as { url?: unknown; size?: unknown } | undefined;
    return l && typeof l.url === 'string' && l.url.startsWith(SITE_URL)
      ? { url: l.url, size: typeof l.size === 'number' ? l.size : 0 }
      : undefined;
  };
  return {
    version: r.version,
    date: typeof r.date === 'string' ? r.date.slice(0, 10) : '',
    notes: Array.isArray(r.notes)
      ? r.notes
          .filter((n): n is string => typeof n === 'string')
          .map((n) => n.slice(0, 200))
          .slice(0, 12)
      : [],
    android: link(r.android),
    windows: link(r.windows),
  };
}

/** The newest version, when it is newer than this one. Quietly null when offline. */
export async function checkForUpdate(): Promise<Release | null> {
  // The website reads the file next to itself, so it works on any address the site is served from.
  const url = Capacitor.isNativePlatform() || location.protocol === 'file:' ? UPDATE_URL : '../version.json';
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const release = parseRelease(await response.json());
    return release && isNewer(release.version, APP_VERSION) ? release : null;
  } catch {
    return null;
  }
}
