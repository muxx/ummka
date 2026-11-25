import assert from "node:assert/strict";
import { test } from "node:test";
import { launchWebview } from "./android-webview.ts";

function fixture(logs: string[]) {
  let reads = 0;
  async function adb(...args: string[]) {
    if (args[1] === "am") return "Status: ok";
    if (args[1] === "pidof") return "125";
    assert.equal(args[0], "logcat");
    assert.ok(args.includes("--pid=125"));
    const result = logs[reads++];
    assert.notEqual(
      result,
      undefined,
      "the checker read past the terminal result",
    );
    return result;
  }
  return {
    launch: () => launchWebview(adb, "fixture", "fixture/Main", "PASS"),
    reads: () => reads,
  };
}

for (const fatal of [
  "RustStdoutStderr: [FATAL:renderer.cc(42)] engine stopped",
  "RustStdoutStderr: [1125/130557.262:FATAL:renderer.cc(42)] engine stopped",
  "AndroidRuntime: FATAL EXCEPTION: main",
]) {
  test("fails on the first fatal record: " + fatal, async () => {
    const check = fixture([fatal + "\nUMMKA_WEBVIEW_CHECK PASS"]);
    await assert.rejects(
      check.launch(),
      (error) => error instanceof Error && error.message.includes(fatal),
    );
    assert.equal(check.reads(), 1);
  });
}

test("waits through an ordinary Chromium error and accepts the actual marker", async () => {
  const check = fixture([
    "RustStdoutStderr: [ERROR:renderer.cc(42)]",
    "UMMKA_WEBVIEW_CHECK PASS",
  ]);
  assert.equal(await check.launch(), "125");
  assert.equal(check.reads(), 2);
});
