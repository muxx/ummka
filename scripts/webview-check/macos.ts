import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, cp, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { postLinks } from "./link-examples.ts";
import { checkMacSystemLinks } from "./macos-links.ts";

const exec = promisify(execFile);

export type SendMacKey = (
  key: "right-down" | "right-up" | "escape" | "enter",
) => Promise<void>;
type KeyDriver = (send: SendMacKey, completed: (stage: string) => void) => void;
type InteractiveFixture = {
  registerKey: KeyDriver;
  progress: () => string;
};
const windowStepTimeout = 10_000;

export function watchWebviewSteps(expire: () => void, timeoutMs: number) {
  const steps = new Set<string>();
  let timer: NodeJS.Timeout | undefined = setTimeout(expire, timeoutMs);
  return {
    completed(stage: string, budget = timeoutMs) {
      if (!timer || steps.has(stage)) return;
      steps.add(stage);
      clearTimeout(timer);
      timer = setTimeout(expire, budget);
    },
    close() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

async function reportMainThread(pid: number) {
  try {
    const { stdout } = await exec(
      "/usr/bin/sample",
      [String(pid), "1", "10", "-file", "/dev/stdout"],
      { timeout: 4000 },
    );
    const lines = stdout.split("\n");
    const start = lines.findIndex((line) =>
      /^ {4}\d+ Thread_.*com\.apple\.main-thread/u.test(line),
    );
    assert(start >= 0, "sample contains no main thread");
    const end = lines.findIndex(
      (line, index) =>
        index > start && (!line.trim() || /^ {4}\d+ Thread_/u.test(line)),
    );
    console.error(
      lines
        .slice(start, Math.min(end < 0 ? lines.length : end, start + 64))
        .join("\n"),
    );
  } catch (error) {
    console.error(
      "Could not sample the fixture main thread",
      error instanceof Error ? error.message : error,
    );
  }
}

async function launch(
  expected: string,
  env = process.env,
  fixture?: InteractiveFixture,
) {
  const processRun = exec("src-tauri/target/release/ummka", [], {
    // The interactive suite also has a deadline for each distinct fixture step.
    timeout: fixture ? 300_000 : 45_000,
    env,
  });
  let lastWebviewStep = "no browser stage reported";
  let lastWindowStep: string | undefined;
  let stalled = false;
  const watchdog = fixture
    ? watchWebviewSteps(
        () => {
          stalled = true;
          console.error(
            `WKWebView made no further progress after ${lastWindowStep ?? lastWebviewStep}`,
          );
          console.error(
            "macOS WebView before termination:",
            fixture.progress(),
          );
          const pid = processRun.child.pid;
          if (pid)
            void reportMainThread(pid).finally(() => processRun.child.kill());
          else processRun.child.kill();
        },
        expected === "workspace-back" ? 30_000 : 120_000,
      )
    : undefined;
  try {
    if (fixture && watchdog) {
      const input = processRun.child.stdin;
      const output = processRun.child.stdout;
      assert(input && output);
      const outputLines = createInterface({ input: output });
      outputLines.on("line", (line) => {
        const step = /^UMMKA_WEBVIEW_STEP (started|completed) ([a-z-]+)$/u.exec(
          line,
        );
        if (!step) return;
        if (step[2].startsWith("window-lifetime-")) {
          lastWindowStep = `${step[1]} ${step[2]}`;
          watchdog.completed(lastWindowStep, windowStepTimeout);
          return;
        }
        lastWebviewStep = `${step[1]} ${step[2]}`;
        if (!lastWindowStep) watchdog.completed(`browser ${lastWebviewStep}`);
      });
      const lines = outputLines[Symbol.asyncIterator]();
      fixture.registerKey(
        async (key) => {
          await new Promise<void>((resolve, reject) => {
            input.write(`${key}\n`, (error) =>
              error ? reject(error) : resolve(),
            );
          });
          // Each serial fixture command waits for AppKit to dispatch its event.
          // A successful pipe write only means that Node queued bytes for the child.
          for (;;) {
            const line = await lines.next();
            assert(!line.done, `Fixture exited before dispatching ${key}`);
            if (!line.value.startsWith("UMMKA_KEY_DISPATCHED ")) continue;
            assert.equal(line.value, `UMMKA_KEY_DISPATCHED ${key}`);
            return;
          }
        },
        (stage) => {
          // Server progress does not acknowledge the native client's receipt.
          if (!lastWindowStep) watchdog.completed(stage);
        },
      );
    }
    const { stdout } = await processRun;
    assert(!stalled, `WKWebView stalled at ${lastWebviewStep}`);
    assert(
      stdout.split(/\r?\n/u).includes(`UMMKA_WEBVIEW_CHECK ${expected}`),
      stdout,
    );
    const stage = fixture
      ? ` (last browser stage: ${lastWebviewStep}; last native stage: ${lastWindowStep ?? "none"})`
      : "";
    console.log(
      `WKWebView process ${processRun.child.pid} verified ${expected}${stage}.`,
    );
  } finally {
    watchdog?.close();
  }
}

async function checkRestartsAndLinks(dir: string, env = process.env) {
  await launch("registry-removed", env);
  await launch("registry-confirmed", env);
  await checkMacSystemLinks(dir, env);
}

export async function checkMacWebview(
  ports: number[],
  dir: string,
  config: string,
  fixture: InteractiveFixture,
  workspaceBackOnly = false,
) {
  const keychain = join(dir, "sessions.keychain-db");
  const env = {
    ...process.env,
    UMMKA_WEBVIEW_CHECK_PORTS: ports.join(","),
    UMMKA_CHECK_KEYCHAIN: keychain,
    UMMKA_HTTP_TEST_CA: join(dir, "trusted.pem"),
  };
  execFileSync(
    "npm",
    [
      "run",
      "tauri",
      "--",
      "build",
      "--no-bundle",
      "--config",
      config,
      "--features",
      "webview-check",
      "--",
      "--locked",
    ],
    { env, stdio: "inherit" },
  );
  const security = (...args: string[]) =>
    execFileSync("/usr/bin/security", args);
  const original = security("list-keychains", "-d", "user");
  const password = randomUUID();
  security("create-keychain", "-p", password, keychain);
  try {
    security("unlock-keychain", "-p", password, keychain);
    await launch("credentials-seeded", {
      ...env,
      UMMKA_CHECK_SEED_ACCOUNTS: "1",
    });
    await launch(
      workspaceBackOnly ? "workspace-back" : "PASS",
      { ...env, UMMKA_CHECK_KEY_INPUT: "1" },
      fixture,
    );
    if (workspaceBackOnly) return;
    await checkMacSystemLinks(dir, env, postLinks(ports[0]));
    // The ordinary build verifies the actual NSWindow without showing anything on a developer's Mac.
    await launch("browser-anchor", {
      ...env,
      UMMKA_CHECK_BROWSER_PRESENTATION: "anchor",
    });
    if (process.env.UMMKA_CHECK_MACOS_BROWSER === "1") {
      const bundle = join(dir, "BrowserCheck.app");
      await cp("src-tauri/target/release/bundle/macos/ummka.app", bundle, {
        recursive: true,
      });
      const executable = join(bundle, "Contents", "MacOS", "ummka");
      await copyFile("src-tauri/target/release/ummka", executable);
      await exec("/usr/bin/codesign", ["--force", "--sign", "-", bundle]);
      const picker = await exec(executable, [], {
        timeout: 95_000,
        env: { ...env, UMMKA_CHECK_DOCUMENT_PICKER: "lifecycle" },
      });
      assert.match(picker.stdout, /^UMMKA_PICKER_STAGE checked$/mu);
      console.log(
        "AppKit attached one- and multiple-file panels, blocked duplicates, reopened and cancelled when the owner closed.",
      );
      const { stdout } = await exec(executable, [], {
        timeout: 45_000,
        env: { ...env, UMMKA_CHECK_BROWSER_PRESENTATION: "start" },
      });
      assert(
        stdout.split(/\r?\n/u).includes("UMMKA_WEBVIEW_CHECK browser-started"),
        stdout,
      );
      console.log(
        "AuthenticationServices opened and cancelled a session anchored to the application window.",
      );
    }
    if (process.env.UMMKA_CHECK_MACOS_OFFLINE === "1") {
      const { stdout } = await exec(
        "bash",
        [
          "scripts/with-macos-offline.sh",
          process.execPath,
          import.meta.filename,
        ],
        { env },
      );
      console.log(stdout.trim());
    } else {
      await checkRestartsAndLinks(dir, env);
    }
    const file = join(dir, "data", "installations.sqlite");
    await unlink(file);
    const query = (sql: string) =>
      execFileSync("/usr/bin/sqlite3", [file, sql], {
        encoding: "utf8",
      }).trim();
    query(
      "CREATE TABLE other(value TEXT); INSERT INTO other VALUES ('kept'); PRAGMA user_version = 3;",
    );
    const before = await readFile(file);
    await launch("registry-unsupported", env);
    assert.deepEqual(await readFile(file), before);
    assert.equal(query("SELECT value FROM other"), "kept");
  } finally {
    security("delete-keychain", keychain);
    assert(
      original.equals(security("list-keychains", "-d", "user")),
      "fixture changed the user Keychain search list",
    );
  }
}

if (import.meta.main) {
  const keychain = process.env.UMMKA_CHECK_KEYCHAIN;
  assert(keychain);
  await checkRestartsAndLinks(dirname(keychain));
}
