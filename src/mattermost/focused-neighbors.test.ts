import { expect, test, vi } from "vitest";
import {
  Configuration,
  FetchError,
  PostsApi,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { readFocusedNeighbors } from "./focused-history.ts";

const target = {
  channelId: "c".repeat(26),
  anchorId: "r".repeat(26),
  collapsedThreads: false,
};

function fixture() {
  const requests: {
    url: URL;
    signal: AbortSignal | null | undefined;
    respond: (response: Response) => void;
  }[] = [];
  const api = new PostsApi(
    new Configuration({
      basePath: "https://example.test/team/chat",
      fetchApi: (input, init) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          requests.push({
            url: new URL(new Request(input).url),
            signal,
            respond: resolve,
          });
        }),
    }),
  );
  return { api, requests };
}

test("both sides start before either answer and preserve their directions", async () => {
  const { api, requests } = fixture();
  const pending = readFocusedNeighbors(api, target);
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  const [after, before] = requests;
  const common = {
    page: "0",
    per_page: "30",
    skipFetchThreads: "false",
    collapsedThreads: "false",
    collapsedThreadsExtended: "false",
  };
  for (const { url } of requests)
    expect(url.pathname).toBe(
      `/team/chat/api/v4/channels/${target.channelId}/posts`,
    );
  expect(Object.fromEntries(after.url.searchParams)).toEqual({
    ...common,
    after: target.anchorId,
  });
  expect(Object.fromEntries(before.url.searchParams)).toEqual({
    ...common,
    before: target.anchorId,
  });
  before.respond(Response.json({ order: ["old"] }));
  after.respond(Response.json({ order: ["new"] }));
  const result = await pending;
  expect(result.after.order).toEqual(["new"]);
  expect(result.before.order).toEqual(["old"]);
});

test("a failed side rejects with the generated HTTP error", async () => {
  const { api, requests } = fixture();
  const result = readFocusedNeighbors(api, {
    ...target,
    perPage: 7,
    collapsedThreads: true,
    skipFetchThreads: true,
    collapsedThreadsExtended: true,
  }).catch((error: unknown) => error);
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  for (const { url } of requests) {
    expect(url.searchParams.get("per_page")).toBe("7");
    expect(url.searchParams.get("skipFetchThreads")).toBe("true");
    expect(url.searchParams.get("collapsedThreads")).toBe("true");
    expect(url.searchParams.get("collapsedThreadsExtended")).toBe("true");
  }
  const denied = Response.json({ message: "private channel" }, { status: 403 });
  requests[0].respond(denied);
  const error = await result;
  expect(error).toBeInstanceOf(ResponseError);
  expect((error as ResponseError).response).toBe(denied);
  requests[1].respond(Response.json({ order: [] }));
});

test("cancellation reaches both in-flight reads and a pre-aborted read sends nothing", async () => {
  const { api, requests } = fixture();
  const controller = new AbortController();
  const result = readFocusedNeighbors(api, target, controller.signal).catch(
    (error: unknown) => error,
  );
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(requests.every(({ signal }) => signal === controller.signal)).toBe(
    true,
  );
  const reason = new Error("Navigation cancelled");
  controller.abort(reason);
  const error = await result;
  expect(error).toBeInstanceOf(FetchError);
  expect((error as FetchError).cause).toBe(reason);
  await expect(
    readFocusedNeighbors(api, target, controller.signal),
  ).rejects.toBe(reason);
  expect(requests).toHaveLength(2);
});

test.each([
  { channelId: "" },
  { anchorId: " " },
  { perPage: 0 },
  { perPage: 1.5 },
  { perPage: Number.NaN },
])("invalid focus or page size sends nothing", async (override) => {
  const { api, requests } = fixture();
  await expect(
    readFocusedNeighbors(api, { ...target, ...override }),
  ).rejects.toThrow();
  expect(requests).toHaveLength(0);
});
