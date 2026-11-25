import {
  conversationName,
  directPartnerId,
  type indexChannelProfiles,
} from "./channel-profiles.ts";
import type { TeamSidebar } from "./team-sidebar.ts";
import {
  visibleConversationLimit,
  type WorkspacePreferences,
} from "./workspace-preferences.ts";

type Source = TeamSidebar["data"];
type Channel = Source["channels"][number];
type Category = Source["categories"][number];
type Locale = "en" | "ru";
type Context = {
  userId: string;
  preferences: WorkspacePreferences;
  profiles: ReturnType<typeof indexChannelProfiles>;
  locale: Locale;
  compact: boolean;
  unreadOnly?: boolean;
  lastUnread?: { id: string; hadMentions: boolean };
};
const collators = {
  en: new Intl.Collator("en", { numeric: true }),
  ru: new Intl.Collator("ru", { numeric: true }),
};
const captions = {
  en: {
    unread: "Unreads",
    dm: "Direct message",
    favorites: "Favorites",
    channels: "Channels",
    direct_messages: "Direct messages",
  },
  ru: {
    unread: "Непрочитанные",
    dm: "Личное сообщение",
    favorites: "Избранное",
    channels: "Каналы",
    direct_messages: "Личные сообщения",
  },
};

function sidebarRow(c: Channel, selected: string | null, ctx: Context) {
  const crt = ctx.preferences.collapsedThreads;
  const total = crt ? c.totalMsgCountRoot : c.totalMsgCount;
  const read = crt ? c.msgCountRoot : c.msgCount;
  const messages =
    total === null || read === null ? 0 : Math.max(0, total - read);
  const mentions = (crt ? c.mentionCountRoot : c.mentionCount) ?? 0;
  const partner = c.kind === "D" ? directPartnerId(c.name, ctx.userId) : null;
  const person = partner ? ctx.profiles.byId.get(partner) : undefined;
  const name = conversationName(
    c,
    ctx.userId,
    ctx.profiles,
    ctx.preferences.nameFormat,
    ctx.locale,
  );
  const unread = mentions > 0 || (!c.muted && messages > 0);
  return {
    id: c.id,
    kind: c.kind,
    title: name || (c.kind === "D" ? captions[ctx.locale].dm : c.name),
    current: c.id === selected,
    archived: c.deleteAt > 0,
    muted: c.muted,
    unread,
    messages,
    mentions,
    urgent: (c.urgentMentionCount ?? 0) > 0,
    self: partner === ctx.userId,
    bot: person?.isBot ?? false,
    guest: person?.isGuest ?? false,
    deactivated: Boolean(person?.deleteAt),
  };
}
type Row = ReturnType<typeof sidebarRow>;
type Ranked = {
  row: Row;
  shown: boolean;
  autoEligible: boolean;
  viewed: number;
  activity: number;
  unreadActivity: number;
  hasMention: boolean;
  inUnreads: boolean;
};
type Section = {
  id: string;
  kind: string;
  title: string;
  collapsed: boolean;
  muted: boolean;
  rows: Row[];
};

function rank(c: Channel, selected: string | null, ctx: Context): Ranked {
  const row = sidebarRow(c, selected, ctx);
  const prefs = ctx.preferences;
  const partner = c.kind === "D" ? directPartnerId(c.name, ctx.userId) : null;
  const person = partner ? ctx.profiles.byId.get(partner) : undefined;
  const viewed = Math.max(c.lastViewedAt ?? 0, prefs.viewTimes[c.id] ?? 0);
  const shown =
    c.kind === "D"
      ? Boolean(partner && prefs.directShown[partner])
      : c.kind !== "G" || Boolean(prefs.groupShown[c.id]);
  const activity =
    prefs.collapsedThreads && c.lastRootPostAt
      ? c.lastRootPostAt
      : c.lastPostAt;
  return {
    row,
    shown: row.current || row.unread || shown,
    autoEligible:
      row.current ||
      row.unread ||
      c.kind !== "D" ||
      Boolean(person && (person.deleteAt ?? 0) <= viewed),
    activity: Math.max(activity ?? 0, c.createAt ?? 0),
    viewed,
    unreadActivity: Math.max(
      (prefs.collapsedThreads ? c.lastRootPostAt : c.lastPostAt) ?? 0,
      c.createAt ?? 0,
    ),
    hasMention: Boolean(
      c.mentionCount ||
        (ctx.lastUnread?.id === c.id && ctx.lastUnread.hadMentions),
    ),
    inUnreads: row.unread || ctx.lastUnread?.id === c.id,
  };
}

