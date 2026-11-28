import { expect, test } from "vitest";
import { channelProfile } from "../mattermost/channel-profiles.ts";
import { createWarmAuthorProfiles } from "./warm-author-profiles.ts";

const profile = (number: number) =>
  channelProfile({
    id: String(number).padStart(26, "0"),
    username: `author${number}`,
  });
const a = profile(1);
const b = profile(2);

test("keeps only 384 dormant IDs alongside the currently requested authors", () => {
  const store = createWarmAuthorProfiles();
  const owner = {};
  store.pin(owner, [a.id]);
  const receipt = {};
  const verified = store.begin([a.id]);
  verified.publish([a.id], () => a, "server", receipt);
  verified.stop();
  const observed = Array.from({ length: 430 }, (_, i) => profile(i + 1));
  for (const row of observed) {
    const read = store.begin([row.id]);
    read.publish([row.id], () => row, "saved");
    read.stop();
  }
  const select = store.select(observed.map(({ id }) => id));
  expect(select().size).toBe(385);
  expect(select().has(a.id)).toBe(true);
  expect(select().has(b.id)).toBe(false);
  expect(store.verified(a.id, receipt)).toBe(true);
  store.pin(owner, []);
  expect(select().size).toBe(384);
  expect(select().has(a.id)).toBe(false);
  expect(store.verified(a.id, receipt)).toBe(false);
});

test("blocks late overlapping observations even after the refusal entry is evicted", () => {
  const store = createWarmAuthorProfiles();
  const older = store.begin([a.id, b.id]);
  const denied = store.begin([a.id]);
  denied.publish([a.id], () => undefined, "server");
  denied.stop();
  const fromStorage = store.begin([a.id]);
  fromStorage.publish([a.id], () => a, "saved");
  fromStorage.stop();
  expect(store.select([a.id])().get(a.id)).toBeNull();
  const other = Array.from({ length: 384 }, (_, i) => profile(i + 3));
  const indexed = new Map(other.map((row) => [row.id, row]));
  const unrelated = store.begin([...indexed.keys()]);
  unrelated.publish(indexed.keys(), (id) => indexed.get(id), "saved");
  unrelated.stop();
  expect(store.select([a.id])().has(a.id)).toBe(false);
  older.publish([a.id, b.id], (id) => (id === a.id ? a : b), "saved");
  older.stop();
  expect([...store.select([a.id, b.id])().keys()]).toEqual([b.id]);
});

test("updates only the common ID and ignores an abandoned or retired observation", () => {
  const store = createWarmAuthorProfiles();
  const older = store.begin([a.id, b.id]);
  const newer = store.begin([a.id]);
  const renamed = { ...a, firstName: "New", isBot: true, isGuest: true };
  newer.publish([a.id], () => renamed, "saved");
  newer.stop();
  older.publish([a.id, b.id], (id) => (id === a.id ? a : b), "saved");
  expect(store.select([a.id, b.id])().get(a.id)).toBe(renamed);
  older.stop();
  older.publish([b.id], () => undefined, "server");
  expect(store.select([b.id])().get(b.id)).toBe(b);
  const retired = store.begin([a.id]);
  store.close();
  retired.publish([a.id], () => a, "server");
  expect([...store.select([a.id, b.id])().values()]).toEqual([null, null]);
});

test.each([false, true])(
  "orders an older server refusal after a newer local read (server confirmed: %s)",
  (confirmed) => {
    const store = createWarmAuthorProfiles();
    const older = store.begin([a.id, b.id]);
    const newer = store.begin([b.id]);
    newer.publish([b.id], () => b, "saved");
    if (confirmed) newer.publish([b.id], () => b, "server");
    newer.stop();
    older.publish([a.id, b.id], () => undefined, "server");
    const shown = store.select([a.id, b.id])();
    expect(shown.get(a.id)).toBeNull();
    expect(shown.get(b.id)).toBe(confirmed ? b : null);
  },
);

test("a pending SQLite read can supply a strictly newer version after a positive server response", () => {
  const store = createWarmAuthorProfiles();
  const saved = store.begin([a.id]);
  const server = store.begin([a.id]);
  const old = { ...a, updateAt: 1, firstName: "Visible" };
  const hidden = { ...old, firstName: "" };
  server.publish([a.id], () => hidden, "server");
  server.stop();
  saved.publish([a.id], () => old, "saved");
  expect(store.select([a.id])().get(a.id)).toBe(hidden);
  const revised = { ...old, updateAt: 2 };
  saved.publish([a.id], () => revised, "saved");
  expect(store.select([a.id])().get(a.id)).toBe(revised);
});
