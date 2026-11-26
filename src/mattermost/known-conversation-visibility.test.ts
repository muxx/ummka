import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, test, vi } from "vitest";
import { openAccountRestConnection } from "./native-rest.ts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
const userId = "u".repeat(26);
const peer = "p".repeat(26);
const team = "t".repeat(26);
const id = "c".repeat(26);
const server = "https://mm.example.test/base";

beforeEach(() => {
  ipc.mockReset();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(
  kind: string,
  name: string,
  options: {
    shown?: boolean;
    response?: string;
    status?: number;
    delaySidebar?: Promise<unknown>;
    delayReceipt?: Promise<unknown>;
    selected?: string;
  } = {},
) {
  const writes: {
    user_id: string;
    category: string;
    name: string;
    value: string;
  }[][] = [];
  const preferenceKey =
    kind === "D" ? (name.startsWith(userId) ? name.split("__")[1] : peer) : id;
  let bodyRead = false;
  ipc.mockImplementation(async (command, args) => {
    switch (command) {
      case "open_rest_connection":
        return 17;
      case "read_team_sidebar":
        expect(args).toEqual({ rid: 17, teamId: team });
        await options.delaySidebar;
        return {
          data: { channels: [{ id, name, kind }], categories: [] },
          selectedChannel: options.selected ?? null,
        };
      case "read_workspace_settings":
        expect(args).toEqual({ rid: 17 });
        return {
          preferences: {
            directShown:
              kind === "D" && options.shown ? { [preferenceKey]: true } : {},
            groupShown: kind === "G" && options.shown ? { [id]: true } : {},
          },
        };
      case "prepare_rest_request":
        return 18;
      case "send_rest_request":
        expect(args).toMatchObject({
          connection: 17,
          exchange: 18,
          method: "PUT",
          url: `${server}/api/v4/users/me/preferences`,
        });
        writes.push(JSON.parse((args as { body: string }).body));
        await options.delayReceipt;
        return {
          status: options.status ?? 200,
          headers: [["content-type", "application/json"]],
          hasBody: true,
        };
      case "read_rest_body": {
        if (bodyRead) return new ArrayBuffer(0);
        bodyRead = true;
        const encoded = new TextEncoder().encode(
          options.response ?? '{"status":"OK"}',
        );
        const buffer = new ArrayBuffer(encoded.length);
        new Uint8Array(buffer).set(encoded);
        return buffer;
      }
      case "close_rest_connection":
        return;
      default:
        throw new Error(`Unexpected IPC: ${command}`);
    }
  });
  return writes;
}

test.each([
  ["D", `${userId}__${peer}`, "direct_channel_show", peer],
  ["D", `${peer}__${userId}`, "direct_channel_show", peer],
  ["D", `${userId}__${userId}`, "direct_channel_show", userId],
  ["G", "opaque-group", "group_channel_show", id],
])(
  "opens a known %s channel from local membership with two personal preferences",
  async (kind, name, category, key) => {
    const writes = fixture(kind, name);
    const account = await openAccountRestConnection(server, userId);
    const now = Date.now();
    await expect(account.reopenKnownConversation(team, id)).resolves.toBe(
      "confirmed",
    );
    expect(writes).toEqual([
      [
        { user_id: userId, category, name: key, value: "true" },
        {
          user_id: userId,
          category: "channel_open_time",
          name: id,
          value: expect.stringMatching(/^[1-9]\d+$/),
        },
      ],
    ]);
    const rows = writes[0];
    expect(Number(rows[1].value)).toBeGreaterThanOrEqual(now);
    expect(Number(rows[1].value)).toBeLessThanOrEqual(Date.now());
  },
);

test.each([
  ["D", `${userId}__${peer}`],
  ["G", "opaque-group"],
])("keeps a saved visible %s out of the network", async (kind, name) => {
  const writes = fixture(kind, name, { shown: true });
  const account = await openAccountRestConnection(server, userId);
  await expect(account.reopenKnownConversation(team, id)).resolves.toBe(
    "alreadyShown",
  );
  expect(writes).toEqual([]);
});

test.each([
  ["O", "ordinary", id],
  ["P", "private", id],
  ["D", `${peer}__${peer}`, id],
  ["D", "bad", id],
  ["D", `${userId}__${peer}`, "x".repeat(26)],
  ["G", "group", "invalid"],
])(
  "rejects unsuitable %s membership before a signed write",
  async (kind, name, target) => {
    const writes = fixture(kind, name);
    const account = await openAccountRestConnection(server, userId);
    await expect(
      account.reopenKnownConversation(team, target),
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  },
);

test.each([
  [201, '{"status":"OK"}'],
  [200, '{"status":"FAIL"}'],
  [403, "{}"],
])(
  "HTTP %i with %s cannot confirm a change or replace local selection",
  async (status, response) => {
    const selected = "s".repeat(26);
    fixture("G", "group", { status, response, selected });
    const account = await openAccountRestConnection(server, userId);
    await expect(account.reopenKnownConversation(team, id)).rejects.toThrow();
    expect((await account.readTeamSidebar(team))?.selectedChannel).toBe(
      selected,
    );
  },
);

test.each(["abort", "close"])(
  "%s during local lookup prevents a late PUT",
  async (action) => {
    const sidebar = deferred();
    const writes = fixture("D", `${userId}__${peer}`, {
      delaySidebar: sidebar.promise,
    });
    const account = await openAccountRestConnection(server, userId);
    const controller = new AbortController();
    const pending = account.reopenKnownConversation(
      team,
      id,
      controller.signal,
    );
    expect(ipc).toHaveBeenCalledWith("read_team_sidebar", {
      rid: 17,
      teamId: team,
    });
    if (action === "close") await account.close();
    else controller.abort("cancelled");
    sidebar.resolve();
    await expect(pending).rejects.toBe("cancelled");
    expect(writes).toEqual([]);
  },
);

test("closing the account while the server is replying cannot publish a late receipt", async () => {
  const receipt = deferred();
  const writes = fixture("G", "opaque", { delayReceipt: receipt.promise });
  const account = await openAccountRestConnection(server, userId);
  const pending = account.reopenKnownConversation(team, id);
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  await account.close();
  receipt.resolve();
  await expect(pending).rejects.toBe("cancelled");
});
