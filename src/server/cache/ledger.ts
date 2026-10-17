/*
 * The ledger in memory. The file is read once; after that, appends made here
 * update memory as they are written, and appends made by another process are
 * found by a watcher that reads only the bytes past the last offset.
 *
 * The offset only ever moves by reading the file. Lines this process wrote are
 * remembered until the tail reader passes them, so they are never counted twice.
 */
import { watch, type FSWatcher } from "node:fs";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import type { LedgerEvent } from "@/lib/ledger";
import { TOPICS, type Bus } from "./bus";

export class LedgerCache {
  private list: LedgerEvent[] = [];
  /** Bytes of the file parsed so far, always at the end of a whole line. */
  private offset = 0;
  /** Lines appended here that the tail reader hasn't reached yet. */
  private own: string[] = [];
  private loaded?: Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  private watcher?: FSWatcher;
  private closed = false;

  constructor(
    private readonly file: string,
    private readonly bus: Bus,
  ) {}

  /** Reads the file the first time it is called; a failed read is retried next time. */
  ready(): Promise<void> {
    return (this.loaded ??= this.load().catch((e) => {
      this.loaded = undefined;
      throw e;
    }));
  }

  async events(): Promise<readonly LedgerEvent[]> {
    await this.ready();
    return this.list;
  }

  /** Appends to the file, then to memory, then announces the change. */
  async append(event: LedgerEvent): Promise<void> {
    await this.ready();
    const line = JSON.stringify(event);
    // Before the write, so a tail read that races it knows the line is ours.
    this.own.push(line);
    try {
      await mkdir(path.dirname(this.file), { recursive: true });
      await appendFile(this.file, `${line}\n`);
    } catch (e) {
      this.own.splice(this.own.indexOf(line), 1);
      throw e;
    }
    this.list.push(event);
    this.announce([event]);
  }

  close() {
    this.closed = true;
    this.watcher?.close();
    this.watcher = undefined;
  }

  private async load() {
    let buf: Buffer;
    try {
      buf = await readFile(this.file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      buf = Buffer.alloc(0);
    }
    this.list = [];
    this.offset = 0;
    this.ingest(buf);
    await this.watch();
  }

  /** Watches the directory, since the file may not exist yet. */
  private async watch() {
    if (this.closed || this.watcher) return;
    const dir = path.dirname(this.file);
    const name = path.basename(this.file);
    try {
      await mkdir(dir, { recursive: true });
      this.watcher = watch(dir, { persistent: false }, (_type, changed) => {
        if (!changed || changed.toString() === name) void this.catchUp();
      });
      this.watcher.on("error", (e) => console.warn("The ledger watcher stopped:", e.message));
      // On macOS a new watcher isn't live for up to ~100 ms under load; catch up once after that.
      setTimeout(() => !this.closed && void this.catchUp(), 250).unref?.();
    } catch (e) {
      console.warn("Can't watch the ledger for other writers:", (e as Error).message);
    }
  }

  /** Reads whatever was appended past the offset. Calls run one at a time. */
  private catchUp(): Promise<void> {
    this.tail = this.tail
      .then(() => this.readTail())
      .catch((e) => console.warn("Couldn't read the ledger's new lines:", (e as Error).message));
    return this.tail;
  }

  private async readTail() {
    let fh;
    try {
      fh = await open(this.file, "r");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    try {
      const { size } = await fh.stat();
      let reset = false;
      if (size < this.offset) {
        // Truncated or replaced: start over from the top.
        this.list = [];
        this.own = [];
        this.offset = 0;
        reset = true;
      }
      if (size > this.offset) {
        const buf = Buffer.alloc(size - this.offset);
        const { bytesRead } = await fh.read(buf, 0, buf.length, this.offset);
        const fresh = this.ingest(buf.subarray(0, bytesRead));
        this.announce(fresh);
      }
      if (reset) this.bus.emit(TOPICS.stats);
    } finally {
      await fh.close();
    }
  }

  /** Adds the whole lines in `buf` that aren't ours; a partial last line waits for the next read. */
  private ingest(buf: Buffer): LedgerEvent[] {
    const end = buf.lastIndexOf(0x0a);
    if (end === -1) return [];
    this.offset += end + 1;
    const fresh: LedgerEvent[] = [];
    for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      const mine = this.own.indexOf(line);
      if (mine !== -1) {
        this.own.splice(mine, 1);
        continue;
      }
      try {
        fresh.push(JSON.parse(line) as LedgerEvent);
      } catch {
        console.warn("Skipped a ledger line that isn't JSON:", line.slice(0, 80));
      }
    }
    for (const e of fresh) this.list.push(e); // no spread: a big file would overflow the call stack
    return fresh;
  }

  private announce(events: LedgerEvent[]) {
    if (!events.length) return;
    const topics = new Set<string>([TOPICS.stats]);
    for (const e of events) {
      topics.add(TOPICS.team(e.team));
      topics.add(TOPICS.agent(e.agent));
    }
    for (const t of topics) this.bus.emit(t);
  }
}
