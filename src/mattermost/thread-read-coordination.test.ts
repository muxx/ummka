import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountFollowedThreads } from "./account-followed-threads.ts";
import type { NativeRequestInit } from "./native-fetch.ts";
import { createThreadReadCoordination } from "./thread-read-coordination.ts";

const user = "u".repeat(26);
const channel = "c".repeat(26);
const root = "r".repeat(26);
const reply = "p".repeat(26);
const team = "t".repeat(26);
const otherTeam = "x".repeat(26);
const target = { teamId: team, channelId: channel, rootId: root };
const server = "https://fixture.test/chat";
const read = { kind: "read" } as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const writes: { method: string; path: string }[] = [];
  const request =
    vi.fn<(method: string, requestPath: string) => Promise<Response>>();
  let gate: Promise<void> | undefined;
  let lastViewedAt = 20;
  let unread = true;
  function receipt(id: string) {
    return Response.json({
      id,
      last_viewed_at: lastViewedAt,
      unread_replies: Number(unread),
      unread_mentions: 0,
      delete_at: 0,
      post: { id, channel_id: channel, root_id: "", delete_at: 0 },
    });
  }
  request.mockImplementation(async (method, path) => {
    const tail = path.split("/threads/")[1];
    const [id, _operation, value] = tail.split("/");
    if (method === "PUT") {
      lastViewedAt = Number(value);
      unread = false;
    } else if (method === "POST") {
      lastViewedAt = 20;
      unread = true;
    }
    return receipt(id);
  });
  const fetchApi = vi.fn<typeof fetch>(
    async (input, init?: NativeRequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        if (gate) await gate;
        init?.signal?.throwIfAborted();
        init?.onNativeSend?.();
        writes.push({ method, path });
      }
      return request(method, path);
    },
  );
  const connection = accountFollowedThreads(
    new Configuration({ basePath: server, fetchApi }),
    (run) => run(),
  );
  const coordination = createThreadReadCoordination();
  const account = coordination.bind(server, user, connection);
  return {
    fetchApi,
    request,
    writes,
    connection,
    coordination,
    account,
    visit: account.visit(target),
    holdPreparation(value: Promise<void>) {
      gate = value;
    },
    applyRead(at: number) {
      lastViewedAt = at;
      unread = false;
      return receipt(root);
    },
  };
}

function unreadCommand() {
  return {
    kind: "unread" as const,
    lastPost: vi.fn(async () => ({ id: reply, rootId: root })),
  };
}

function observer() {
  return new AbortController();
}

async function sent(proof: ReturnType<typeof fixture>, count: number) {
  await vi.waitFor(() => expect(proof.writes).toHaveLength(count));
}

function timestamp(proof: ReturnType<typeof fixture>) {
  return Number(proof.writes[0].path.split("/").at(-1));
}

test("waits for a sent automatic PUT, then resolves the last reply and writes once even after the panel leaves", async () => {
  const proof = fixture();
  const response = deferred<Response>();
  proof.request.mockReturnValueOnce(response.promise);
  const panel = observer();
  const auto = proof.visit.auto(panel.signal);
  await sent(proof, 1);
  const command = unreadCommand();
  const manual = proof.visit.manual(command);
  expect(await proof.visit.manual(command)).toMatchObject({
    kind: "not-sent",
    reason: "busy",
  });
  expect(command.lastPost).not.toHaveBeenCalled();
  panel.abort();
  const elsewhere = proof.account.visit({ ...target, rootId: "k".repeat(26) });
  expect(await elsewhere.manual(read)).toMatchObject({ kind: "confirmed" });
  expect(proof.writes.map(({ method }) => method)).toEqual(["PUT", "PUT"]);
  response.resolve(proof.applyRead(timestamp(proof)));
  expect(await auto).toMatchObject({ kind: "confirmed" });
  expect(await manual).toMatchObject({
    kind: "confirmed",
    mark: { unreadReplies: 1 },
  });
  expect(command.lastPost).toHaveBeenCalledOnce();
  expect(proof.writes[2]).toEqual({
    method: "POST",
    path: `/chat/api/v4/users/me/teams/${team}/threads/${root}/set_unread/${reply}`,
  });
});

