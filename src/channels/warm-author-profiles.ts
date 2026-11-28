import type { ChannelProfile } from "../mattermost/channel-profiles.ts";

// Two 60-post channel pages and two retained 120-reply thread windows.
const retainedAuthors = 384;

export function createWarmAuthorProfiles() {
  // Null records a server omission or refusal. A saved row cannot replace it.
  const rows = new Map<string, ChannelProfile | null>();
  const active = new Map<object, ReadonlySet<string>>();
  const listeners = new Set<() => void>();
  const reads = new Set<Set<string>>();
  let revision = 0;
  let closed = false;

  function changed() {
    revision++;
    for (const listener of listeners) listener();
  }

  function trim() {
    if (rows.size <= retainedAuthors) return false;
    const views = [...active.values()];
    const dormant = [...rows.keys()].filter(
      (id) => !views.some((ids) => ids.has(id)),
    );
    const excess = dormant.length - retainedAuthors;
    if (excess <= 0) return false;
    for (const id of dormant.slice(0, excess)) rows.delete(id);
    return true;
  }

  return {
    pin(owner: object, ids: readonly string[]) {
      if (ids.length) active.set(owner, new Set(ids));
      else active.delete(owner);
      if (trim()) changed();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select(ids: readonly string[]) {
      let seen = -1;
      let selected = new Map<string, ChannelProfile>();
      return () => {
        if (seen !== revision) {
          seen = revision;
          const next = new Map<string, ChannelProfile>();
          for (const id of ids) {
            const row = rows.get(id);
            if (row) next.set(id, row);
          }
          if (
            next.size !== selected.size ||
            [...next].some(([id, row]) => selected.get(id) !== row)
          )
            selected = next;
        }
        return selected;
      };
    },
    refused(id: string) {
      return rows.get(id) === null;
    },
    begin(ids: readonly string[]) {
      const pending = new Set(ids);
      if (!closed) reads.add(pending);
      return {
        publish(
          observed: Iterable<string>,
          profile: (id: string) => ChannelProfile | undefined,
          source: "saved" | "server",
        ) {
          if (!reads.has(pending)) return;
          const applied: string[] = [];
          let replaced = false;
          for (const id of observed) {
            if (!pending.has(id)) continue;
            const prior = rows.get(id);
            if (prior === null && source === "saved") continue;
            const next =
              profile(id) ?? (source === "server" ? null : undefined);
            rows.delete(id);
            if (next !== undefined) rows.set(id, next);
            replaced ||= next !== prior;
            applied.push(id);
          }
          // A newer accepted reading fences only its overlapping IDs, even
          // if one of those entries is later evicted before an old read ends.
          for (const earlier of reads) {
            if (earlier === pending) break;
            for (const id of applied) earlier.delete(id);
          }
          const evicted = trim();
          if (replaced || evicted) changed();
        },
        stop() {
          reads.delete(pending);
        },
      };
    },
    close() {
      closed = true;
      reads.clear();
      rows.clear();
      changed();
    },
  };
}
