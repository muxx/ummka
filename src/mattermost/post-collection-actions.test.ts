// @vitest-environment node
import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { accountCollectionActions } from "./post-collection-actions.ts";

const id = "p".repeat(26);
const user = "u".repeat(26);
function fixture(actor = user) {
  const fetchApi = vi.fn<typeof fetch>();
  const account = accountCollectionActions(
    new Configuration({ basePath: "https://example.test/mm", fetchApi }),
    actor,
    (write) => write(),
  );
  return { fetchApi, account };
}
test("setting each collection state sends one request for the active account", async () => {
  const { fetchApi, account } = fixture();
  const signal = new AbortController().signal;
  fetchApi.mockImplementation(async () => Response.json({ status: "OK" }));
  await account.setPostSaved(id, true, signal);
  await account.setPostSaved(id, false, signal);
  await account.setPostPinned(id, true, signal);
  await account.setPostPinned(id, false, signal);
  const body = [
    { user_id: user, category: "flagged_post", name: id, value: "true" },
  ];
  const requests = fetchApi.mock.calls.map(([url, init]) => {
    expect(init?.signal).toBe(signal);
    return [
      new URL(String(url)).pathname,
      init?.method,
      init?.body ? JSON.parse(String(init.body)) : null,
    ];
  });
  expect(requests).toEqual([
    ["/mm/api/v4/users/me/preferences", "PUT", body],
    ["/mm/api/v4/users/me/preferences/delete", "POST", body],
    [`/mm/api/v4/posts/${id}/pin`, "POST", null],
    [`/mm/api/v4/posts/${id}/unpin`, "POST", null],
  ]);
});
test("a lost or malformed confirmation propagates and is not retried", async () => {
  const { fetchApi, account } = fixture();
  fetchApi.mockResolvedValueOnce(
    Response.json({ status: "OK" }, { status: 201 }),
  );
  await expect(account.setPostSaved(id, true)).rejects.toThrow(TypeError);
  fetchApi.mockResolvedValueOnce(Response.json({ status: "FAIL" }));
  await expect(account.setPostPinned(id, false)).rejects.toThrow(TypeError);
  fetchApi.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(account.setPostPinned(id, true)).rejects.toBeInstanceOf(
    ResponseError,
  );
  fetchApi.mockRejectedValueOnce(new Error("lost confirmation"));
  await expect(account.setPostSaved(id, false)).rejects.toThrow();
  expect(fetchApi).toHaveBeenCalledTimes(4);
});
test("invalid targets, actors and a pre-cancelled change stay local", async () => {
  const { fetchApi, account } = fixture();
  await expect(account.setPostSaved("short", true)).rejects.toThrow(TypeError);
  await expect(
    account.setPostPinned(id, true, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    account.setPostSaved(id, false, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).not.toHaveBeenCalled();
  const other = fixture("invalid");
  await expect(other.account.setPostSaved(id, true)).rejects.toThrow(TypeError);
  expect(other.fetchApi).not.toHaveBeenCalled();
});
