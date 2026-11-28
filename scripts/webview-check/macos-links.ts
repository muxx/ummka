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
import {
  coldLink,
  type postLinks,
  type SystemPostWindowMode,
  warmLink,
} from "./link-examples.ts";

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
export async function checkMacSystemLinks(
  dir: string,
  env: NodeJS.ProcessEnv,
  posts?: ReturnType<typeof postLinks>,
  windowMode?: SystemPostWindowMode,
  rejectInvalid = false,
) {
  // LaunchServices reports /private/var even when TMPDIR starts with /var.
  const scenario = rejectInvalid ? "invalid-link" : windowMode;
  const bundle = join(
    await realpath(dir),
    scenario
      ? `Post link ${scenario} check.app`
      : posts
        ? "Post link check.app"
        : "Link check.app",
  );
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
<key>LSUIElement</key>${posts ? "<false/>" : "<true/>"}
</dict></plist>`,
  );
  const log = scenario ? `link-launch-${scenario}` : "link-launch";
  const output = join(dir, `${log}.stdout`);
  const stderr = join(dir, `${log}.stderr`);
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
  if (posts) extra.push("--env", "UMMKA_CHECK_SYSTEM_POST_WINDOW=1");
  if (windowMode) {
    assert(posts);
    extra.push("--env", `UMMKA_CHECK_SCENARIO=system-post-${windowMode}`);
  }
  const background = posts ? [] : ["-g"];
  const interrupted = new AbortController();
  const interrupt = () => interrupted.abort();
  async function trace(pattern: RegExp) {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      interrupted.signal.throwIfAborted();
      const text = await readFile(output, "utf8");
      if (text.includes("UMMKA_WEBVIEW_CHECK FAIL")) {
        const failure = (await readFile(stderr, "utf8")).match(
          /^WebView check stopped at (fail=.+)$/mu,
        );
        const detail = failure && new URLSearchParams(failure[1]).get("fail");
        throw Error(
          detail?.startsWith("system-post-flow ")
            ? detail
            : "The WebView rejected the system link",
        );
      }
      const match = pattern.exec(text);
      if (match) return match;
      await delay(100);
    }
    throw Error(`LaunchServices did not report ${pattern.source}`);
  }
  async function acknowledged(id: number) {
    return Number(
      (await trace(new RegExp(`^UMMKA_LINK_ACK ${id} (\\d+)$`, "mu")))[1],
    );
  }
  let pid: number | undefined;
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    await exec("/usr/bin/open", [
      ...background,
      "-n",
      "-a",
      bundle,
      "--stdout",
      output,
      "--stderr",
      stderr,
      ...extra,
      posts?.cold ?? coldLink,
    ]);
    pid = await acknowledged(1);
    if (windowMode) {
      const initial = await trace(/^UMMKA_LINK_WINDOW initial (\d+) .+$/mu);
      const prepared = await trace(/^UMMKA_LINK_WINDOW prepared (\d+) .+$/mu);
      assert.equal(Number(initial[1]), pid);
      assert.equal(Number(prepared[1]), pid);
      console.log(`${windowMode} ${initial[0]}\n${windowMode} ${prepared[0]}`);
    }
    if (rejectInvalid) {
      assert(posts && windowMode === "minimized");
      await exec("/usr/bin/open", [
        "-a",
        bundle,
        `${posts.warm}?fixture-rejected-link`,
      ]);
      const rejected = await trace(
        /^UMMKA_LINK_WINDOW rejected (\d+) (true|false) .+$/mu,
      );
      console.log(rejected[0]);
      assert.equal(Number(rejected[1]), pid);
      assert.equal(
        rejected[2],
        "true",
        "an invalid link restored the minimized window",
      );
    }
    await exec("/usr/bin/open", [
      ...background,
      "-a",
      bundle,
      (windowMode ? posts?.warm : posts?.warmNamedReply) ?? warmLink,
    ]);
    assert.equal(await acknowledged(2), pid);
    if (posts) await trace(/^UMMKA_WEBVIEW_CHECK system-posts-shown$/mu);
    if (windowMode) {
      const presented = await trace(/^UMMKA_LINK_WINDOW presented (\d+) .+$/mu);
      assert.equal(Number(presented[1]), pid);
      console.log(`${windowMode} ${presented[0]}`);
    }
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
  if (windowMode) {
    const text = await readFile(output, "utf8");
    assert.deepEqual(
      text.match(/^UMMKA_LINK_ACK .*$/gmu),
      [`UMMKA_LINK_ACK 1 ${pid}`, `UMMKA_LINK_ACK 2 ${pid}`],
      `unexpected acknowledgements for the ${windowMode} window`,
    );
    console.log(
      `LaunchServices restored the ${windowMode} window to the focused reply and preserved the draft.`,
    );
  }
}
