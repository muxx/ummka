import { beforeEach, expect, expectTypeOf, test, vi } from "vitest";
import { listInstallations } from "./installation-registry.ts";
import { getCurrentAccountId } from "./native-rest.ts";
import {
  type PendingChannelsLink,
  resumeChannelsLink,
  routeChannelsLink,
} from "./route-channels-link.ts";

vi.mock("./installation-registry.ts", () => ({ listInstallations: vi.fn() }));
vi.mock("./native-rest.ts", () => ({ getCurrentAccountId: vi.fn() }));
const list = vi.mocked(listInstallations);
const current = vi.mocked(getCurrentAccountId);
const root = "https://chat.example.test";
const nested = root + "/Teams/Blue";
const message = "c18xpcpusjd88en1g4j7us31ur";
const user = "Abc01234567890123456789012";
beforeEach(() => {
  list.mockReset();
  current.mockReset();
});

test.each([
  [
    "eng/channels/town-square",
    {
      kind: "conversation",
      team: "eng",
      route: "channels",
      identifier: "town-square",
      postId: null,
    },
  ],
  [
    "eng/messages/%40Ada",
    {
      kind: "conversation",
      team: "eng",
      route: "messages",
      identifier: "@Ada",
      postId: null,
    },
  ],
  [
    "eng/messages/group-room",
    {
      kind: "conversation",
      team: "eng",
      route: "messages",
      identifier: "group-room",
      postId: null,
    },
  ],
  [`eng/pl/${message}`, { kind: "permalink", team: "eng", postId: message }],
  [
    `_redirect/pl/${message}`,
    { kind: "permalink", team: null, postId: message },
  ],
  [
    `eng/threads/${message}`,
    { kind: "threads", team: "eng", threadId: message },
  ],
])(
  "routes %s under the account of the matching installation",
  async (path, fields) => {
    list.mockResolvedValue([root, nested]);
    current.mockResolvedValue(user);
    const result = await routeChannelsLink(`${nested}/${path}`);
    expect(result).toEqual({
      status: "ready",
      userId: user,
      target: { ...fields, serverUrl: nested },
    });
    expect(current).toHaveBeenCalledExactlyOnceWith(nested);
  },
);

test("retains the original target until its own installation has a current account", async () => {
  list.mockResolvedValue([root, nested]);
  current.mockImplementation(async (base) => (base === root ? user : null));
  const pending = await routeChannelsLink(`${nested}/_redirect/pl/${message}`);
  expect(pending).toEqual({
    status: "sign_in_required",
    target: {
      kind: "permalink",
      team: null,
      serverUrl: nested,
      postId: message,
    },
  });
  if (pending?.status !== "sign_in_required")
    throw Error("expected unresolved account");
  expectTypeOf(pending).toEqualTypeOf<PendingChannelsLink>();
  expect(await resumeChannelsLink(pending)).toEqual(pending);
  current.mockResolvedValue(user);
  const ready = await resumeChannelsLink(pending);
  expect(ready).toEqual({
    status: "ready",
    target: pending.target,
    userId: user,
  });
  expect(ready?.target).toBe(pending.target);
  list.mockResolvedValue([root]);
  current.mockClear();
  expect(await resumeChannelsLink(pending)).toBeNull();
  expect(current).not.toHaveBeenCalled();
});

test("preserves unresolved links and storage errors", async () => {
  list.mockResolvedValue([root]);
  for (const href of [
    "relative",
    "https://other.example.test/eng/threads",
    root + "/api/v4/users/me",
  ]) {
    expect(await routeChannelsLink(href)).toBeNull();
  }
  expect(current).not.toHaveBeenCalled();
  const href = `${root}/eng/pl/${message}`;
  current.mockResolvedValue(null);
  const pending = await routeChannelsLink(href);
  if (pending?.status !== "sign_in_required")
    throw Error("expected pending route");
  for (const error of [
    "credential_storage_unavailable",
    "installation_account_conflict",
    "cleartext_denied",
  ]) {
    current.mockRejectedValue(error);
    await expect(routeChannelsLink(href)).rejects.toBe(error);
    await expect(resumeChannelsLink(pending)).rejects.toBe(error);
  }
  current.mockClear();
  list.mockRejectedValue("unsupported_schema");
  await expect(routeChannelsLink(href)).rejects.toBe("unsupported_schema");
  await expect(resumeChannelsLink(pending)).rejects.toBe("unsupported_schema");
  expect(current).not.toHaveBeenCalled();
});
