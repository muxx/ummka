import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { coldLink, warmLink } from "./link-examples.ts";

const exec = promisify(execFile);

/** LaunchServices explicitly addresses this disposable bundle. It registers no protocol handlers. */
export async function checkMacSystemLinks(dir: string, env: NodeJS.ProcessEnv) {
  const bundle = join(dir, "Link check.app");
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
  async function acknowledged(id: number) {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
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
    const pid = await acknowledged(1);
    await exec("/usr/bin/open", ["-g", "-a", bundle, warmLink]);
    assert.equal(await acknowledged(2), pid);
    console.log(
      "LaunchServices delivered both HTTPS links to one WKWebView process.",
    );
  } finally {
    const { stdout } = await exec("/bin/ps", ["-axo", "pid=,comm="]);
    for (const line of stdout.split("\n")) {
      const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
      if (match?.[2] === bin) process.kill(Number(match[1]), "SIGTERM");
    }
  }
}
