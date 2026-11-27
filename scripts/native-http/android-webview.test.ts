import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { waitForAndroidBoot } from "./android.ts";
import { checkNativeInstrumentation } from "./android-instrumentation.ts";
import {
  launchWebview,
  type RotateAndroid,
  type SendAndroidKey,
} from "./android-webview.ts";
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

test("rotation waits for WindowManager to finish the requested transition", async () => {
  let rotate!: RotateAndroid;
  let reads = 0;
  const requested = (id: number) =>
    `Transition requested (#${id}): DisplayChange { displayId = 0, startRotation = 0, endRotation = 1, physicalDisplayChanged = false }`;
  const old = `${requested(4)}\nFinish Transition (#4):`;
  const states = [
    old,
    `${old}\n${requested(5)}\nFinish Transition (#6):`,
    `${requested(5)}\nFinish Transition (#5):`,
  ];
  async function adb(...args: string[]) {
    if (args[1] === "am") return "Status: ok";
    if (args[1] === "pidof") return "125";
    if (args[0] === "shell") {
      assert.deepEqual(args, [
        "shell",
        "cmd",
        "window",
        "user-rotation",
        "lock",
        "1",
      ]);
      assert.equal(reads, 1);
      return "";
    }
    if (args.includes("--pid=125")) {
      await rotate("landscape");
      assert.equal(reads, states.length);
      return "UMMKA_WEBVIEW_CHECK browser-checked";
    }
    assert.equal(args[0], "logcat");
    assert.ok(reads < states.length);
    return states[reads++];
  }
  await launchWebview(
    adb,
    "app",
    "app/.MainActivity",
    "browser-checked",
    (_, __, rotateDisplay) => {
      rotate = rotateDisplay;
    },
  );
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
    fixture.onAndroidInputReady(
      async (key) => {
        assert.equal(key, "KEYCODE_TAB");
        keys++;
        entered();
        await delivery;
      },
      async () => {
        assert.fail("The reload check does not swipe");
      },
      async () => {
        assert.fail("The reload check does not rotate");
      },
      async () => {
        throw Error("unexpected clipboard policy request");
      },
    );
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

const policyMarker = "Finished calculating hasIncompatibleAccountsTask";
const pixelOverlay = "com.android.internal.emulation.pixel_6";

test("a boot receipt captured before ADB connects survives a delayed overlay", async () => {
  const commands: string[][] = [];
  let overlayReads = 0;
  let policyReads = 0;
  await waitForAndroidBoot(
    async (...args) => {
      commands.push(args);
      if (args[0] === "wait-for-device") return "";
      if (args[1] === "getprop") return "1";
      return ++overlayReads === 1
        ? `[ ] ${pixelOverlay}`
        : `[x] ${pixelOverlay}`;
    },
    { exitCode: null },
    async () => {
      policyReads++;
      return policyMarker;
    },
  );
  assert.equal(policyReads, 1);
  assert.deepEqual(commands, [
    ["wait-for-device"],
    ["shell", "getprop", "sys.boot_completed"],
    ...Array.from({ length: 2 }, () => [
      "shell",
      "cmd",
      "overlay",
      "list",
      "--user",
      "0",
      pixelOverlay,
    ]),
  ]);
});

test("boot waits until the emulator records the policy event", async () => {
  let policyReads = 0;
  await waitForAndroidBoot(
    async (...args) => {
      if (args[0] === "wait-for-device") return "";
      assert.equal(policyReads, 2);
      return args[1] === "getprop" ? "1" : `[x] ${pixelOverlay}`;
    },
    { exitCode: null },
    async () => (++policyReads === 1 ? "" : policyMarker),
  );
});

test("boot rejects a missing policy event or a different device profile", async () => {
  await assert.rejects(
    waitForAndroidBoot(
      async (...args) => {
        assert.deepEqual(args, ["wait-for-device"]);
        return "";
      },
      { exitCode: 1 },
      async () => "DevicePolicyManager: starting",
    ),
    /device policy/,
  );
  await assert.rejects(
    waitForAndroidBoot(
      async (...args) => (args[1] === "getprop" ? "1" : "[x] other.profile"),
      { exitCode: 1 },
      async () => policyMarker,
    ),
    /hardware profile.*other.profile/,
  );
});

test("native instrumentation reports the last safe stage, local probe and PID on command failure", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ummka-instrumentation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = await startFixture(dir);
  t.after(() => fixture.close());
  await new Promise<void>((resolve, reject) => {
    get(
      {
        host: "127.0.0.1",
        port: fixture.ports[0],
        ca: fixture.ca,
        path: "/team/chat/one?sensitive=fixture-secret",
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      },
    ).on("error", reject);
  });
  // execFile includes argv, stderr and all stdout on the rejected Error.
  // The failing process deliberately puts a sentinel in each of these fields.
  const run = () =>
    promisify(execFile)(process.execPath, [
      "-e",
      'console.log("INSTRUMENTATION_STATUS: ummka_stage=sqlite\\nINSTRUMENTATION_STATUS: ummka_stage=transport\\nfixture-secret"); console.error("fixture-secret"); process.kill(process.pid, "SIGTERM");',
      "fixture-secret",
    ]).then(({ stdout }) => stdout);
  let pidReads = 0;
  await assert.rejects(
    checkNativeInstrumentation(
      run,
      async () => {
        pidReads++;
        return "1357\n";
      },
      fixture.lastNativeProbe,
    ),
    {
      message:
        "Android native HTTP check failed (SIGTERM). Stage: transport. Last local probe: 1 https/one. App process: PID 1357.",
    },
  );
  assert.equal(pidReads, 1);
});

test("a successful native run skips diagnostics; a non-passing result reports an absent process", async () => {
  const unused = (): never => {
    throw new Error("unexpected diagnostic read");
  };
  await checkNativeInstrumentation(
    async () =>
      "INSTRUMENTATION_RESULT: result=PASS\r\nINSTRUMENTATION_CODE: -1\r\n",
    unused,
    unused,
  );
  await assert.rejects(
    checkNativeInstrumentation(
      async () =>
        "INSTRUMENTATION_RESULT: result=PASS\nINSTRUMENTATION_CODE: 0\n",
      async () => {
        throw Object.assign(new Error("pidof"), { code: 1, stderr: "" });
      },
      () => "none",
    ),
    {
      message:
        "Android native HTTP check failed (invalid instrumentation result). Stage: not reported. Last local probe: none. App process: absent.",
    },
  );
});
