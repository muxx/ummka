import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  coldLink,
  postLinks,
  warmLink,
} from "../webview-check/link-examples.ts";
import { checkDocumentPicker } from "./android-document-picker.ts";

type Adb = (...args: string[]) => Promise<string>;
export type SendAndroidKey = (
  key: "KEYCODE_TAB" | "KEYCODE_BACK" | "KEYCODE_DPAD_RIGHT",
) => Promise<void>;
export const clipboardPolicySteps = [
  "true",
  "resume",
  "false",
  "malformed",
  "boolean",
  "unset",
] as const;
export type ClipboardPolicyStep = (
  step: (typeof clipboardPolicySteps)[number],
) => Promise<void>;
export type SwipeAndroid = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  duration?: number,
) => Promise<void>;
export type PreviewSwipeAndroid = (
  x: number,
  start: number,
  end: number,
) => Promise<void>;
export type RotateAndroid = (
  orientation: "landscape" | "portrait",
) => Promise<void>;
export type TapAndroid = (x: number, y: number) => Promise<void>;
export type AndroidImeBack = (x: number, y: number) => Promise<void>;
export type OnAndroidInputReady = (
  send: SendAndroidKey,
  swipe: SwipeAndroid,
  rotate: RotateAndroid,
  clipboard: ClipboardPolicyStep,
  swipePreview: PreviewSwipeAndroid,
  tap: TapAndroid,
  imeBack: AndroidImeBack,
) => void;

export async function launchWebview(
  adb: Adb,
  app: string,
  activity: string,
  expected: string,
  onAndroidInputReady?: OnAndroidInputReady,
  webviewProgress?: () => string,
) {
  async function waitForIme(shown: boolean, phase: string) {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const input = await adb("shell", "dumpsys", "input_method");
      const state = /\bmInputShown=(true|false)\b/u.exec(input)?.[1];
      if (state === String(shown)) return;
      assert(
        Date.now() < deadline,
        `Expected the Android IME to be ${shown ? "shown" : "hidden"} ${phase} (mInputShown=${state ?? "missing"})`,
      );
      await delay(50);
    }
  }
  const keyevent = async (key: Parameters<SendAndroidKey>[0]) => {
    await adb("shell", "input", "keyevent", key);
  };
  const send: SendAndroidKey = async (key) => {
    if (key === "KEYCODE_BACK")
      await waitForIme(false, "before app navigation");
    await keyevent(key);
  };
  const tap: TapAndroid = async (x, y) => {
    await adb("shell", "input", "tap", String(x), String(y));
  };
  onAndroidInputReady?.(
    send,
    async (x1, y1, x2, y2, duration = 320) => {
      await adb(
        "shell",
        "input",
        "swipe",
        String(x1),
        String(y1),
        String(x2),
        String(y2),
        String(duration),
      );
    },
    async (orientation) => {
      const target = orientation === "landscape" ? "1" : "0";
      const log = () =>
        adb(
          "logcat",
          "-d",
          "-v",
          "brief",
          "-s",
          "WindowManagerShell:V",
          "WindowManager:V",
        );
      const requested = new RegExp(
        `Transition requested \\(#(\\d+)\\):.*displayId = 0,.*endRotation = ${target},`,
        "gu",
      );
      const transition = (state: string) =>
        [...state.matchAll(requested)].at(-1)?.[1];
      const previous = transition(await log());
      await adb("shell", "cmd", "window", "user-rotation", "lock", target);

      // WebView resizes while Android is still transforming touch coordinates.
      // Wait for WindowManager to finish the specific physical rotation.
      const deadline = Date.now() + 5000;
      for (;;) {
        const state = await log();
        const id = transition(state);
        if (
          id &&
          id !== previous &&
          state.includes(`Finish Transition (#${id}):`)
        )
          break;
        assert(
          Date.now() < deadline,
          `Android did not finish rotating to ${orientation}`,
        );
        await delay(50);
      }
    },
    async (step) => {
      if (step === "resume") {
        const pid = (await adb("shell", "pidof", "-s", app)).trim();
        assert.match(pid, /^\d+$/u);
        assert.match(
          await adb(
            "shell",
            "am",
            "start",
            "-W",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.HOME",
          ),
          /Status: ok/u,
        );
        assert.match(
          await adb("shell", "am", "start", "-W", "-n", activity),
          /Status: ok/u,
        );
        assert.equal((await adb("shell", "pidof", "-s", app)).trim(), pid);
        return;
      }
      assert.match(
        await adb(
          "shell",
          "am",
          "broadcast",
          "-n",
          `${app}/io.github.muxx.ummka.dev.ClipboardPolicyCheckReceiver`,
          "--es",
          "value",
          step,
        ),
        /Broadcast completed: result=-1/u,
      );
    },
    async (x, start, end) => {
      const motion = async (action: string, y: number) => {
        await adb(
          "shell",
          "input",
          "motionevent",
          action,
          String(x),
          String(y),
        );
      };
      // input swipe can spend its entire duration delivering DOWN on a slow emulator.
      await motion("DOWN", start);
      for (const step of [1, 2, 3, 4])
        await motion("MOVE", Math.round(start + ((end - start) * step) / 4));
      await motion("UP", end);
    },
    tap,
    async (x, y) => {
      await tap(x, y);
      await waitForIme(true, "after tapping the search field");
      await keyevent("KEYCODE_BACK");
      await waitForIme(false, "after the keyboard's Back");
    },
  );
  assert.match(
    await adb("shell", "am", "start", "-W", "-n", activity),
    /Status: ok/,
  );
  const pid = (await adb("shell", "pidof", "-s", app)).trim();
  assert.match(pid, /^\d+$/);
  const launched = Date.now();
  const idleBudget = 65_000;
  let deadline = launched + idleBudget;
  const seenStages = new Set<string>();
  let browserStage = "no browser stage reported";
  const progress = () =>
    [`after ${Date.now() - launched} ms`, browserStage, webviewProgress?.()]
      .filter(Boolean)
      .join("; ");
  while (true) {
    const output = await adb(
      "logcat",
      "-d",
      `--pid=${pid}`,
      "-s",
      "RustStdoutStderr:I",
      "AndroidRuntime:E",
    );
    // Chromium's native fatal log can precede both the Android exception and our result marker.
    assert.doesNotMatch(output, /FATAL EXCEPTION|\[[^\]\r\n]*\bFATAL:/u);
    const step = [
      ...output.matchAll(
        /\bUMMKA_WEBVIEW_STEP (started|completed) ([a-z-]+)\b/gu,
      ),
    ].at(-1);
    if (step) {
      const current = `${step[1]} ${step[2]}`;
      // The full interactive run spans many independent UI and native checks.
      // Only a new stage observed before expiry earns more time.
      if (
        expected === "browser-checked" &&
        !seenStages.has(current) &&
        Date.now() < deadline
      ) {
        seenStages.add(current);
        deadline = Math.min(launched + 180_000, Date.now() + idleBudget);
      }
      if (browserStage !== current) {
        browserStage = current;
        console.log(`Android WebView process ${pid}: ${progress()}.`);
      }
    }
    const result = /UMMKA_WEBVIEW_CHECK ([\w-]+)/u.exec(output);
    if (result) {
      assert.equal(result[1], expected, `${progress()}\n${output}`);
      console.log(`Android WebView process ${pid} verified ${expected}.`);
      return pid;
    }
    assert(
      Date.now() < deadline,
      `Android WebView check timed out ${progress()}.\n${output}`,
    );
    await delay(500);
  }
}

