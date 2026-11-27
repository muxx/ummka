import assert from "node:assert/strict";
import { openRecipientConversation } from "../../../src/mattermost/recipient-conversation.ts";
import {
  type ApiResponse,
  type Channel,
  ChannelsApi,
  Configuration,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkConversationCreation(
  basePath: string,
  accessToken: string,
  self: string,
  peers: string[],
  version: string,
) {
  assert.equal(new Set([self, ...peers]).size, 9);
  const signed = new Configuration({ basePath, accessToken });
  const api = new ChannelsApi(signed);
  const anonymous = new ChannelsApi(new Configuration({ basePath }));
  const direct = (requestBody: string[]) =>
    api.createDirectChannelRaw({ requestBody });
  const group = (requestBody: string[]) =>
    api.createGroupChannelRaw({ requestBody });
  async function confirm(
    response: ApiResponse<Channel>,
    type: "D" | "G",
    members: string[],
  ) {
    assert.equal(response.raw.status, 201);
    const channel = await response.value();
    assert.ok(channel.id);
    assert.equal(channel.type, type);
    assert.equal(channel.teamId, "");
    const roster = await api.getChannelMembers({ channelId: channel.id });
    assert.deepEqual(
      roster.map((member) => member.userId).sort(),
      [...members].sort(),
    );
    return channel.id;
  }
  const [first, second, third] = peers;
  const selfId = await confirm(await direct([self]), "D", [self]);
  assert.equal(await confirm(await direct([self, self]), "D", [self]), selfId);
  const directId = await confirm(await direct([self, first]), "D", [
    self,
    first,
  ]);
  assert.notEqual(directId, selfId);
  assert.equal(
    await confirm(await direct([first, self, first]), "D", [self, first]),
    directId,
  );
  const members = [self, first, second];
  const groupId = await confirm(await group([first, second]), "G", members);
  assert.equal(
    await confirm(await group([second, self, first]), "G", members),
    groupId,
  );
  const changedId = await confirm(await group([second, third]), "G", [
    self,
    second,
    third,
  ]);
  assert.notEqual(changedId, groupId);
  const maximum = [self, ...peers.slice(0, 7)];
  const maximumId = await confirm(await group(maximum), "G", maximum);
  assert.equal(
    await confirm(await group([...maximum, first]), "G", maximum),
    maximumId,
  );

  for (const [recipients, channelId, channelKind] of [
    [[self], selfId, "D"],
    [[first], directId, "D"],
    [[first, second], groupId, "G"],
    [[second, first], groupId, "G"],
    [maximum.slice(1), maximumId, "G"],
  ] as const) {
    assert.deepEqual(
      await openRecipientConversation(signed, self, recipients),
      { kind: "applied", channelId, channelKind },
    );
  }
  const rejects = (status: number) => (e: unknown) =>
    e instanceof ResponseError && e.response.status === status;
  await assert.rejects(direct([first, second]), rejects(403));
  await assert.rejects(direct([self, first, second]), rejects(400));
  await assert.rejects(direct([self, "z".repeat(26)]), rejects(400));
  await assert.rejects(group([self, first]), rejects(400));
  await assert.rejects(group(peers), rejects(400));
  await assert.rejects(
    anonymous.createDirectChannel({ requestBody: [self] }),
    rejects(401),
  );
  await assert.rejects(
    anonymous.createGroupChannel({ requestBody: [first, second] }),
    rejects(401),
  );
  assert.deepEqual(
    await openRecipientConversation(new Configuration({ basePath }), self, [
      first,
    ]),
    { kind: "unauthorized" },
  );
  console.log(
    `Mattermost ${version} verified personal and group conversations, exact rosters, account receipts after reordered selection, self, the 3..8 limit, and refused access.`,
  );
}
