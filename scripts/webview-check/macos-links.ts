import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { coldLink, warmLink } from "./link-examples.ts";

const exec = promisify(execFile);

async function stopLinkCheck(bin: string, acknowledgedPid?: number) {
  const { stdout } = await exec("/bin/ps", ["-axww", "-o", "pid=,comm="]);
  const pids = new Set<number>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (match?.[2] === bin) pids.add(Number(match[1]));
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  // An empty path lookup cannot turn a still-running, acknowledged launch into a pass.
  if (acknowledgedPid !== undefined) pids.add(acknowledgedPid);
  const deadline = Date.now() + 5_000;
  while (pids.size) {
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        pids.delete(pid);
      }
    }
    if (!pids.size) return;
    assert(
      Date.now() < deadline,
      "the temporary Link check application is still running",
    );
    await delay(50);
  }
}

/** LaunchServices explicitly addresses this disposable bundle. It registers no protocol handlers. */
export async function checkMacSystemLinks(dir: string, env: NodeJS.ProcessEnv) {
  // LaunchServices reports /private/var even when TMPDIR starts with /var.
  const bundle = join(await realpath(dir), "Link check.app");
  const contents = join(bundle, "Contents");
  const bin = join(contents, "MacOS", "ummka-link-check");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  await copyFile("src-tauri/target/release/ummka", bin);
  await chmod(bin, 0o755);
  await writeFile(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>ummka-link-check</string>
<key>CFBundleIdentifier</key><string>io.github.muxx.ummka.link-check-${randomUUID()}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>`,
  );
  const output = join(dir, "link-launch.stdout");
  const stderr = join(dir, "link-launch.stderr");
  await writeFile(output, "");
  const variables = [
    "UMMKA_WEBVIEW_CHECK_PORTS",
    "UMMKA_CHECK_KEYCHAIN",
    "UMMKA_HTTP_TEST_CA",
  ];
  const extra = variables.flatMap((key) => {
    assert(env[key], `missing fixture environment ${key}`);
    return ["--env", `${key}=${env[key]}`];
  });
  const interrupted = new AbortController();
  const interrupt = () => interrupted.abort();
  async function acknowledged(id: number) {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      interrupted.signal.throwIfAborted();
      const text = await readFile(output, "utf8");
      assert(
        !text.includes("UMMKA_WEBVIEW_CHECK FAIL"),
        "the WebView rejected the system link",
      );
      const match = new RegExp(`^UMMKA_LINK_ACK ${id} (\\d+)$`, "mu").exec(
        text,
      );
      if (match) return Number(match[1]);
      await delay(100);
    }
    throw Error(`LaunchServices link ${id} was not acknowledged`);
  }
  let pid: number | undefined;
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    await exec("/usr/bin/open", [
      "-g",
      "-n",
      "-a",
      bundle,
      "--stdout",
      output,
      "--stderr",
      stderr,
      ...extra,
      coldLink,
    ]);
    pid = await acknowledged(1);
    await exec("/usr/bin/open", ["-g", "-a", bundle, warmLink]);
    assert.equal(await acknowledged(2), pid);
    console.log(
      "LaunchServices delivered both HTTPS links to one WKWebView process.",
    );
  } finally {
    try {
      await stopLinkCheck(bin, pid);
    } finally {
      process.off("SIGTERM", interrupt);
      process.off("SIGINT", interrupt);
    }
  }
}
