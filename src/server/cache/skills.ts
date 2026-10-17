/*
 * The skill library in memory: skills/index.json and every vendored file a request has read, keyed by absolute
 * path. The curator's import (scripts/skills/import.mts) and git write the folder from outside the app, so a
 * recursive watcher on it checks what's cached once the folder has been quiet for a moment; if anything differs
 * from disk, the whole library is dropped and `skills` announced. An import rewrites everything at once, so
 * per-file invalidation would buy nothing.
 */
import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadLibrary, type Library } from "@/lib/skills/library";
import { TOPICS, type Bus } from "./bus";

const SETTLE_MS = 250;

export interface SkillCacheOptions {
  bus: Bus;
  /** The skills dir: index.json and library/ live here. */
  dir: string;
  /** How long the folder must be quiet before an outside change is checked. */
  debounceMs?: number;
}

export class SkillCache {
  /** Reads so far: the content, or a rejection with ENOENT for a file that was missing. */
  private files = new Map<string, Promise<string>>();
  private lib?: Promise<Library>;
  private timer?: ReturnType<typeof setTimeout>;
  private settle?: ReturnType<typeof setTimeout>;
  private watcher?: FSWatcher;

  constructor(private readonly opts: SkillCacheOptions) {}

  /** The library, read from disk only the first time after a change. A failed load is retried next time. */
  library(): Promise<Library> {
    if (!this.lib) {
      const lib = loadLibrary(this.opts.dir, (file) => this.read(file));
      this.lib = lib;
      lib.catch(() => {
        if (this.lib === lib) this.lib = undefined;
      });
    }
    return this.lib;
  }

  /** Drop everything, so the next read goes to disk, and announce it. */
  invalidate() {
    this.files = new Map();
    this.lib = undefined;
    this.opts.bus.emit(TOPICS.skills);
  }

  /**
   * Start watching the skills dir. On macOS a new watcher isn't live for up to ~100 ms under load and misses
   * edits made meanwhile, so what's cached is checked once after that.
   */
  watch() {
    this.settle = setTimeout(() => this.changed(), SETTLE_MS);
    this.settle.unref?.();
    const { dir } = this.opts;
    try {
      mkdirSync(dir, { recursive: true });
      this.watcher = watch(dir, { recursive: true, persistent: false }, (_type, name) => {
        // Dotfiles (.DS_Store, .git) aren't the library.
        if (name && name.toString().split(path.sep).some((part) => part.startsWith("."))) return;
        this.changed();
      });
      this.watcher.on("error", (e) => console.warn(`Stopped watching ${dir}:`, e.message));
    } catch (e) {
      console.warn(`Can't watch ${dir} for a new import:`, (e as Error).message);
    }
  }

  close() {
    clearTimeout(this.settle);
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
  }

  private read(file: string): Promise<string> {
    let pending = this.files.get(file);
    if (!pending) {
      const read = readFile(file, "utf8");
      pending = read;
      this.files.set(file, read);
      // A missing file stays cached (the watcher sees it appear); any other failure is retried.
      read.catch((e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT" && this.files.get(file) === read) this.files.delete(file);
      });
    }
    return pending;
  }

  private changed() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.check().catch((e) => console.warn("Couldn't check the skill library:", (e as Error).message));
    }, this.opts.debounceMs ?? 75);
    this.timer.unref?.();
  }

  /** Only a change to what's been served counts, so an import that rewrites identical files stays quiet. */
  private async check() {
    const files = this.files;
    for (const [file, cached] of files) {
      const was = await cached.catch(() => null);
      const now = await readFile(file, "utf8").catch(() => null);
      if (this.files !== files) return; // dropped meanwhile
      if (was !== now) return this.invalidate();
    }
  }
}
