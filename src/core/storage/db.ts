import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { HistoryState } from '../history/history';
import { newId } from '../model/ids';
import { migrateProject } from '../model/migrations';
import type { Project, ProjectMeta } from '../model/types';

export type SnapshotKind = 'auto' | 'manual' | 'milestone';

export interface Snapshot {
  id: string;
  projectId: string;
  name: string;
  at: number;
  kind: SnapshotKind;
  project: Project;
}

interface GharDb extends DBSchema {
  projects: { key: string; value: Project };
  history: { key: string; value: HistoryState & { projectId: string } };
  snapshots: { key: string; value: Snapshot; indexes: { byProject: string } };
}

/** Automatic restore points kept per project. Manual and milestone versions are never pruned. */
const MAX_AUTO_SNAPSHOTS = 20;

let dbPromise: Promise<IDBPDatabase<GharDb>> | null = null;

function db(): Promise<IDBPDatabase<GharDb>> {
  dbPromise ??= openDB<GharDb>('gharnirman', 1, {
    upgrade(database) {
      database.createObjectStore('projects', { keyPath: 'id' });
      database.createObjectStore('history', { keyPath: 'projectId' });
      database.createObjectStore('snapshots', { keyPath: 'id' }).createIndex('byProject', 'projectId');
    },
  });
  return dbPromise;
}

/** Test hook: forget the cached connection so a fresh IndexedDB factory is used. */
export function resetDbConnection(): void {
  dbPromise = null;
}

export function metaOf(p: Project): ProjectMeta {
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    thumbnail: p.thumbnail,
    floorCount: p.floors.length,
    tags: p.tags,
  };
}

export async function saveProject(project: Project): Promise<void> {
  await (await db()).put('projects', project);
}

/** Opens a project, upgrading it if an older app build saved it. */
export async function loadProject(id: string): Promise<Project | null> {
  const raw = await (await db()).get('projects', id);
  return raw ? migrateProject(raw) : null;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await (await db()).getAll('projects');
  return all.map(metaOf).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function allProjects(): Promise<Project[]> {
  return (await db()).getAll('projects');
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const keys = await d.getAllKeysFromIndex('snapshots', 'byProject', id);
  const tx = d.transaction(['projects', 'history', 'snapshots'], 'readwrite');
  await Promise.all([
    tx.objectStore('projects').delete(id),
    tx.objectStore('history').delete(id),
    ...keys.map((k) => tx.objectStore('snapshots').delete(k)),
    tx.done,
  ]);
}

export async function saveHistory(projectId: string, state: HistoryState): Promise<void> {
  await (await db()).put('history', { projectId, past: state.past, future: state.future });
}

export async function loadHistory(projectId: string): Promise<HistoryState | null> {
  const stored = await (await db()).get('history', projectId);
  return stored ? { past: stored.past, future: stored.future } : null;
}

export async function addSnapshot(project: Project, name: string, kind: SnapshotKind): Promise<Snapshot> {
  const d = await db();
  const snapshot: Snapshot = { id: newId(), projectId: project.id, name, at: Date.now(), kind, project };
  await d.put('snapshots', snapshot);
  if (kind === 'auto') {
    const all = await d.getAllFromIndex('snapshots', 'byProject', project.id);
    const autos = all.filter((s) => s.kind === 'auto').sort((a, b) => a.at - b.at);
    for (const old of autos.slice(0, Math.max(0, autos.length - MAX_AUTO_SNAPSHOTS)))
      await d.delete('snapshots', old.id);
  }
  return snapshot;
}

export async function listSnapshots(projectId: string): Promise<Snapshot[]> {
  const all = await (await db()).getAllFromIndex('snapshots', 'byProject', projectId);
  return all.sort((a, b) => b.at - a.at);
}

export async function renameSnapshot(id: string, name: string): Promise<void> {
  const d = await db();
  const s = await d.get('snapshots', id);
  if (s) await d.put('snapshots', { ...s, name, kind: 'manual' });
}

export async function deleteSnapshot(id: string): Promise<void> {
  await (await db()).delete('snapshots', id);
}
