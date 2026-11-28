import { type ChannelProfile, directPartnerId } from "./channel-profiles.ts";
import { conversationRow } from "./sidebar-rows.ts";
import type { TeamSidebar } from "./team-sidebar.ts";

type Context = Parameters<typeof conversationRow>[2];
type Channel = TeamSidebar["data"]["channels"][number];
type Row = ReturnType<typeof conversationRow>;
const recentLimit = 8;
const resultLimit = 14;

function fold(text: string) {
  return text.toLowerCase().replaceAll("ё", "е");
}

export function knownConversationTerm(text: string) {
  return fold(text.trim()).replace(/^[#~@]/, "");
}

export function conversationTitleMatch(
  title: string,
  term: string,
): [number, number] | null {
  if (!term) return null;
  const folded = fold(title);
  const start = folded.indexOf(term);
  if (start < 0) return null;
  const end = start + term.length;
  if (folded.length === title.length) return [start, end];

  // Case folding can expand a character (İ → i plus combining dot).
  // Return offsets into the original title for rendering the highlight.
  let original = 0,
    offset = 0,
    from = 0;
  for (const character of title) {
    const next = offset + fold(character).length;
    if (offset <= start && start < next) from = original;
    original += character.length;
    if (end <= next) return [from, original];
    offset = next;
  }
  return null;
}

function profileNames(person: ChannelProfile) {
  return [
    person.username,
    person.remoteUsername,
    person.nickname,
    [person.firstName, person.lastName].filter(Boolean).join(" "),
  ];
}

function searchNames(channel: Channel, title: string, ctx: Context) {
  if (channel.kind === "D") {
    const peer = directPartnerId(channel.name, ctx.userId);
    const profile = peer ? ctx.profiles.byId.get(peer) : undefined;
    return profile ? [title, ...profileNames(profile)] : [];
  }
  if (channel.kind !== "G") return [title, channel.name];

  if (!channel.displayName || channel.displayName === channel.name) return [];
  const names = [title];
  for (const username of channel.displayName.split(", ")) {
    names.push(username);
    const person = ctx.profiles.byUsername.get(username);
    if (person) names.push(...profileNames(person));
  }
  return names.filter((name) => name !== channel.name);
}

// Prepare human-readable keys once for each change to the team's saved data.
export function prepareKnownConversationSearch(
  snapshot: TeamSidebar,
  ctx: Context,
  recentChannelIds: readonly string[],
) {
  const compare = new Intl.Collator(ctx.locale, { numeric: true }).compare;
  const entries = snapshot.data.channels.map((channel) => {
    const row = conversationRow(channel, snapshot.selectedChannel, ctx);
    const names = searchNames(channel, row.title, ctx);
    return {
      row,
      keys: [...new Set(names.filter(Boolean).map(fold))],
      viewed: Math.max(
        channel.lastViewedAt ?? 0,
        ctx.preferences.viewTimes[channel.id] ?? 0,
      ),
    };
  });
  entries.sort(
    (a, b) =>
      b.viewed - a.viewed ||
      compare(a.row.title, b.row.title) ||
      (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0),
  );

  const rows = new Map(entries.map(({ row }) => [row.id, row]));
  const recent = new Set<Row>();
  for (const id of [snapshot.selectedChannel, ...recentChannelIds]) {
    const row = id && rows.get(id);
    if (row) recent.add(row);
    if (recent.size === recentLimit) break;
  }
  for (const { row, viewed } of entries) {
    if (recent.size === recentLimit || !viewed) break;
    recent.add(row);
  }

  return (text: string): readonly Row[] => {
    const term = knownConversationTerm(text);
    if (!term) return [...recent];

    // Active prefix, active substring, archived prefix, archived substring.
    const groups: Row[][] = [[], [], [], []];
    for (const { row, keys } of entries) {
      const prefix = keys.some((key) => key.startsWith(term));
      if (!prefix && !keys.some((key) => key.includes(term))) continue;
      const group = groups[(row.archived ? 2 : 0) + (prefix ? 0 : 1)];
      if (group.length < resultLimit) group.push(row);
      if (groups[0].length === resultLimit) break;
    }
    return groups.flat().slice(0, resultLimit);
  };
}
