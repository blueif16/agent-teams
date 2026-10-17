/*
 * Agents' Markdown in memory: content and last change per file, keyed by
 * absolute path. Writes made through here update the cache and announce
 * files:agent:<id>; a recursive watcher on each root drops a file whose
 * content changed outside the app (an editor, git), debounced per file.
 *
 * set() and invalidate() are the seam for the vault writer (team-setup §8b):
 * after it commits a file it either hands over the new content or drops the entry.
 */
import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { TOPICS, type Bus } from "./bus";

const SETTLE_MS = 250;

export interface CachedFile {
  content: string;
  /** Last change, ISO. */
  updated: string;
}

export interface FileCacheOptions {
  bus: Bus;
  /** Directories holding agents/<id>/…; the first path segment under a root is the agent id. */
  roots: string[];
  /** How long a file must be quiet before an outside change is checked. */
  debounceMs?: number;
}

export class FileCache {
  private readonly entries = new Map<string, CachedFile>();
  /** Bumped on every change, so a disk read that raced one isn't cached. */
  private readonly gens = new Map<string, number>();
  private readonly loading = new Map<string, Promise<CachedFile>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private watchers: FSWatcher[] = [];
  private settle?: ReturnType<typeof setTimeout>;

  constructor(private readonly opts: FileCacheOptions) {}

  /** From memory, else from disk (then cached). Rejects with ENOENT like readFile. */
  read(file: string): Promise<CachedFile> {
    const hit = this.entries.get(file);
    if (hit) return Promise.resolve(hit);
    let pending = this.loading.get(file);
    if (!pending) {
      pending = this.load(file).finally(() => this.loading.delete(file));
      this.loading.set(file, pending);
    }
    return pending;
  }

  /** Writes to disk, then caches and announces. `exclusive` fails with EEXIST instead of overwriting. */
  async write(file: string, content: string, { exclusive = false } = {}): Promise<CachedFile> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, exclusive ? { flag: "wx" } : undefined);
    const s = await stat(file);
    return this.put(file, { content, updated: s.mtime.toISOString() });
  }

  /** Content someone else has written (the vault writer): cache and announce it, no disk access. */
  set(file: string, content: string, updated = new Date().toISOString()): CachedFile {
    return this.put(file, { content, updated });
  }

  /** Drop a file so the next read goes to disk, and announce it. */
  invalidate(file: string) {
    this.bump(file);
    this.entries.delete(file);
    this.announce(file);
  }

  /**
   * Start watching every root that exists (or can be made). On macOS a new watcher isn't live for
   * up to ~100 ms under load and misses edits made meanwhile, so every cached file is checked once
   * after that.
   */
  watch() {
    this.settle = setTimeout(() => {
      for (const file of this.entries.keys()) this.changed(file);
    }, SETTLE_MS);
    this.settle.unref?.();
    for (const root of this.opts.roots) {
      try {
        mkdirSync(root, { recursive: true });
        const w = watch(root, { recursive: true, persistent: false }, (_type, name) => {
          if (!name) return;
          const rel = name.toString();
          // Dotfiles (.DS_Store, .git) aren't agent files.
          if (rel.split(path.sep).some((part) => part.startsWith("."))) return;
          this.changed(path.join(root, rel));
        });
        w.on("error", (e) => console.warn(`Stopped watching ${root}:`, e.message));
        this.watchers.push(w);
      } catch (e) {
        console.warn(`Can't watch ${root} for outside edits:`, (e as Error).message);
      }
    }
  }

  close() {
    clearTimeout(this.settle);
    for (const w of this.watchers) w.close();
    this.watchers = [];
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private async load(file: string): Promise<CachedFile> {
    const gen = this.gen(file);
    const [content, s] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const entry = { content, updated: s.mtime.toISOString() };
    if (this.gen(file) === gen) this.entries.set(file, entry);
    return entry;
  }

  private put(file: string, entry: CachedFile): CachedFile {
    this.bump(file);
    this.entries.set(file, entry);
    this.announce(file);
    return entry;
  }

  private gen(file: string) {
    return this.gens.get(file) ?? 0;
  }

  private bump(file: string) {
    this.gens.set(file, this.gen(file) + 1);
  }

  private changed(file: string) {
    clearTimeout(this.timers.get(file));
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file);
        this.check(file).catch((e) => console.warn(`Couldn't check ${file}:`, (e as Error).message));
      }, this.opts.debounceMs ?? 75),
    );
  }

  /** Our own writes trigger the watcher too; only a change to what's cached counts. Directories don't. */
  private async check(file: string) {
    const hit = this.entries.get(file);
    if (hit) {
      const disk = await readFile(file, "utf8").catch(() => null);
      if (disk === hit.content || this.entries.get(file) !== hit) return;
    } else if ((await stat(file).catch(() => null))?.isDirectory()) {
      return;
    }
    this.invalidate(file);
  }

  private announce(file: string) {
    for (const root of this.opts.roots) {
      const rel = path.relative(root, file);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      this.opts.bus.emit(TOPICS.files(rel.split(path.sep)[0]));
      return;
    }
  }
}
