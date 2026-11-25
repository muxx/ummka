import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchWebview } from "./android-webview.ts";
import { startFixture } from "./fixture.ts";

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

test("Android sends one Tab after the reloaded document contacts the fixture", async () => {
  const events: string[] = [];
  let logReads = 0;
  let ready!: () => Promise<void>;
  async function adb(...args: string[]) {
    if (args[1] === "input") {
      assert.deepEqual(args, ["shell", "input", "keyevent", "KEYCODE_TAB"]);
      events.push("keyboard");
      return "";
    }
    if (args[1] === "am") {
      events.push("launch");
      return "Status: ok";
    }
    if (args[1] === "pidof") return "125";
    assert.equal(args[0], "logcat");
    events.push("log");
    logReads++;
    if (logReads === 2) await ready();
    return logReads === 3 ? "UMMKA_WEBVIEW_CHECK browser-checked" : "";
  }
  await launchWebview(
    adb,
    "app",
    "app/.MainActivity",
    "browser-checked",
    (sendTab) => {
      ready = sendTab;
    },
  );
  assert.deepEqual(events, ["launch", "log", "log", "keyboard", "log"]);
});

test("the new document receives its control response only after the keyboard event is delivered", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ummka-keyboard-"));
  try {
    const fixture = await startFixture(dir);
    const [dataPort, controlPort] = fixture.webviewPorts;
    const options = {
      hostname: "127.0.0.1",
      ca: fixture.ca,
      agent: false as const,
    };
    function control(step: string) {
      return new Promise<number | undefined>((resolve, reject) => {
        const request = get(
          {
            ...options,
            port: controlPort,
            path: `/api/v4/system/ping?step=${step}&case=reload`,
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.setTimeout(5000, () =>
          request.destroy(Error("Fixture control response timed out")),
        );
        request.once("error", reject);
      });
    }
    const held = get({
      ...options,
      port: dataPort,
      path: "/team/chat/api/v4/system/ping?check=reload",
    });
    held.on("error", () => {}); // Closing the held request is the reload under test.
    let entered!: () => void;
    const sending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let delivered!: () => void;
    const delivery = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    let keys = 0;
    fixture.onKeyboardReady(async () => {
      keys++;
      entered();
      await delivery;
    });
    let first: Promise<number | undefined> | undefined;
    try {
      assert.equal(await control("received"), 204);
      assert.equal(keys, 0);
      held.destroy();
      let answered = false;
      first = control("closed").then((code) => {
        answered = true;
        return code;
      });
      await Promise.race([
        sending,
        first.then(() => {
          throw Error("Reload was acknowledged before keyboard input");
        }),
      ]);
      assert.equal(await control("closed"), 204);
      assert.equal(keys, 1);
      assert.equal(answered, false);
      delivered();
      assert.equal(await first, 204);
    } finally {
      delivered();
      held.destroy();
      await first?.catch(() => {});
      await fixture.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a wrong terminal marker fails immediately", async () => {
  const run = fixture(["UMMKA_WEBVIEW_CHECK FAIL"]);
  await assert.rejects(run.launch(), /FAIL/);
  assert.equal(run.reads(), 1);
});
