import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { startExternalLinkReceiver } from "../native-http/external-link.ts";
import { startFixture } from "../native-http/fixture.ts";
import { fixtureDeadline, fixtureStep } from "./fixture-step.ts";
import { isGitHubHostedMac, watchWebviewSteps } from "./macos.ts";

test("interactive presentations require a GitHub-hosted Mac", () => {
  const legacy = { UMMKA_CHECK_MACOS_BROWSER: "1" };
  const github = { GITHUB_ACTIONS: "true" };
  const hosted = { ...github, RUNNER_ENVIRONMENT: "github-hosted" };
  assert.equal(isGitHubHostedMac("darwin", {}), false);
  assert.equal(isGitHubHostedMac("darwin", legacy), false);
  assert.equal(isGitHubHostedMac("darwin", { ...legacy, ...github }), false);
  assert.equal(
    isGitHubHostedMac("darwin", { RUNNER_ENVIRONMENT: "github-hosted" }),
    false,
  );
  assert.equal(
    isGitHubHostedMac("darwin", {
      ...legacy,
      ...github,
      RUNNER_ENVIRONMENT: "self-hosted",
    }),
    false,
  );
  assert.equal(isGitHubHostedMac("linux", hosted), false);
  assert.equal(isGitHubHostedMac("darwin", hosted), true);
});

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

test("external handoff waits for a browser receipt from the exact loopback link", async (t) => {
  const receiver = await startExternalLinkReceiver();
  t.after(() => receiver.close());
  const dir = await mkdtemp(join(tmpdir(), "ummka-mac-external-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = await startFixture(dir, receiver.receipt);
  t.after(() => fixture.close());
  const signal = AbortSignal.timeout(5_000);

  let replied = false;
  const status = new Promise<number | undefined>((resolve, reject) => {
    get(
      {
        host: "127.0.0.1",
        port: fixture.webviewPorts[1],
        ca: fixture.ca,
        path: "/api/v4/system/ping?step=external-handoff",
        signal,
      },
      (response) => {
        replied = true;
        response.resume();
        resolve(response.statusCode);
      },
    ).on("error", reject);
  });
  // If a preceding assertion fails, the fixture may close this request first.
  void status.catch(() => {});
  while (!fixture.webviewProgress().includes("external-handoff received"))
    await delay(5, undefined, { signal });

  const href = new URL(receiver.href);
  assert.equal(href.pathname, "/post/@bear");
  assert.equal(href.search, "?value=a%2Fb");
  assert.equal(href.hash, "#anchor");
  assert.equal(
    (await fetch(new URL("/post/@bear?value=a/b", href), { signal })).status,
    404,
  );
  const page = await fetch(href, { signal });
  assert.equal(page.status, 200);
  const script = /<script>(.+)<\/script>/u.exec(await page.text())?.[1];
  assert(script);
  runInNewContext(script, {
    location: { hash: "#different" },
    fetch: () => assert.fail("the browser acknowledged a different fragment"),
  });
  assert.throws(
    () => receiver.verify(),
    /did not acknowledge exactly one link/u,
  );
  assert.equal(replied, false);

  const acknowledge = (path: string, init: RequestInit) =>
    fetch(new URL(path, href), { ...init, signal });
  const receipt = await runInNewContext(script, {
    location: { hash: href.hash },
    fetch: acknowledge,
  });
  assert.equal(receipt.status, 204);
  assert.equal(await status, 204);
  receiver.verify();

  await acknowledge("/accepted", { method: "POST" });
  assert.throws(
    () => receiver.verify(),
    /did not acknowledge exactly one link/u,
  );
});

test("closing the browser receiver releases a missing receipt as a failure", async () => {
  const receiver = await startExternalLinkReceiver();
  receiver.close();
  assert.equal(await receiver.receipt, false);
  assert.throws(
    () => receiver.verify(),
    /did not acknowledge exactly one link/u,
  );
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
