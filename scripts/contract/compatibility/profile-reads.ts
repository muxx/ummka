import assert from "node:assert/strict";
import {
  Configuration,
  ResponseError,
  UsersApi,
} from "../../../vendor/mattermost/index.js";

type Identity = { id: string; username: string };

export async function checkProfileReads(
  base: string,
  users: UsersApi,
  person: Identity,
  bot: Identity,
  version: string,
) {
  const lookup = {
    requestBody: [bot.username, "unknown-lookup-fixture", person.username],
  };
  const found = await users.getUsersByUsernames(lookup);
  assert.deepEqual(
    new Map(found.map((p) => [p.id, p.username])),
    new Map([
      [person.id, person.username],
      [bot.id, bot.username],
    ]),
  );
  const response = await users.getProfileImageRaw({ userId: person.id });
  assert.equal(response.raw.headers.get("content-type"), "image/png");
  const image = await response.value();
  assert.equal(image.type, "image/png");
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.deepEqual(
    bytes.subarray(0, 8),
    Buffer.from("89504e470d0a1a0a", "hex"),
  );
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
  assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
  const anonymous = new UsersApi(new Configuration({ basePath: base }));
  for (const send of [
    () => anonymous.getUsersByUsernames(lookup),
    () => anonymous.getProfileImage({ userId: person.id }),
  ]) {
    await assert.rejects(
      send,
      (e) => e instanceof ResponseError && e.response.status === 401,
    );
  }
  console.log(
    `Mattermost ${version} verified profile names, missing users, PNG dimensions and anonymous HTTP 401.`,
  );
}