async function stop(adb: Adb, app: string) {
  await adb("shell", "am", "force-stop", app);
  await waitForStop(adb, app);
}
async function waitForStop(adb: Adb, app: string) {
  const deadline = Date.now() + 8_000;
  while (
    (await adb("shell", "ps", "-A", "-o", "NAME")).split(/\s+/u).includes(app)
  ) {
    assert(Date.now() < deadline, "the fixture process did not stop");
    await delay(100);
  }
}

async function isOffline(adb: Adb) {
  return /^\s*Active default network: none\s*$/mu.test(
    await adb("shell", "dumpsys", "connectivity"),
  );
}

async function openSystemLink(
  adb: Adb,
  app: string,
  activity: string,
  href: string,
  id: number,
  requireShown = false,
) {
  const result = await adb(
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    activity,
    "-a",
    "android.intent.action.VIEW",
    "-d",
    href,
  );
  assert.match(result, /Status: ok/u);
  const pid = (await adb("shell", "pidof", "-s", app)).trim();
  assert.match(pid, /^\d+$/u);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const output = await adb(
      "logcat",
      "-d",
      `--pid=${pid}`,
      "-s",
      "RustStdoutStderr:I",
      "AndroidRuntime:E",
    );
    if (output.includes("UMMKA_WEBVIEW_CHECK FAIL")) {
      const line = output.match(/WebView check stopped at (fail=[^\r\n]+)/u);
      const detail = line && new URLSearchParams(line[1]).get("fail");
      throw Error(
        detail?.startsWith("system-post-flow ")
          ? detail
          : "Android WebView rejected the system link",
      );
    }
    assert.doesNotMatch(output, /FATAL EXCEPTION/u);
    if (
      (!requireShown ||
        output.includes("UMMKA_WEBVIEW_CHECK system-posts-shown")) &&
      output
        .split(/\r?\n/u)
        .some((line) => line.endsWith(`UMMKA_LINK_ACK ${id} ${pid}`))
    )
      return pid;
    await delay(100);
  }
  throw Error(`Android ACTION_VIEW link ${id} was not acknowledged`);
}