test("an observation cannot release a lost auto PUT, even if the old write applies after that GET", async () => {
  const proof = fixture();
  const response = deferred<Response>();
  proof.request.mockReturnValueOnce(response.promise);
  const auto = proof.visit.auto(observer().signal);
  await sent(proof, 1);
  const pending = proof.visit.manual(unreadCommand());
  response.reject(Error("lost response"));
  const unknown = await auto;
  expect(unknown).toMatchObject({
    kind: "unknown",
    attempt: { action: "auto" },
  });
  expect(await pending).toMatchObject({
    kind: "not-sent",
    reason: "previous-unknown",
    previous: { action: "auto" },
  });
  expect((await proof.visit.observe()).unreadReplies).toBe(1);
  proof.applyRead(timestamp(proof));
  expect((await proof.visit.observe()).unreadReplies).toBe(0);
  expect(await proof.visit.auto(observer().signal)).toMatchObject({
    kind: "not-sent",
    reason: "previous-unknown",
  });
  expect(await proof.visit.manual(read)).toMatchObject({
    kind: "not-sent",
    reason: "previous-unknown",
  });
  expect(proof.writes).toHaveLength(1);
  expect(proof.request.mock.calls.map(([method]) => method)).toEqual([
    "PUT",
    "GET",
    "GET",
  ]);
  const token = proof.visit.getUncertainty();
  expect(await proof.visit.manual(unreadCommand(), token)).toMatchObject({
    kind: "confirmed",
  });
  expect(await proof.visit.manual(read, token)).toMatchObject({
    kind: "not-sent",
    reason: "previous-unknown",
  });
  expect(proof.writes.map(({ method }) => method)).toEqual(["PUT", "POST"]);
});

test.each([400, 404, 500])(
  "a manual POST with HTTP %s leaves this manual write uncertain",
  async (status) => {
    const proof = fixture();
    proof.request.mockResolvedValueOnce(
      Response.json({ status_code: status }, { status }),
    );
    const outcome = await proof.visit.manual(unreadCommand());
    expect(outcome).toMatchObject({
      kind: "unknown",
      attempt: { action: "unread" },
    });
    if (outcome.kind !== "unknown")
      throw new Error("Expected an unconfirmed write");
    expect(outcome.error).toBeInstanceOf(ResponseError);
    expect(proof.writes.map(({ method }) => method)).toEqual(["POST"]);
  },
);

test("a malformed receipt is uncertain rather than an invitation to retry the write", async () => {
  const proof = fixture();
  proof.request.mockResolvedValueOnce(Response.json({ id: root }));
  const outcome = await proof.visit.manual(read);
  expect(outcome).toMatchObject({
    kind: "unknown",
    attempt: { action: "read" },
  });
  expect(await proof.visit.auto(observer().signal)).toMatchObject({
    kind: "not-sent",
    reason: "previous-unknown",
  });
  expect(proof.writes).toHaveLength(1);
});

test("a late GET cannot publish a snapshot fetched before a new mark", async () => {
  const proof = fixture();
  const response = deferred<Response>();
  proof.request.mockReturnValueOnce(response.promise);
  const observation = proof.visit.observe();
  const failure = expect(observation).rejects.toThrow("superseded");
  await vi.waitFor(() => expect(proof.request).toHaveBeenCalledOnce());
  expect(await proof.visit.manual(read)).toMatchObject({ kind: "confirmed" });
  response.resolve(proof.applyRead(20));
  await failure;
  expect(proof.request.mock.calls.map(([method]) => method)).toEqual([
    "GET",
    "PUT",
  ]);
});

