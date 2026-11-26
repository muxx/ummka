import assert from "node:assert/strict";
import { accountFollowedThreads } from "../../../src/mattermost/account-followed-threads.ts";
import {
  type Configuration,
  ThreadsApi,
} from "../../../vendor/mattermost/index.js";

export async function checkThreadPageTies(
  session: Configuration,
  teamId: string,
  seed: (
    message: string,
    rootId?: string,
    createAt?: number,
  ) => Promise<{ id: string; create_at: number }>,
  version: string,
) {
  const threads = new ThreadsApi(session);
  const account = accountFollowedThreads(session, (read) => read());
  // The fixture importer preserves a shared timestamp. All list and follow
  // operations use the ordinary member's own authenticated session.
  const at = Date.now();
  const roots = new Set<string>();
  for (const name of ["A", "B"]) {
    const root = await seed(`Tied thread ${name}`, undefined, at - 1);
    const reply = await seed(`Tied reply ${name}`, root.id, at);
    assert.equal(reply.create_at, at);
    assert.equal(
      (
        await threads.startFollowingThread({
          userId: "me",
          teamId,
          threadId: root.id,
        })
      ).status,
      "OK",
    );
    roots.add(root.id);
  }
  const scope = { teamId, unread: false };
  const reference = await account.readFollowedThreads({
    ...scope,
    perPage: 200,
  });
  assert.equal(reference.items[0]?.lastReplyAt, at);
  assert.deepEqual(
    new Set(
      reference.items
        .filter((row) => row.lastReplyAt === at)
        .map((row) => row.id),
    ),
    roots,
  );
  const first = await account.readFollowedThreads({ ...scope, perPage: 1 });
  assert.equal(first.items.length, 1);
  const cursor = first.items[0].id;
  assert.ok(roots.has(cursor));
  assert.equal(first.nextBefore, cursor);
  const older = await account.readFollowedThreads({
    ...scope,
    perPage: 200,
    before: cursor,
  });
  assert.ok(
    older.items.every((row) => row.lastReplyAt < at && !roots.has(row.id)),
  );
  for (const threadId of roots)
    await threads.stopFollowingThread({ userId: "me", teamId, threadId });
  console.log(
    `Mattermost ${version} returned both tied threads together and skipped the tied sibling across a one-row before cursor.`,
  );
}