export async function checkWebviewProcesses(
  adb: Adb,
  app: string,
  component: string,
  onAndroidInputReady: OnAndroidInputReady,
  dataPort: number,
  webviewProgress: () => string,
) {
  const activity = `${component}MainActivity`;
  await adb(
    "shell",
    "cmd",
    "role",
    "add-role-holder",
    "--user",
    "0",
    "android.app.role.BROWSER",
    app,
  );
  // These synthetic addresses may only reach the test activity or have no receiver.
  const resolve = (href: string) =>
    adb(
      "shell",
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      href,
    );
  for (const href of [
    "https://external.ummka.invalid",
    "mailto:probe@ummka.invalid",
  ])
    assert(
      (await resolve(href)).trim().endsWith(`${component}BrowserCheckActivity`),
      "Fixture is not the selected external link handler",
    );
  assert.match(
    await resolve("mailto:unhandled@ummka.invalid"),
    /No activity found/u,
  );
  // Instrumentation may outlast the screen timeout on the disposable emulator.
  await adb("shell", "svc", "power", "stayon", "true");
  await adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  await adb("shell", "wm", "dismiss-keyguard");
  const seeded = await launchWebview(
    adb,
    app,
    activity,
    "browser-checked",
    onAndroidInputReady,
    webviewProgress,
  );
  await checkDocumentPicker(adb, component, seeded);
  const external = await adb(
    "logcat",
    "-d",
    `--pid=${seeded}`,
    "-s",
    "UmmkaPostLink:I",
  );
  assert.equal(
    external.match(/received external web/gu)?.length,
    1,
    "Android did not deliver exactly one external link to the fixture handler",
  );
  assert.equal(
    external.match(/received external mail/gu)?.length,
    1,
    "Android did not deliver exactly one mail link to the fixture handler",
  );
  // Instrumentation starts and ends a fresh fixture process even while its test CA is owned by the device admin.
  const restart = await adb(
    "shell",
    "am",
    "instrument",
    "-w",
    "-r",
    "-e",
    "checkpoint",
    "permalink",
    component + "HttpCheckInstrumentation",
  );
  assert.match(restart, /^INSTRUMENTATION_RESULT: checkpoint=permalink\r?$/mu);
  await waitForStop(adb, app);
  const posts = postLinks(dataPort);
  const systemPid = await openSystemLink(adb, app, activity, posts.cold, 1);
  assert.notEqual(systemPid, seeded);
  assert.equal(
    await openSystemLink(adb, app, activity, posts.warm, 2),
    systemPid,
  );
  assert.equal(
    await openSystemLink(adb, app, activity, posts.denied, 3, true),
    systemPid,
  );
  console.log(
    `Android focused the linked post and thread reply in process ${systemPid}; both deliveries were acknowledged.`,
  );
  // Android protects the device owner from force-stop. TLS checks have finished
  // using its test CA, so release ownership before testing process restarts.
  assert.match(
    await adb(
      "shell",
      "dpm",
      "remove-active-admin",
      `${component}HttpCheckAdmin`,
    ),
    /Success/,
  );
  await stop(adb, app);
  await adb("shell", "cmd", "connectivity", "airplane-mode", "enable");
  await adb("shell", "svc", "wifi", "disable");
  const deadline = Date.now() + 20_000;
  while (!(await isOffline(adb))) {
    assert(Date.now() < deadline, "the emulator still has a default network");
    await delay(250);
  }
  const removed = await launchWebview(adb, app, activity, "registry-removed");
  await stop(adb, app);
  const confirmed = await launchWebview(
    adb,
    app,
    activity,
    "registry-confirmed",
  );
  assert.equal(new Set([seeded, removed, confirmed]).size, 3);
  await stop(adb, app);
  const linkProcess = await openSystemLink(adb, app, activity, coldLink, 1);
  assert.notEqual(linkProcess, confirmed);
  assert.equal(
    await openSystemLink(adb, app, activity, warmLink, 2),
    linkProcess,
  );
  console.log(
    "ACTION_VIEW delivered both HTTPS links to one offline Android WebView process.",
  );
  assert(
    await isOffline(adb),
    "network isolation ended before reading the registry",
  );
}
