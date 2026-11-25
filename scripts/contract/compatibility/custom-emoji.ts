import assert from "node:assert/strict";
import { resolveComposerSubmission } from "../../../src/channels/composer-submission.ts";
import { readCustomEmoji } from "../../../src/mattermost/account-custom-emoji.ts";
import {
  Configuration,
  EmojiApi,
  EmojiToJSON,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkCustomEmojiLookup(
  base: string,
  adminToken: string,
  creatorId: string,
  readerToken: string,
) {
  const headers = { Authorization: `Bearer ${adminToken}` };
  const session = new Configuration({
    basePath: base,
    accessToken: readerToken,
  });
  const reader = new EmojiApi(session);
  const name = "fixture_wave";
  const form = new FormData();
  form.append("emoji", JSON.stringify({ name, creator_id: creatorId }));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFvUAAAAASUVORK5CYII=",
    "base64",
  );
  form.append("image", new Blob([png], { type: "image/png" }), "fixture.png");
  const created = await fetch(`${base}/api/v4/emoji`, {
    method: "POST",
    headers,
    body: form,
  });
  assert.equal(created.status, 200);
  const wire = await created.json();
  assert.equal(wire.creator_id, creatorId);
  assert.equal(wire.name, name);
  assert.match(wire.id, /^[a-z0-9]{26}$/);
  assert.ok(wire.create_at > 0 && wire.update_at >= wire.create_at);
  assert.equal(wire.delete_at, 0);
  assert.deepEqual(
    EmojiToJSON(await reader.getEmojiByName({ emojiName: name })),
    wire,
  );
  const requestedNames: string[] = [];
  const account = {
    readCustomEmoji(exactName: string, signal?: AbortSignal) {
      requestedNames.push(exactName);
      return readCustomEmoji(session, exactName, signal);
    },
  };
  const submit = (message: string) =>
    resolveComposerSubmission(
      { message, scheduled: false, hasAttachments: false },
      account,
    );
  assert.deepEqual(await submit("ordinary message"), { kind: "post" });
  assert.deepEqual(await submit("/help private arguments"), {
    kind: "command",
  });
  assert.deepEqual(await submit("-:+1:"), {
    kind: "reaction",
    action: "remove",
    emoji: "+1",
  });
  assert.deepEqual(requestedNames, []);
  assert.deepEqual(await submit("+:" + name + ":"), {
    kind: "reaction",
    action: "add",
    emoji: name,
  });
  assert.deepEqual(await submit("+:Fixture_Wave:"), { kind: "post" });
  assert.deepEqual(requestedNames, [name, "Fixture_Wave"]);
  const found = await readCustomEmoji(session, name);
  assert.equal(found.kind, "found");
  if (found.kind === "found") assert.deepEqual(EmojiToJSON(found.emoji), wire);
  assert.deepEqual(await readCustomEmoji(session, "Fixture_Wave"), {
    kind: "missing",
  });
  const anonymous = new EmojiApi(new Configuration({ basePath: base }));
  await assert.rejects(
    anonymous.getEmojiByName({ emojiName: name }),
    (error: unknown) =>
      error instanceof ResponseError && error.response.status === 401,
  );
  async function checkError(emojiName: string, status: number, id: string) {
    try {
      await reader.getEmojiByName({ emojiName });
    } catch (error) {
      assert.ok(error instanceof ResponseError);
      assert.equal(error.response.status, status);
      assert.equal((await error.response.json()).id, id);
      return;
    }
    assert.fail(`Unexpected custom emoji: ${emojiName}`);
  }
  for (const missing of ["missing_wave", "Fixture_Wave", "+1"])
    await checkError(missing, 404, "app.emoji.get_by_name.no_result");
  async function enableCustomEmoji(enable: boolean) {
    const result = await fetch(`${base}/api/v4/config/patch`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ServiceSettings: { EnableCustomEmoji: enable } }),
    });
    assert.equal(result.status, 200);
  }
  await enableCustomEmoji(false);
  try {
    assert.deepEqual(await submit("-:" + name + ":"), { kind: "post" });
    assert.deepEqual(requestedNames, [name, "Fixture_Wave", name]);
    await checkError(name, 501, "api.emoji.disabled.app_error");
    assert.deepEqual(await readCustomEmoji(session, name), {
      kind: "disabled",
    });
  } finally {
    await enableCustomEmoji(true);
  }
}
