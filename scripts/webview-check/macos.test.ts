import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startFixture } from "../native-http/fixture.ts";
import { fixtureDeadline, fixtureStep } from "./fixture-step.ts";
import { watchWebviewSteps } from "./macos.ts";

test("new fixture steps renew the deadline, but a repeating or stalled step expires", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let expired = 0;
  const watchdog = watchWebviewSteps(() => expired++, 100);
  t.mock.timers.tick(80);
  watchdog.completed("format-times");
  t.mock.timers.tick(80);
  watchdog.completed("back-reopened");
  assert.equal(expired, 0);
  t.mock.timers.tick(80);
  watchdog.completed("back-reopened");
  t.mock.timers.tick(20);
  assert.equal(expired, 1);
  watchdog.close();
});

test("closing the fixture releases its watchdog", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = watchWebviewSteps(() => assert.fail("orphaned watchdog"), 100);
  watch.completed("before");
  watch.close();
  watch.completed("late");
  t.mock.timers.tick(100);
});

test("native window stages have their own deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let expired = 0;
  const watchdog = watchWebviewSteps(() => expired++, 100);
  t.mock.timers.tick(80);
  watchdog.completed("window-lifetime-read-first-receipt", 10);
  t.mock.timers.tick(9);
  assert.equal(expired, 0);
  watchdog.completed("window-lifetime-wait-destroyed", 10);
  t.mock.timers.tick(9);
  assert.equal(expired, 0);
  watchdog.completed("window-lifetime-wait-destroyed", 10);
  t.mock.timers.tick(1);
  assert.equal(expired, 1);
  watchdog.close();
});

test("a pending browser operation fails with the name of its await", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stuck = fixtureDeadline(
    "close-generated-connections",
    () => new Promise<never>(() => {}),
    100,
  );
  const failed = assert.rejects(
    stuck,
    /Fixture timed out waiting for close-generated-connections/u,
  );
  t.mock.timers.tick(100);
  await failed;
});

test("a completed browser operation clears its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  assert.equal(await fixtureDeadline("wait-for-thread-draft", () => 4, 100), 4);
  t.mock.timers.tick(100);
});

test("a stuck trace uses the same deadline as its browser step", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: () => new Promise<never>(() => {}),
      },
    },
  });
  t.after(() => Reflect.deleteProperty(globalThis, "window"));
  const failed = assert.rejects(
    fixtureStep("wait-for-thread-draft", () =>
      assert.fail("trace never replied"),
    ),
    /wait-for-thread-draft: Fixture timed out waiting for wait-for-thread-draft/u,
  );
  t.mock.timers.tick(30_000);
  await failed;
});

test("a driver failure closes the control request without recording a completed key step", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ummka-mac-key-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = await startFixture(dir);
  t.after(() => fixture.close());
  const failure = new Error("fixture process exited");
  const reported = t.mock.method(console, "error", () => {});
  fixture.onMacInputReady(
    async (key) => {
      assert.equal(key, "right-down");
      throw failure;
    },
    () => assert.fail("a failed key counted as fixture progress"),
  );
  const status = await new Promise<number | undefined>((resolve, reject) => {
    get(
      {
        host: "127.0.0.1",
        port: fixture.webviewPorts[1],
        ca: fixture.ca,
        path: "/api/v4/system/ping?step=format-right&case=code-320",
        signal: AbortSignal.timeout(2000),
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    ).on("error", reject);
  });
  assert.equal(status, 500);
  assert.match(fixture.webviewProgress(), /format-right\(code-320\) received/);
  assert.deepEqual(reported.mock.calls[0]?.arguments, [
    "Native input failed at format-right(code-320):",
    failure,
  ]);
});
