import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const app = "io.github.muxx.ummka.dev";
const deviceProfile = "pixel_6";

export async function checkAndroid(
  dir: string,
  ports: number[],
  webviewPorts: number[],
  ca: Buffer,
  config: string,
) {
  const sdk = process.env.ANDROID_HOME;
  assert(sdk, "ANDROID_HOME is required");
  assert(
    process.arch === "arm64" || process.arch === "x64",
    "an ARM64 or x86_64 emulator host is required",
  );
  const arm = process.arch === "arm64";
  const abi = arm ? "arm64-v8a" : "x86_64";
  const ndk = process.env.NDK_HOME;
  assert(ndk, "NDK_HOME is required");
  assert(
    process.platform === "darwin" || process.platform === "linux",
    "run the emulator check on macOS or Linux",
  );
  const target = arm ? "aarch64-linux-android" : "x86_64-linux-android";
  const llvm = join(
    ndk,
    "toolchains/llvm/prebuilt",
    process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64",
    "bin",
  );
  const cargoTarget = target.replaceAll("-", "_");
  execFileSync(
    "cargo",
    [
      "clippy",
      "--locked",
      "--lib",
      "--target",
      target,
      "--features",
      "native-http-check,webview-check",
      "--",
      "-D",
      "warnings",
    ],
    {
      cwd: "src-tauri",
      stdio: "inherit",
      env: {
        ...process.env,
        [`CC_${cargoTarget}`]: join(llvm, `${target}24-clang`),
        [`AR_${cargoTarget}`]: join(llvm, "llvm-ar"),
        [`CARGO_TARGET_${cargoTarget.toUpperCase()}_LINKER`]: join(
          llvm,
          `${target}24-clang`,
        ),
      },
    },
  );
  execFileSync(
    "npm",
    [
      "run",
      "tauri",
      "--",
      "android",
      "build",
      "--ci",
      "--apk",
      "--target",
      arm ? "aarch64" : "x86_64",
      "--config",
      config,
      "--features",
      "native-http-check,webview-check",
      "--",
      "--locked",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        ORG_GRADLE_PROJECT_ummkaNativeHttpCheck: "true",
      },
    },
  );
  const apk =
    "src-tauri/gen/android/app/build/native-http-check/outputs/apk/universal/release/app-universal-release.apk";
  const env = { ...process.env, ANDROID_AVD_HOME: join(dir, "avd") };
  await mkdir(env.ANDROID_AVD_HOME);
  const name = `ummka_http_${process.pid}`;
  execFileSync(
    join(sdk, "cmdline-tools/latest/bin/avdmanager"),
    [
      "create",
      "avd",
      "-n",
      name,
      "-k",
      `system-images;android-36;default;${abi}`,
      "-d",
      deviceProfile,
    ],
    { input: "no\n", env },
  );

  const control = createServer();
  control.listen(0, "127.0.0.1");
  await once(control, "listening");
  const address = control.address();
  assert(address && typeof address !== "string");
  const log = join(dir, "emulator.log");
  const fd = openSync(log, "w");
  const emulator = spawn(
    join(sdk, "emulator/emulator"),
    [
      "-avd",
      name,
      "-no-window",
      "-no-snapshot",
      "-no-audio",
      "-gpu",
      "swiftshader",
      "-camera-back",
      "none",
      "-camera-front",
      "none",
      "-report-console",
      `tcp:${address.port},max=30`,
    ],
    { env, stdio: ["ignore", fd, fd] },
  );
  closeSync(fd);
  const stopOnExit = () => emulator.kill("SIGKILL");
  const stopOnSignal = (signal: NodeJS.Signals) => {
    stopOnExit();
    // The once listener has been removed. Preserve the caller's signal status.
    process.kill(process.pid, signal);
  };
  process.once("exit", stopOnExit);
  process.once("SIGINT", stopOnSignal);
  process.once("SIGTERM", stopOnSignal);
  const ended = new Promise<void>((resolve) =>
    emulator.once("close", () => resolve()),
  );
  try {
    await once(emulator, "spawn");
    const [socket] = await once(control, "connection", {
      signal: AbortSignal.timeout(45_000),
    });
    let reported = "";
    for await (const part of socket) reported += part;
    assert.match(reported, /^\d{4,5}$/);
    const adb = async (...args: string[]) =>
      (
        await exec(
          join(sdk, "platform-tools/adb"),
          ["-s", `emulator-${reported}`, ...args],
          { timeout: 90_000, maxBuffer: 2 << 20 },
        )
      ).stdout;
    const deadline = Date.now() + 180_000;
    while (
      (
        await adb("wait-for-device", "shell", "getprop", "sys.boot_completed")
      ).trim() !== "1"
    ) {
      assert(
        Date.now() < deadline && emulator.exitCode === null,
        "emulator did not boot",
      );
      await delay(1000);
    }
    assert.equal((await adb("emu", "avd", "name")).split(/\r?\n/)[0], name);
    await adb("shell", "wm", "dismiss-keyguard");
    for (const port of [...ports, ...webviewPorts])
      await adb("reverse", `tcp:${port}`, `tcp:${port}`);
    assert.match(await adb("install", "-t", apk), /Success/);
    const component = `${app}.httpcheck/${app}.`;
    // After BOOT_COMPLETED, API 36 checks device owner eligibility and applies the
    // hardware profile overlay. Applying it recreates an already running activity.
    const overlay = `com.android.internal.emulation.${deviceProfile}`;
    const bootDeadline = Date.now() + 90_000;
    while (
      !(await adb("logcat", "-d", "-s", "DevicePolicyManager:I")).includes(
        "Finished calculating hasIncompatibleAccountsTask",
      ) ||
      (
        await adb("shell", "cmd", "overlay", "list", "--user", "0", overlay)
      ).trim() !== `[x] ${overlay}`
    ) {
      assert(
        Date.now() < bootDeadline,
        "Android did not finish device policy and hardware profile initialization",
      );
      await delay(500);
    }
    assert.match(
      await adb(
        "shell",
        "dpm",
        "set-device-owner",
        `${component}HttpCheckAdmin`,
      ),
      /Success/,
    );
    const result = await adb(
      "shell",
      "am",
      "instrument",
      "-w",
      "-r",
      "-e",
      "ca",
      ca.toString("base64"),
      "-e",
      "ports",
      ports.join(","),
      `${component}HttpCheckInstrumentation`,
    );
    assert.match(result, /^INSTRUMENTATION_RESULT: result=PASS\r?$/m);
    assert.match(result, /^INSTRUMENTATION_CODE: -1\r?$/m);
    const launch = await adb(
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      `${component}MainActivity`,
    );
    assert.match(launch, /Status: ok/);
    const until = Date.now() + 65_000;
    while (true) {
      const output = await adb(
        "logcat",
        "-d",
        "-s",
        "RustStdoutStderr:I",
        "AndroidRuntime:E",
      );
      assert.doesNotMatch(output, /UMMKA_WEBVIEW_CHECK FAIL|FATAL EXCEPTION/);
      if (output.includes("UMMKA_WEBVIEW_CHECK PASS")) break;
      assert(
        Date.now() < until && emulator.exitCode === null,
        `Android WebView check timed out.\n${output}`,
      );
      await delay(500);
    }
    console.log(
      "Android WebView opened and closed native REST connections across a reload.",
    );
  } catch (error) {
    console.error((await readFile(log, "utf8")).slice(-1500));
    throw error;
  } finally {
    control.close();
    if (emulator.exitCode === null) emulator.kill();
    const kill = setTimeout(() => emulator.kill("SIGKILL"), 8000);
    try {
      await ended;
    } finally {
      clearTimeout(kill);
      process.off("exit", stopOnExit);
      process.off("SIGINT", stopOnSignal);
      process.off("SIGTERM", stopOnSignal);
    }
  }
}
