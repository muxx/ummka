import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { waitForAndroidBoot } from "./android.ts";
import { launchWebview, type SendAndroidKey } from "./android-webview.ts";
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

test("Android injects the exact hardware key requested by the running document", async () => {
  const events: string[] = [];
  let logReads = 0;
  let keyboardVisible = true;
  let ready!: SendAndroidKey;
  async function adb(...args: string[]) {
    if (args[1] === "dumpsys") {
      assert.equal(args[2], "input_method");
      events.push(keyboardVisible ? "IME shown" : "IME hidden");
      const state = `mInputShown=${keyboardVisible}`;
      keyboardVisible = false;
      return state;
    }
    if (args[1] === "input") {
      assert.deepEqual(args.slice(0, 3), ["shell", "input", "keyevent"]);
      events.push(args[3]);
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
    if (logReads === 2) {
      await ready("KEYCODE_TAB");
      await ready("KEYCODE_BACK");
    }
    return logReads === 3 ? "UMMKA_WEBVIEW_CHECK browser-checked" : "";
  }
  await launchWebview(
    adb,
    "app",
    "app/.MainActivity",
    "browser-checked",
    (send) => {
      ready = send;
    },
  );
  assert.deepEqual(events, [
    "launch",
    "log",
    "log",
    "KEYCODE_TAB",
    "IME shown",
    "IME hidden",
    "KEYCODE_BACK",
    "log",
  ]);
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
    fixture.onAndroidInputReady(async (key) => {
      assert.equal(key, "KEYCODE_TAB");
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

test("a cold boot consumes the policy signal once before the hardware overlay is ready", async () => {
  const marker = "Finished calculating hasIncompatibleAccountsTask";
  const overlay = "com.android.internal.emulation.pixel_6";
  const commands: string[][] = [];
  let overlayReads = 0;
  await waitForAndroidBoot(
    async (...args) => {
      commands.push(args);
      if (args[0] === "wait-for-device")
        return commands.length === 1 ? marker : "";
      if (args[1] === "getprop") return "1";
      return ++overlayReads === 1 ? `[ ] ${overlay}` : `[x] ${overlay}`;
    },
    { exitCode: null },
  );
  assert.deepEqual(commands, [
    [
      "wait-for-device",
      "logcat",
      "-b",
      "system",
      "-m",
      "1",
      "-e",
      marker,
      "-s",
      "DevicePolicyManager:I",
    ],
    ["shell", "getprop", "sys.boot_completed"],
    ...Array.from({ length: 2 }, () => [
      "shell",
      "cmd",
      "overlay",
      "list",
      "--user",
      "0",
      overlay,
    ]),
  ]);
});

test("boot does not accept a missing policy signal or another device profile", async () => {
  await assert.rejects(
    waitForAndroidBoot(async () => "", { exitCode: null }),
    /device policy/,
  );
  await assert.rejects(
    waitForAndroidBoot(
      async (...args) => {
        if (args[0] === "wait-for-device")
          return "Finished calculating hasIncompatibleAccountsTask";
        return args[1] === "getprop" ? "1" : "[x] other.profile";
      },
      { exitCode: 1 },
    ),
    /hardware profile.*other.profile/,
  );
});
