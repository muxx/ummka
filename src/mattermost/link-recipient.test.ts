import { invoke } from "@tauri-apps/api/core";
import { afterEach, expect, test, vi } from "vitest";
import {
  Configuration,
  FetchError,
  ResponseError,
  UsersApi,
} from "../../vendor/mattermost/index.js";
import { channelProfile } from "./channel-profiles.ts";
import {
  type ConversationRecipientTarget,
  readConversationRecipient,
} from "./link-recipient.ts";
import {
  openAccountRestConnection,
  openNativeRestConnection,
} from "./native-rest.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
});
const basePath = "https://example.test/work";
const id = "a".repeat(26);
const name = "alex:remote";
const email = "alex+dm?#%42@example.test";
const row = {
  id,
  username: name,
  email,
  remote_id: "r".repeat(26),
  props: { RemoteUsername: "alex" },
  delete_at: 2,
};
const known = channelProfile({ id, username: name });
const saved = () =>
  Promise.resolve({ usernames: { [name]: id }, profiles: { [id]: known } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(body: unknown = row, status = 200) {
  const fetchApi = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  );
  return {
    users: new UsersApi(new Configuration({ basePath, fetchApi })),
    fetchApi,
  };
}
test.each([
  [{ kind: "user-id", id }, id],
  [{ kind: "username", name }, id],
  [{ kind: "email", email }, "email/alex%2Bdm%3F%23%2542%40example.test"],
] as const)(
  "one exact read for %o projects the same profile, including deactivation",
  async (target, suffix) => {
    const { users, fetchApi } = fixture();
    const local = vi.fn(saved);
    const result = await readConversationRecipient(users, target, local);
    expect(result).toMatchObject({
      id,
      username: name,
      remoteUsername: "alex",
      deleteAt: 2,
    });
    expect(result).not.toHaveProperty("email");
    expect(local).toHaveBeenCalledTimes(target.kind === "username" ? 1 : 0);
    expect(fetchApi.mock.calls).toHaveLength(1);
    expect(fetchApi).toHaveBeenCalledWith(
      `${basePath}/api/v4/users/${suffix}`,
      expect.objectContaining({ method: "GET" }),
    );
  },
);
test.each([403, 404, 401, 503])(
  "a %i completes the one selected route",
  async (status) => {
    const { users, fetchApi } = fixture({}, status);
    const pending = readConversationRecipient(
      users,
      { kind: "username", name: "alex" },
      saved,
    );
    if (status === 403 || status === 404)
      await expect(pending).resolves.toBeNull();
    else await expect(pending).rejects.toBeInstanceOf(ResponseError);
    expect(fetchApi).toHaveBeenCalledTimes(1);
    expect(fetchApi).toHaveBeenCalledWith(
      `${basePath}/api/v4/users/username/alex`,
      expect.anything(),
    );
  },
);
test.each([
  [{ kind: "user-id", id }, { ...row, id: "b".repeat(26) }, 200],
  [{ kind: "username", name }, { ...row, username: "renamed" }, 200],
  [{ kind: "username", name }, { ...row, id: "b".repeat(26) }, 200],
  [{ kind: "username", name: "alex" }, row, 200],
  [{ kind: "email", email }, { ...row, email: undefined }, 200],
  [{ kind: "email", email }, { ...row, email: "another@example.test" }, 200],
  [{ kind: "user-id", id }, { ...row, remote_id: "invalid" }, 200],
  [{ kind: "user-id", id }, null, 200],
  [{ kind: "user-id", id }, row, 201],
] as const)(
  "refuses mismatched or incomplete identity %o",
  async (target, body, status) => {
    const { users, fetchApi } = fixture(body, status);
    await expect(
      readConversationRecipient(users, target, saved),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetchApi).toHaveBeenCalledTimes(1);
  },
);
test("an inherited name is never a stored match", async () => {
  const { users, fetchApi } = fixture({ id, username: "constructor" });
  expect(
    (
      await readConversationRecipient(
        users,
        { kind: "username", name: "constructor" },
        saved,
      )
    )?.id,
  ).toBe(id);
  expect(fetchApi).toHaveBeenCalledWith(
    `${basePath}/api/v4/users/username/constructor`,
    expect.anything(),
  );
});
test("a malformed saved identity cannot start a lookup", async () => {
  const { users, fetchApi } = fixture();
  await expect(
    readConversationRecipient(users, { kind: "username", name }, async () => ({
      usernames: { [name]: id },
      profiles: { [id]: { ...known, username: "renamed" } },
    })),
  ).rejects.toThrow("Invalid saved recipient identity");
  expect(fetchApi).not.toHaveBeenCalled();
});
test("keeps the signed transport failure from the selected route", async () => {
  const failure = new TypeError("REST transport failed", { cause: "network" });
  const fetchApi = vi.fn(async () => {
    throw failure;
  });
  const users = new UsersApi(new Configuration({ basePath, fetchApi }));
  const result = readConversationRecipient(
    users,
    { kind: "username", name },
    saved,
  );
  const reason = await result.catch((error: unknown) => error);
  expect(reason).toBeInstanceOf(FetchError);
  expect(reason).toHaveProperty("cause", failure);
  expect(fetchApi).toHaveBeenCalledExactlyOnceWith(
    `${basePath}/api/v4/users/${id}`,
    expect.anything(),
  );
});
test.each([
  { kind: "username", name: ".." },
  { kind: "username", name: "a/b" },
  { kind: "email", email: "a@" },
  { kind: "email", email: "a@@example.test" },
  { kind: "user-id", id: "me" },
] satisfies ConversationRecipientTarget[])(
  "invalid input sends no requests: %o",
  async (target) => {
    const { users, fetchApi } = fixture();
    const store = vi.fn(saved);
    await expect(
      readConversationRecipient(users, target, store),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetchApi).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  },
);
test("closing the signed connection supersedes a late SDK response", async () => {
  const ready = deferred<void>();
  const release = deferred<void>();
  const { users } = fixture();
  const wire = users.getUserRaw.bind(users);
  vi.spyOn(UsersApi.prototype, "getUserRaw").mockImplementation(
    async (...args) => {
      ready.resolve();
      await release.promise;
      return wire(...args);
    },
  );
  vi.mocked(invoke).mockResolvedValueOnce(123);
  const account = await openAccountRestConnection(basePath, id);
  const result = account.readConversationRecipient({ kind: "user-id", id });
  await ready.promise;
  await account.close();
  release.resolve();
  await expect(result).rejects.toBe("cancelled");
  const anonymous = await openNativeRestConnection(basePath);
  expect(anonymous).not.toHaveProperty("readConversationRecipient");
  await anonymous.close();
});
test("abort while the saved directory is loading does not start the server read", async () => {
  const { users, fetchApi } = fixture();
  const ready = deferred<Awaited<ReturnType<typeof saved>>>();
  const c = new AbortController();
  const result = readConversationRecipient(
    users,
    { kind: "username", name },
    () => ready.promise,
    c.signal,
  );
  c.abort("changed target");
  ready.resolve(await saved());
  await expect(result).rejects.toBe("changed target");
  expect(fetchApi).not.toHaveBeenCalled();
});
test("closing while checking the saved directory cannot start a request on the old connection", async () => {
  const directory = deferred<Awaited<ReturnType<typeof saved>>>();
  const wire = vi.spyOn(UsersApi.prototype, "getUserRaw");
  vi.mocked(invoke)
    .mockResolvedValueOnce(123)
    .mockImplementationOnce(() => directory.promise);
  const account = await openAccountRestConnection(basePath, id);
  const result = account.readConversationRecipient({ kind: "username", name });
  expect(invoke).toHaveBeenLastCalledWith("read_saved_profiles", {
    rid: 123,
    query: { ids: [], usernames: [name] },
  });
  await account.close();
  directory.resolve(await saved());
  await expect(result).rejects.toBe("cancelled");
  expect(wire).not.toHaveBeenCalled();
});
test.each(["close", "abort"] as const)(
  "%s during SDK preparation cancels a resolved saved recipient before native prepare",
  async (action) => {
    const ready = deferred<void>();
    const release = deferred<void>();
    const original = UsersApi.prototype.getUserRaw;
    const getById = vi
      .spyOn(UsersApi.prototype, "getUserRaw")
      .mockImplementation(function (this: UsersApi, request, options) {
        return original.call(this, request, async (context) => {
          ready.resolve();
          await release.promise;
          return typeof options === "function"
            ? options(context)
            : (options ?? {});
        });
      });
    let closed = false;
    const ipc = vi.mocked(invoke);
    ipc.mockImplementation(async (command) => {
      switch (command) {
        case "open_rest_connection":
          return 123;
        case "read_saved_profiles":
          return saved();
        case "close_rest_connection":
          closed = true;
          return;
        case "prepare_rest_request":
          if (closed) throw "unknown_connection";
          break;
      }
      throw Error(`Unexpected native command: ${command}`);
    });
    const account = await openAccountRestConnection(basePath, id);
    const controller = new AbortController();
    const reason = new Error("changed target");
    const result = account.readConversationRecipient(
      { kind: "username", name },
      controller.signal,
    );
    await ready.promise;
    expect(getById).toHaveBeenCalledExactlyOnceWith(
      { userId: id },
      expect.anything(),
    );
    if (action === "close") await account.close();
    else controller.abort(reason);
    release.resolve();
    await expect(result).rejects.toBe(
      action === "close" ? "cancelled" : reason,
    );
    expect(ipc.mock.calls.map(([command]) => command)).toEqual([
      "open_rest_connection",
      "read_saved_profiles",
      ...(action === "close" ? ["close_rest_connection"] : []),
    ]);
    if (action === "abort") await account.close();
  },
);
