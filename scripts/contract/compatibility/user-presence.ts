import assert from "node:assert/strict";
import {
  Configuration,
  ResponseError,
  StatusApi,
} from "../../../vendor/mattermost/index.js";

type Participant = { id: string; token: string };

export async function checkUserPresence(
  basePath: string,
  reader: Participant,
  peer: Participant,
) {
  const statuses = new StatusApi(
    new Configuration({ basePath, accessToken: reader.token }),
  );
  const minute = Math.floor(Date.now() / 60_000) * 60 + 3600;
  const changed = await fetch(`${basePath}/api/v4/users/${peer.id}/status`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${peer.token}`,
    },
    body: JSON.stringify({
      user_id: peer.id,
      status: "dnd",
      dnd_end_time: minute + 29,
    }),
  });
  assert.equal(changed.status, 200);
  const unknown = "q".repeat(26);
  const rows = await statuses.getUsersStatusesByIds({
    requestBody: [unknown, reader.id, peer.id],
  });
  assert.equal(rows.length, 3);
  const byId = new Map(rows.map((s) => [s.userId, s]));
  assert.ok(byId.has(reader.id));
  const colleague = byId.get(peer.id);
  assert.equal(colleague?.status, "dnd");
  assert.equal(colleague?.manual, true);
  assert.equal(colleague?.dndEndTime, minute);
  assert.ok(Number.isSafeInteger(colleague?.lastActivityAt));
  const missing = byId.get(unknown);
  assert.equal(missing?.status, "offline");
  assert.equal(missing?.manual, false);
  assert.equal(missing?.lastActivityAt, 0);
  assert.equal(missing?.dndEndTime, 0);
  for (const requestBody of [[], ["short"]]) {
    await assert.rejects(
      statuses.getUsersStatusesByIds({ requestBody }),
      (error: unknown) =>
        error instanceof ResponseError && error.response.status === 400,
    );
  }
  const anonymous = new StatusApi(new Configuration({ basePath }));
  await assert.rejects(
    anonymous.getUsersStatusesByIds({ requestBody: [peer.id] }),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 401,
  );
}
