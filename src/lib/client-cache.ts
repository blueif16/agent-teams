/*
 * Stale-while-revalidate for the app's GET JSON endpoints, keyed by URL.
 * Entries live at module level, so a panel that remounts renders what it
 * showed last synchronously, and the last snapshot per key is kept in
 * sessionStorage, so a reload paints it before the network answers.
 * A key revalidates on mount, on window focus, and when the server announces
 * its topic on the one shared EventSource (GET /api/events). Concurrent
 * requests for one key share a fetch.
 * Hand-rolled rather than swr: we'd need custom glue for the storage and the
 * topic stream anyway, and this keeps the dependency list as it is.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

export interface Snapshot<T = unknown> {
  data?: T;
  /** The last fetch failed; `data` stays what it was. */
  error?: string;
}

/** Starts listening for changes (once, on first use): `change(topic)` per change, `refresh()` to revalidate what's on screen. */
export type Listen = (handlers: { change(topic: string): void; refresh(): void }) => void;

export interface ClientCacheOptions {
  fetcher: (key: string) => Promise<unknown>;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  listen?: Listen;
}

interface Entry {
  snap: Snapshot;
  listeners: Set<() => void>;
  topic?: string;
  inflight?: Promise<void>;
  /** A change arrived mid-fetch, so fetch once more when this one lands. */
  again?: boolean;
}

const EMPTY: Snapshot = {};
const PREFIX = "agent-teams:cache:";

export function createClientCache({ fetcher, storage, listen }: ClientCacheOptions) {
  const entries = new Map<string, Entry>();
  let listening = false;

  const entry = (key: string): Entry => {
    let e = entries.get(key);
    if (!e) entries.set(key, (e = { snap: restore(key), listeners: new Set() }));
    return e;
  };

  function restore(key: string): Snapshot {
    try {
      const raw = storage?.getItem(PREFIX + key);
      if (raw) return { data: JSON.parse(raw) };
    } catch {
      // unreadable or blocked storage: start empty
    }
    return EMPTY;
  }

  function publish(key: string, e: Entry, snap: Snapshot) {
    e.snap = snap;
    if (snap.data !== undefined && !snap.error) {
      try {
        storage?.setItem(PREFIX + key, JSON.stringify(snap.data));
      } catch {
        // full or blocked storage: memory still has it
      }
    }
    for (const fn of [...e.listeners]) fn();
  }

  function revalidate(key: string, force = false): Promise<void> {
    const e = entry(key);
    if (e.inflight) {
      // Joining is enough for mount and focus; a change may postdate the request in flight.
      if (force) e.again = true;
      return e.inflight;
    }
    const run = async () => {
      try {
        publish(key, e, { data: await fetcher(key) });
      } catch (err) {
        publish(key, e, { data: e.snap.data, error: (err as Error).message });
      } finally {
        e.inflight = undefined;
        if (e.again) {
          e.again = false;
          void revalidate(key);
        }
      }
    };
    return (e.inflight = run());
  }

  function startListening() {
    if (listening || !listen) return;
    listening = true;
    listen({
      change(topic) {
        for (const [key, e] of entries) if (e.topic === topic && e.listeners.size) void revalidate(key, true);
      },
      refresh() {
        for (const [key, e] of entries) if (e.listeners.size) void revalidate(key);
      },
    });
  }

  return {
    snapshot<T>(key: string): Snapshot<T> {
      return entry(key).snap as Snapshot<T>;
    },
    /** For useSyncExternalStore. `topic` is the server topic whose changes make this key stale. */
    subscribe(key: string, onChange: () => void, topic?: string): () => void {
      const e = entry(key);
      if (topic) e.topic = topic;
      e.listeners.add(onChange);
      startListening();
      return () => {
        e.listeners.delete(onChange);
      };
    },
    revalidate(key: string): Promise<void> {
      return revalidate(key);
    },
    /** Fetch before anything shows it, so the first open is instant too. */
    prefetch(key: string, topic?: string): Promise<void> {
      if (topic) entry(key).topic = topic;
      startListening();
      return revalidate(key);
    },
    /** Apply a change we already know about (a save), without a round trip. Returning undefined changes nothing. */
    mutate<T>(key: string, update: (data: T | undefined) => T | undefined) {
      const e = entry(key);
      const data = update(e.snap.data as T | undefined);
      if (data !== undefined) publish(key, e, { data });
    },
  };
}

export type ClientCache = ReturnType<typeof createClientCache>;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** One EventSource for the whole app; it covers every stats, files, rules, skills, org and messages topic. */
const listenInBrowser: Listen = ({ change, refresh }) => {
  window.addEventListener("focus", refresh);
  const source = new EventSource("/api/events?topics=stats,files,rules,skills,org,messages");
  let opened = false;
  source.onopen = () => {
    // Changes made while the stream was down were missed.
    if (opened) refresh();
    opened = true;
  };
  source.onmessage = (m: MessageEvent<string>) => {
    try {
      const { topic } = JSON.parse(m.data) as { topic?: unknown };
      if (typeof topic === "string") change(topic);
    } catch {
      // not ours
    }
  };
};

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The app's cache. On the server it stays empty: nothing fetches outside effects. */
export const cache = createClientCache({
  fetcher: fetchJson,
  storage: sessionStore(),
  listen: typeof window === "undefined" ? undefined : listenInBrowser,
});

export interface Resource {
  key: string;
  topic: string;
}

export function prefetch({ key, topic }: Resource): Promise<void> {
  return cache.prefetch(key, topic);
}

/**
 * The cached value for `key`, revalidated on mount, on focus and on `topic`
 * changes; `refreshMs` adds a slow safety refresh in case the stream is down.
 */
export function useCached<T>({ key, topic }: Resource, { refreshMs }: { refreshMs?: number } = {}): Snapshot<T> {
  const subscribe = useCallback((onChange: () => void) => cache.subscribe(key, onChange, topic), [key, topic]);
  const snap = useSyncExternalStore(
    subscribe,
    () => cache.snapshot<T>(key),
    () => EMPTY as Snapshot<T>,
  );
  useEffect(() => {
    void cache.revalidate(key);
    if (!refreshMs) return;
    const timer = setInterval(() => void cache.revalidate(key), refreshMs);
    return () => clearInterval(timer);
  }, [key, refreshMs]);
  return snap;
}