test("closed RIDs leave sent writes uncertain, ignore late replies, and isolate account and installation keys", async () => {
  const proof = fixture();
  const response = deferred<Response>();
  proof.request.mockReturnValueOnce(response.promise);
  const auto = proof.visit.auto(observer().signal);
  await sent(proof, 1);
  const pending = proof.visit.manual(read);
  proof.account.close();
  const afterRestore = proof.coordination.bind(
    `${server}/`,
    user,
    proof.connection,
  );
  const visit = afterRestore.visit({ ...target, teamId: otherTeam });
  expect(await auto).toMatchObject({
    kind: "unknown",
    attempt: { action: "auto" },
  });
  expect(await pending).toMatchObject({
    kind: "not-sent",
    reason: "cancelled",
  });
  response.resolve(proof.applyRead(timestamp(proof)));
  expect(await visit.auto(observer().signal)).toMatchObject({
    kind: "not-sent",
    reason: "previous-unknown",
  });
  expect(visit.getUncertainty()?.action).toBe("auto");
  for (const [address, identity] of [
    [`${server}/other`, user],
    [server, "v".repeat(26)],
  ]) {
    expect(
      await proof.coordination
        .bind(address, identity, proof.connection)
        .visit(target)
        .manual(read),
    ).toMatchObject({ kind: "confirmed" });
  }
  expect(proof.writes.map(({ method }) => method)).toEqual([
    "PUT",
    "PUT",
    "PUT",
  ]);
});

test("reopening a direct thread through a different team cancels the prior waiting manual choice", async () => {
  const proof = fixture();
  const response = deferred<Response>();
  proof.request.mockReturnValueOnce(response.promise);
  const auto = proof.visit.auto(observer().signal);
  await sent(proof, 1);
  const pending = proof.visit.manual(unreadCommand());
  const reopened = proof.account.visit({ ...target, teamId: otherTeam });
  expect(await pending).toMatchObject({
    kind: "not-sent",
    reason: "cancelled",
  });
  const manual = reopened.manual(read);
  expect(proof.writes).toHaveLength(1);
  response.resolve(proof.applyRead(timestamp(proof)));
  expect(await auto).toMatchObject({ kind: "confirmed" });
  expect(await manual).toMatchObject({ kind: "confirmed" });
  expect(proof.writes[1].path).toContain(
    `/teams/${otherTeam}/threads/${root}/`,
  );
});

test("manual admission cancels an auto before dispatch, and empty or forbidden preflight never writes", async () => {
  const proof = fixture();
  const preparation = deferred<void>();
  proof.holdPreparation(preparation.promise);
  const auto = proof.visit.auto(observer().signal);
  await vi.waitFor(() => expect(proof.fetchApi).toHaveBeenCalledOnce());
  expect(proof.writes).toHaveLength(0);
  const manual = proof.visit.manual(unreadCommand());
  expect(await auto).toMatchObject({ kind: "not-sent", reason: "cancelled" });
  preparation.resolve();
  expect(await manual).toMatchObject({ kind: "confirmed" });
  expect(proof.writes.map(({ method }) => method)).toEqual(["POST"]);
  expect(
    await proof.visit.manual({ kind: "unread", lastPost: async () => null }),
  ).toMatchObject({ kind: "not-sent", reason: "empty" });
  expect(
    await proof.visit.manual({
      kind: "unread",
      async lastPost() {
        throw new ResponseError(new Response(null, { status: 403 }));
      },
    }),
  ).toMatchObject({ kind: "not-sent", reason: "access" });
  expect(proof.writes).toHaveLength(1);
});

test("a definite permission refusal drops the waiting manual write", async () => {
  const proof = fixture();
  const response = deferred<Response>();
  proof.request.mockReturnValueOnce(response.promise);
  const auto = proof.visit.auto(observer().signal);
  await sent(proof, 1);
  const pending = proof.visit.manual(unreadCommand());
  response.resolve(Response.json({ status_code: 403 }, { status: 403 }));
  expect(await auto).toMatchObject({ kind: "refused" });
  expect(await pending).toMatchObject({ kind: "not-sent", reason: "access" });
  expect(proof.visit.getUncertainty()).toBeUndefined();
  expect(proof.writes).toHaveLength(1);
});

test("a dispatched exchange has a deadline even when the transport never resolves", async () => {
  const proof = fixture();
  const deadline = createThreadReadCoordination(5);
  const visit = deadline.bind(server, user, proof.connection).visit(target);
  proof.request.mockReturnValueOnce(new Promise(() => {}));
  const mark = await visit.auto(observer().signal);
  expect(mark).toMatchObject({ kind: "unknown", attempt: { action: "auto" } });
  expect(proof.writes).toHaveLength(1);
});
