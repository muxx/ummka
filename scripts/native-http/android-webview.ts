import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { coldLink, warmLink } from "../webview-check/link-examples.ts";

type Adb = (...args: string[]) => Promise<string>;

export async function launchWebview(
  adb: Adb,
  app: string,
  activity: string,
  expected: string,
) {
  assert.match(
    await adb("shell", "am", "start", "-W", "-n", activity),
    /Status: ok/,
  );
  // Enter hardware keyboard mode so Chromium delivers real DOM focus events.
  if (expected === "browser-checked")
    await adb("shell", "input", "keyevent", "KEYCODE_TAB");
  const pid = (await adb("shell", "pidof", "-s", app)).trim();
  assert.match(pid, /^\d+$/);
  const deadline = Date.now() + 65_000;
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
    const result = /UMMKA_WEBVIEW_CHECK ([\w-]+)/u.exec(output);
    if (result) {
      assert.equal(result[1], expected, output);
      console.log(`Android WebView process ${pid} verified ${expected}.`);
      return pid;
    }
    assert(
      Date.now() < deadline,
      `Android WebView check timed out.\n${output}`,
    );
    await delay(500);
  }
}

async function stop(adb: Adb, app: string) {
  await adb("shell", "am", "force-stop", app);
  const deadline = Date.now() + 8_000;
  while (
    (await adb("shell", "ps", "-A", "-o", "NAME")).split(/\s+/u).includes(app)
  ) {
    assert(Date.now() < deadline, "the app process survived force-stop");
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
    assert.doesNotMatch(output, /FATAL EXCEPTION|UMMKA_WEBVIEW_CHECK FAIL/u);
    if (
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
  // Instrumentation may outlast the screen timeout on the disposable emulator.
  await adb("shell", "svc", "power", "stayon", "true");
  await adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  await adb("shell", "wm", "dismiss-keyguard");
  const seeded = await launchWebview(adb, app, activity, "browser-checked");
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
