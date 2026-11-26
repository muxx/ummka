import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountChannelViews } from "./account-channel-views.ts";

const first = "a".repeat(26);
const second = "b".repeat(26);
const absent = "c".repeat(26);
function fixture(body: unknown, status = 200) {
  const send = vi.fn<typeof fetch>(async () => Response.json(body, { status }));
  const api = accountChannelViews(
    new Configuration({ basePath: "https://example.test/sub", fetchApi: send }),
    (run) => run(),
  );
  return { api, send };
}

test("view sets and clears the server's active channel", async () => {
  const one = fixture({ status: "OK", last_viewed_at_times: { [first]: 0 } });
  expect(await one.api.viewChannel(first)).toEqual({ [first]: 0 });
  const cleared = fixture({ status: "OK", last_viewed_at_times: {} });
  expect(await cleared.api.viewChannel(null)).toEqual({});
  for (const [call, channelId] of [
    [one, first],
    [cleared, ""],
  ] as const) {
    expect(call.send).toHaveBeenCalledTimes(1);
    const [url, init] = call.send.mock.calls[0];
    expect(url).toBe(
      "https://example.test/sub/api/v4/channels/members/me/view",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      channel_id: channelId,
      collapsed_threads_supported: true,
    });
  }
});

test("one category action returns only confirmed channel times", async () => {
  const { api, send } = fixture({
    status: "OK",
    last_viewed_at_times: { [second]: 17 },
  });
  expect(await api.markChannelsRead([first, second, first])).toEqual({
    [second]: 17,
  });
  expect(send).toHaveBeenCalledTimes(1);
  const [url, init] = send.mock.calls[0];
  expect(url).toBe(
    "https://example.test/sub/api/v4/channels/members/me/mark_read",
  );
  expect(JSON.parse(String(init?.body))).toEqual([first, second]);
});

test.each([
  null,
  { status: "fail", last_viewed_at_times: {} },
  { status: "OK" },
  ...[
    null,
    [],
    "ok",
    { [absent]: 7 },
    { [first]: -1 },
    { [first]: 1.5 },
    { [first]: Number.MAX_SAFE_INTEGER + 1 },
    { [first]: "123" },
  ].map((times) => ({ status: "OK", last_viewed_at_times: times })),
])(
  "rejects invalid confirmations instead of marking a channel",
  async (body) => {
    await expect(
      fixture(body).api.markChannelsRead([first, second]),
    ).rejects.toThrow(TypeError);
  },
);

test("refused and unconfirmed requests never become successful empty reads", async () => {
  await expect(
    fixture({ id: "denied" }, 403).api.viewChannel(first),
  ).rejects.toBeInstanceOf(ResponseError);
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), {
    status: 202,
  });
  const send = vi.fn<typeof fetch>(async () => response);
  const api = accountChannelViews(
    new Configuration({ fetchApi: send }),
    (run) => run(),
  );
  await expect(api.viewChannel(first)).rejects.toThrow(TypeError);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
});

test("invalid or cancelled actions never dispatch", async () => {
  const { api, send } = fixture({});
  const cancelled = AbortSignal.abort();
  await expect(api.viewChannel(first, cancelled)).rejects.toThrow();
  await expect(api.markChannelsRead([first], cancelled)).rejects.toThrow();
  await expect(api.viewChannel("")).rejects.toThrow(TypeError);
  for (const ids of [[], [""], [first, "short"], new Array<string>(2)]) {
    await expect(api.markChannelsRead(ids)).rejects.toThrow(TypeError);
  }
  expect(send).not.toHaveBeenCalled();
});

test("the target collection belongs to the request even if the caller changes its list", async () => {
  const ids = [first];
  const { api } = fixture({
    status: "OK",
    last_viewed_at_times: { [second]: 5 },
  });
  const pending = api.markChannelsRead(ids);
  ids[0] = second;
  await expect(pending).rejects.toThrow(TypeError);
});
