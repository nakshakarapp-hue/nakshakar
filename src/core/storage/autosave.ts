export interface AutosaveOptions {
  /** Quiet time after the last edit before writing. */
  debounceMs?: number;
  /** Longest an edit may wait during continuous editing. Keeps worst-case loss under 2 seconds. */
  maxWaitMs?: number;
  /** Slower cadence for the filesystem backup copy. */
  backupEveryMs?: number;
}

/**
 * Coalesces edits into writes. Saves overlap safely: a change arriving during a write is written
 * straight after it, and flush() resolves only when everything is on disk.
 */
export class Autosaver<T> {
  private latest: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt = 0;
  private lastBackupAt = 0;
  private writing: Promise<void> | null = null;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly backupEveryMs: number;

  constructor(
    private readonly save: (value: T) => Promise<void>,
    private readonly backup: (value: T) => Promise<void> = async () => undefined,
    private readonly onError: (error: unknown) => void = () => undefined,
    options: AutosaveOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 300;
    this.maxWaitMs = options.maxWaitMs ?? 1000;
    this.backupEveryMs = options.backupEveryMs ?? 5000;
  }

  /** Marks a new value as needing a save. */
  schedule(value: T): void {
    const now = Date.now();
    if (this.latest === null) this.firstDirtyAt = now;
    this.latest = value;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.min(this.debounceMs, Math.max(0, this.firstDirtyAt + this.maxWaitMs - now));
    this.timer = setTimeout(() => void this.drain(false), wait);
  }

  /** Writes anything pending immediately. Call when the app is backgrounded. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.drain(true);
  }

  private async drain(forceBackup: boolean): Promise<void> {
    if (this.writing) await this.writing;
    if (this.latest === null) {
      if (forceBackup) await this.writing;
      return;
    }
    const value = this.latest;
    this.latest = null;
    this.writing = this.writeOne(value, forceBackup).finally(() => {
      this.writing = null;
    });
    await this.writing;
    if (this.latest !== null && forceBackup) await this.drain(true);
  }

  private async writeOne(value: T, forceBackup: boolean): Promise<void> {
    try {
      await this.save(value);
      const now = Date.now();
      if (forceBackup || now - this.lastBackupAt >= this.backupEveryMs) {
        this.lastBackupAt = now;
        await this.backup(value);
      }
    } catch (error) {
      this.onError(error);
    }
  }
}
