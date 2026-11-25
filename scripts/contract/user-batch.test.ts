import assert from "node:assert/strict";
import { test } from "node:test";
import { createRestTransport } from "../../src/mattermost/rest-transport.ts";
import {
  Configuration,
  RequiredError,
  ResponseError,
  UserFromJSON,
  UsersApi,
  UserToJSON,
} from "../../vendor/mattermost/index.js";
import { listen } from "./test-server.ts";

test("the generated profile codecs preserve optional identity fields", () => {
  for (const wire of [
    { username: "ordinary", position: "", remote_id: "" },
    { username: "bot-user", is_bot: true },
    {
      username: "local-alias",
      position: "Developer",
      remote_id: "r".repeat(26),
      props: { RemoteUsername: "remote-user" },
    },
    { username: "partial" },
  ]) {
    const profile = UserFromJSON(wire);
    assert.equal(profile.position, wire.position);
    assert.equal(profile.remoteId, wire.remote_id);
    assert.equal(profile.isBot, wire.is_bot);
    assert.deepEqual(JSON.parse(JSON.stringify(UserToJSON(profile))), wire);
  }
});

for (const prefix of ["", "/teams/chat"]) {
  test(`the generated client posts a single ID array at ${prefix || "/"}`, async (t) => {
    const ids = ["a".repeat(26), "b".repeat(26)];
    let visits = 0;
    const { base } = await listen(t, async (request, response) => {
      visits++;
      assert.equal(request.method, "POST");
      assert.equal(
        request.url,
        `${prefix}/api/v4/users/ids${visits === 1 ? "?since=123" : ""}`,
      );
      assert.equal(request.headers["content-type"], "application/json");
      assert.equal(request.headers.cookie, undefined);
      const chunks: Buffer[] = [];
      for await (const part of request) chunks.push(part);
      assert.deepEqual(Buffer.concat(chunks), Buffer.from(JSON.stringify(ids)));
      const signed =
        request.headers.authorization === "Bearer synthetic-session";
      response.writeHead(signed ? 200 : 401, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify(
          signed
            ? [
                { id: ids[1], first_name: "Юлия" },
                { id: ids[0], first_name: "Ada" },
              ]
            : { message: "session required" },
        ),
      );
    });
    const transport = createRestTransport(base + prefix, fetch);
    const signed = new UsersApi(
      new Configuration({ ...transport, accessToken: "synthetic-session" }),
    );
    const response = await signed.getUsersByIdsRaw({
      requestBody: ids,
      since: 123,
    });
    assert.equal(response.raw.status, 200);
    assert.deepEqual(
      (await response.value()).map((u) => [u.id, u.firstName]),
      [
        [ids[1], "Юлия"],
        [ids[0], "Ada"],
      ],
    );
    const anonymous = new UsersApi(new Configuration(transport));
    await assert.rejects(
      anonymous.getUsersByIds({ requestBody: ids }),
      (e) => e instanceof ResponseError && e.response.status === 401,
    );
    // @ts-expect-error Also check calls arriving from an untyped consumer.
    await assert.rejects(anonymous.getUsersByIds({}), RequiredError);
    assert.equal(visits, 2);
  });
}
