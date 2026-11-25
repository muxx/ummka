import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import {
  changeOwnMembership,
  type MembershipTarget,
} from "./own-membership.ts";

const self = "u".repeat(26);
const id = "t".repeat(26);
const team: MembershipTarget = { kind: "team", id };
const channel: MembershipTarget = { kind: "channel", id };

test.each([
  [team, "join", 201, { team_id: id, user_id: self, delete_at: 0 }, "applied"],
  [channel, "join", 201, { channel_id: id, user_id: self }, "applied"],
  [
    team,
    "join",
    201,
    { team_id: id, user_id: self, delete_at: 17 },
    "unconfirmed",
  ],
  [
    team,
    "join",
    201,
    { team_id: self, user_id: self, delete_at: 0 },
    "unconfirmed",
  ],
  [channel, "join", 201, { channel_id: id, user_id: id }, "unconfirmed"],
  [channel, "join", 200, { channel_id: id, user_id: self }, "unconfirmed"],
  [team, "leave", 200, { status: "OK" }, "applied"],
  [channel, "leave", 201, { status: "OK" }, "unconfirmed"],
  [channel, "leave", 200, { status: "ERROR" }, "unconfirmed"],
  [
    channel,
    "leave",
    403,
    { id: "forbidden", status_code: 403, message: "Membership denied" },
    "refused",
  ],
  [team, "leave", 401, {}, "unauthorized"],
  [team, "join", 503, {}, "unconfirmed"],
] as const)(
  "classifies %j %s status %d response %j as %s",
  async (target, change, status, body, kind) => {
    const fetchApi = vi.fn(async () => Response.json(body, { status }));
    const config = new Configuration({
      basePath: "https://example.test/team/chat",
      fetchApi,
    });
    const result = await changeOwnMembership(config, self, target, change);
    expect(result.kind).toBe(kind);
    if (kind === "refused")
      expect(result).toMatchObject({
        refusal: {
          status: 403,
          code: "forbidden",
          message: "Membership denied",
        },
      });
    expect(fetchApi).toHaveBeenCalledTimes(1);
  },
);

test("losing the acknowledgement does not reissue the write and invalid targets never start it", async () => {
  const fetchApi = vi.fn(async () => {
    throw TypeError("offline");
  });
  const config = new Configuration({
    basePath: "https://example.test",
    fetchApi,
  });
  await expect(
    changeOwnMembership(config, self, { kind: "channel", id: "" }, "join"),
  ).rejects.toThrow(TypeError);
  await expect(
    changeOwnMembership(config, self, channel, "leave"),
  ).resolves.toEqual({ kind: "unconfirmed" });
  expect(fetchApi).toHaveBeenCalledTimes(1);
});
