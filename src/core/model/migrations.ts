import { defaultRoof, defaultSettings } from './defaults';
import { SCHEMA_VERSION, type Project } from './types';

type RawProject = Record<string, unknown> & { schemaVersion?: number };
type Migration = (p: RawProject) => RawProject;

/**
 * migrations[n] upgrades a project from schema n to n + 1. Add new entries here and bump
 * SCHEMA_VERSION so every project saved by an older build keeps opening after an update.
 */
const migrations: Record<number, Migration> = {
  // Schema 0 was a pre-release shape that lacked per-project settings and a roof.
  0: (p) => ({
    ...p,
    settings: { ...defaultSettings(), ...((p.settings as object | undefined) ?? {}) },
    roof: p.roof ?? defaultRoof(),
    schemaVersion: 1,
  }),
};

export class ProjectTooNewError extends Error {
  constructor(version: number) {
    super(`Project was saved by a newer app version (schema ${version}).`);
    this.name = 'ProjectTooNewError';
  }
}

/** Upgrades raw stored JSON to the current schema. Never mutates the input. */
export function migrateProject(raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) throw new Error('Project data is not an object.');
  let current = { ...(raw as RawProject) };
  let version = typeof current.schemaVersion === 'number' ? current.schemaVersion : 0;
  if (version > SCHEMA_VERSION) throw new ProjectTooNewError(version);
  while (version < SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new Error(`No migration from schema ${version}.`);
    current = step(current);
    version += 1;
  }
  return current as unknown as Project;
}
