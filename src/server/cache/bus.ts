/*
 * The cache's change bus. A change names a topic and carries its version
 * number, never the data: listeners re-read what they need from the cache.
 *
 * Topics nest with ":", and a subscription hears its topic and every topic
 * under it, so one stream can follow a whole family:
 *   stats              any ledger change
 *   stats:team:<id>    a change to one team's stats
 *   stats:agent:<id>   a change to one agent's stats
 *   files:agent:<id>   one of an agent's Markdown files changed
 *   skills             the skill library changed (skills/index.json or a vendored file)
 *   config             never sent: code and .env.local change only with a restart, and a client
 *                      revalidates what it shows when its stream reconnects
 */
export interface Change {
  topic: string;
  /** Counts this topic's changes since the server started. */
  version: number;
}

type Listener = (change: Change) => void;

export const covers = (subscribed: string, topic: string) => topic === subscribed || topic.startsWith(`${subscribed}:`);

export const TOPICS = {
  stats: "stats",
  team: (id: string) => `stats:team:${id}`,
  agent: (id: string) => `stats:agent:${id}`,
  files: (id: string) => `files:agent:${id}`,
  skills: "skills",
};

export class Bus {
  private readonly versions = new Map<string, number>();
  private readonly subs = new Set<{ topics: string[]; fn: Listener }>();

  /** Hear changes to `topics` and the topics under them. Returns the unsubscribe. */
  subscribe(topics: string[], fn: Listener): () => void {
    const sub = { topics, fn };
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  /** Bump `topic`'s version and tell everyone who follows it. */
  emit(topic: string): number {
    const version = (this.versions.get(topic) ?? 0) + 1;
    this.versions.set(topic, version);
    for (const sub of [...this.subs]) {
      if (!sub.topics.some((t) => covers(t, topic))) continue;
      try {
        sub.fn({ topic, version });
      } catch (e) {
        // One broken listener mustn't stop the others, or the write that emitted.
        console.warn(`A ${topic} listener failed:`, (e as Error).message);
      }
    }
    return version;
  }

  listenerCount(): number {
    return this.subs.size;
  }
}
