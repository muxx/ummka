// @vitest-environment node
import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  Configuration,
  JSONApiResponse,
  ResponseError,
  ThreadsApi,
} from "../../vendor/mattermost/index.js";
import { openAccountRestConnection } from "./native-rest.ts";
import { setThreadFollowing } from "./thread-following.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

const teamId = "t".repeat(26);
const root = { id: "r".repeat(26), rootId: null };
const reply = { id: "s".repeat(26), rootId: root.id };
function fixture() {
  const fetchApi = vi.fn<typeof fetch>();
  const threads = new ThreadsApi(
    new Configuration({
      basePath: "https://example.test/chat",
      fetchApi,
    }),
  );
  return { fetchApi, threads };
}

test("roots and replies address the same personal subscription under the installation prefix", async () => {
  const { fetchApi, threads } = fixture();
  const signal = new AbortController().signal;
  fetchApi.mockImplementation(async () => Response.json({ status: "OK" }));
  await setThreadFollowing(threads, teamId, root, true, signal);
  await setThreadFollowing(threads, teamId, reply, false, signal);
  expect(
    fetchApi.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      init?.body,
      init?.signal,
    ]),
  ).toEqual(
    ["PUT", "DELETE"].map((method) => [
      `https://example.test/chat/api/v4/users/me/teams/${teamId}/threads/${root.id}/following`,
      method,
      undefined,
      signal,
    ]),
  );
});

test("invalid or cancelled selections issue no requests", async () => {
  const { fetchApi, threads } = fixture();
  for (const post of [
    { ...root, id: "bad" },
    { ...root, rootId: "" },
    { ...reply, rootId: "bad" },
    { ...root, rootId: root.id },
  ]) {
    await expect(
      setThreadFollowing(threads, teamId, post, true),
    ).rejects.toThrow(TypeError);
  }
  await expect(setThreadFollowing(threads, "bad", root, true)).rejects.toThrow(
    TypeError,
  );
  await expect(
    setThreadFollowing(threads, teamId, root, false, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).not.toHaveBeenCalled();
});

test("only HTTP 200 with OK confirms the change and a denial stays a denial", async () => {
  const { fetchApi, threads } = fixture();
  for (const response of [
    Response.json({ status: "OK" }, { status: 202 }),
    Response.json({}),
    Response.json({ status: "pending" }),
  ]) {
    fetchApi.mockResolvedValueOnce(response);
    await expect(
      setThreadFollowing(threads, teamId, root, true),
    ).rejects.toThrow(TypeError);
  }
  fetchApi.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(
    setThreadFollowing(threads, teamId, reply, false),
  ).rejects.toBeInstanceOf(ResponseError);
  expect(fetchApi).toHaveBeenCalledTimes(4);
});

test.each(["close", "abort"] as const)(
  "discards a late acknowledgement after %s",
  async (action) => {
    vi.mocked(invoke).mockResolvedValueOnce(17);
    const account = await openAccountRestConnection(
      "https://example.test/chat",
      "u".repeat(26),
    );
    const signal = new AbortController();
    type Reply = JSONApiResponse<{ status: string }>;
    let acknowledge!: (reply: Reply) => void;
    const held = new Promise<Reply>((resolve) => {
      acknowledge = resolve;
    });
    const send = vi
      .spyOn(ThreadsApi.prototype, "stopFollowingThreadRaw")
      .mockReturnValueOnce(held);
    const change = account.setThreadFollowing(
      teamId,
      reply,
      false,
      signal.signal,
    );
    expect(send).toHaveBeenCalledExactlyOnceWith(
      { teamId, userId: "me", threadId: root.id },
      { signal: signal.signal },
    );
    if (action === "close") await account.close();
    else signal.abort(new Error("left thread"));
    acknowledge(new JSONApiResponse(Response.json({ status: "OK" })));
    await expect(change).rejects.toBe(
      action === "close" ? "cancelled" : signal.signal.reason,
    );
  },
);
