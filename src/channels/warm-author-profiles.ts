import type { ChannelProfile } from "../mattermost/channel-profiles.ts";

// Two 60-post channel pages and two retained 120-reply thread windows.
const retainedProfiles = 384;
type Source = "saved" | "server";
type Entry = {
  profile: ChannelProfile;
  source: Source;
  verifiedBy: WeakSet<object>;
};

function strictlyNewer(first: ChannelProfile, second: ChannelProfile) {
  return (
    first.updateAt !== null &&
    second.updateAt !== null &&
    first.updateAt > second.updateAt
  );
}

export function createWarmAuthorProfiles() {
  // Null records a server omission or refusal. A saved row cannot replace it.
  const rows = new Map<string, Entry | null>();
  const active = new Map<object, ReadonlySet<string>>();
  const listeners = new Set<() => void>();
  const reads = new Set<{ saved: Map<string, boolean>; server: Set<string> }>();
  let revision = 0;
  let closed = false;

  function changed() {
    revision++;
    for (const listener of listeners) listener();
  }

  function trim() {
    if (rows.size <= retainedProfiles) return false;
    const views = [...active.values()];
    const dormant = [...rows.keys()].filter(
      (id) => !views.some((ids) => ids.has(id)),
    );
    const excess = dormant.length - retainedProfiles;
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
      let selected = new Map<string, ChannelProfile | null>();
      return () => {
        if (seen !== revision) {
          seen = revision;
          const next = new Map<string, ChannelProfile | null>();
          for (const id of ids) {
            const entry = closed ? null : rows.get(id);
            if (entry !== undefined) next.set(id, entry?.profile ?? null);
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
    verified(id: string, receipt: object) {
      return rows.get(id)?.verifiedBy.has(receipt) === true;
    },
    begin(ids: readonly string[]) {
      const pending = {
        saved: new Map(ids.map((id) => [id, false])),
        server: new Set(ids),
      };
      if (!closed) reads.add(pending);
      return {
        publish(
          observed: Iterable<string>,
          profile: (id: string) => ChannelProfile | undefined,
          source: Source,
          receipt?: object,
        ) {
          if (!reads.has(pending)) return;
          const applied = new Map<string, boolean>();
          let replaced = false;
          for (const id of observed) {
            if (!pending[source].has(id)) continue;
            const prior = rows.get(id);
            if (source === "saved" && prior === null) continue;
            const candidate = profile(id);
            if (
              source === "saved" &&
              pending.saved.get(id) &&
              (!candidate || !prior || !strictlyNewer(candidate, prior.profile))
            )
              continue;
            let next: Entry | null | undefined;
            if (candidate) {
              if (
                source === "saved" &&
                prior &&
                ((candidate.updateAt === null &&
                  prior.profile.updateAt !== null) ||
                  strictlyNewer(prior.profile, candidate) ||
                  (prior.source === "server" &&
                    !strictlyNewer(candidate, prior.profile)))
              )
                continue;
              const verifiedBy = prior?.verifiedBy ?? new WeakSet<object>();
              next =
                prior && strictlyNewer(prior.profile, candidate)
                  ? prior
                  : { profile: candidate, source, verifiedBy };
              if (receipt) verifiedBy.add(receipt);
            } else if (source === "server") next = null;
            rows.delete(id);
            if (next !== undefined) rows.set(id, next);
            replaced ||= (next?.profile ?? next) !== (prior?.profile ?? prior);
            applied.set(id, candidate !== undefined);
          }
          // Positive observations leave older SQLite reads eligible to supply
          // a strictly newer version. Absence suppresses both sources.
          for (const earlier of reads) {
            if (earlier === pending) break;
            for (const [id, found] of applied) {
              if (!found) earlier.saved.delete(id);
              else if (earlier.saved.has(id)) earlier.saved.set(id, true);
              if (source === "server" || !found) earlier.server.delete(id);
            }
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
