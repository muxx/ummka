import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  notificationSounds,
  notificationSoundUrl,
} from "../../src/channels/notification-sounds.ts";
import { buildWebviewFixture } from "../webview-check/build.ts";

test("the native fixture ships its terminal page alongside the actual notification sound assets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ummka-webview-assets-"));
  try {
    const config = JSON.parse(
      await buildWebviewFixture(dir, [1, 2], "android"),
    );
    const output = config.build.frontendDist;
    const marker = "ipc-result.html";
    assert.deepEqual(
      await readFile(join(output, marker)),
      await readFile(join("scripts/webview-check/public", marker)),
    );
    for (const sound of notificationSounds) {
      const path = notificationSoundUrl(sound).slice(1);
      assert.deepEqual(
        await readFile(join(output, path)),
        await readFile(join("public", path)),
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