function limitConversations(items: Ranked[], limit: number) {
  const eligible = items.filter((x) => x.autoEligible);
  const required = eligible.filter(
    ({ row }) => row.current || row.unread,
  ).length;
  const budget = Math.max(limit, required);
  if (eligible.length <= budget) return eligible;
  const top = [...eligible].sort(
    (a, b) =>
      Number(b.row.current) - Number(a.row.current) ||
      Number(b.row.unread) - Number(a.row.unread) ||
      b.viewed - a.viewed,
  );
  const keep = new Set(top.slice(0, budget));
  return eligible.filter((x) => keep.has(x));
}

function sectionName(c: Category, locale: Locale) {
  if (
    c.kind === "favorites" ||
    c.kind === "channels" ||
    c.kind === "direct_messages"
  )
    return captions[locale][c.kind];
  return c.displayName;
}

export function visibleSidebar(
  snapshot: {
    data: { channels: readonly Channel[]; categories: readonly Category[] };
    selectedChannel: string | null;
  },
  ctx: Context,
): Section[] {
  const { categories, channels } = snapshot.data;
  const records = new Map<string, Ranked>();
  for (const c of channels) {
    if (c.deleteAt === 0 || c.id === snapshot.selectedChannel)
      records.set(c.id, rank(c, snapshot.selectedChannel, ctx));
  }
  const sections: Section[] = [];
  const { separateUnreads } = ctx.preferences;
  const filter = Boolean(ctx.unreadOnly && !separateUnreads);
  if (separateUnreads || filter) {
    const rows = [...records.values()].filter(
      (v) => v.inUnreads || (filter && v.row.current),
    );
    rows.sort(
      (a, b) =>
        Number(a.row.muted) - Number(b.row.muted) ||
        Number(b.hasMention) - Number(a.hasMention) ||
        b.unreadActivity - a.unreadActivity,
    );
    if (rows.length)
      sections.push({
        id: "unreads",
        kind: "unreads",
        title: captions[ctx.locale].unread,
        muted: false,
        collapsed: false,
        rows: rows.map((v) => v.row),
      });
    if (filter) return sections;
  }
  const compare = collators[ctx.locale].compare;
  const managed = categories
    .filter((c) => c.kind === "managed")
    .sort((a, b) => compare(a.displayName, b.displayName));
  const managedIds = new Set(managed.flatMap((c) => c.channelIds));
  const limit = visibleConversationLimit(ctx.preferences, ctx.compact);
  for (const c of [
    ...managed,
    ...categories.filter((v) => v.kind !== "managed"),
  ]) {
    let items: Ranked[] = [];
    for (const id of c.channelIds) {
      const item = records.get(id);
      if (item?.shown && (c.kind === "managed" || !managedIds.has(id)))
        items.push(item);
    }
    if (c.kind === "direct_messages") items = limitConversations(items, limit);
    if (c.sorting === "recent") items.sort((a, b) => b.activity - a.activity);
    else if (c.sorting === "alpha" || c.sorting === "")
      items.sort(
        (a, b) =>
          Number(a.row.muted) - Number(b.row.muted) ||
          compare(a.row.title, b.row.title),
      );
    const rows = items
      .filter(
        (v) =>
          (!separateUnreads || !v.inUnreads) &&
          (!c.collapsed || v.row.current || v.inUnreads),
      )
      .map((v) => v.row);
    sections.push({
      id: c.id,
      kind: c.kind,
      title: sectionName(c, ctx.locale),
      collapsed: c.collapsed,
      muted: c.muted,
      rows,
    });
  }
  return sections;
}
