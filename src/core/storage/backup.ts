import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { migrateProject } from '../model/migrations';
import type { Project } from '../model/types';
import { allProjects, saveProject } from './db';

const DIR = 'projects';
const isNative = () => Capacitor.isNativePlatform();

/**
 * Second copy of each project as JSON in the app's private data directory, which survives
 * WebView storage eviction. On the web build this is a no-op, because there is no such directory.
 */
export async function writeBackup(project: Project): Promise<void> {
  if (!isNative()) return;
  const path = `${DIR}/${project.id}.json`;
  const temp = `${path}.tmp`;
  await Filesystem.writeFile({
    path: temp,
    data: JSON.stringify(project),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  // Rename last, so a kill mid-write leaves the previous backup whole.
  await Filesystem.rename({ from: temp, to: path, directory: Directory.Data, toDirectory: Directory.Data });
}

export async function removeBackup(id: string): Promise<void> {
  if (!isNative()) return;
  await Filesystem.deleteFile({ path: `${DIR}/${id}.json`, directory: Directory.Data }).catch(
    () => undefined,
  );
}

/**
 * Restores any project whose backup is missing from IndexedDB or newer than the stored copy.
 * Run once at launch. Returns how many projects were restored.
 */
export async function restoreFromBackups(): Promise<number> {
  if (!isNative()) return 0;
  const listing = await Filesystem.readdir({ path: DIR, directory: Directory.Data }).catch(() => null);
  if (!listing) return 0;
  const existing = new Map((await allProjects()).map((p) => [p.id, p.updatedAt]));
  let restored = 0;
  for (const file of listing.files) {
    if (!file.name.endsWith('.json')) continue;
    try {
      const read = await Filesystem.readFile({
        path: `${DIR}/${file.name}`,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      const project = migrateProject(JSON.parse(read.data as string));
      if ((existing.get(project.id) ?? -1) < project.updatedAt) {
        await saveProject(project);
        restored += 1;
      }
    } catch {
      // A damaged backup must never stop the app opening; the IndexedDB copy still stands.
    }
  }
  return restored;
}
