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

export function isGitHubHostedMac(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
) {
  return (
    platform === "darwin" &&
    env.GITHUB_ACTIONS === "true" &&
    env.RUNNER_ENVIRONMENT === "github-hosted"
  );
}

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

async function reportWebKitThreads(pid: number) {
  try {
    const { stdout } = await exec(
      "/usr/bin/sample",
      [String(pid), "1", "10", "-file", "/dev/stdout"],
      { timeout: 4000 },
    );
    const threads = stdout.split(/(?=^ {4}\d+ Thread_)/mu);
    const sampled = threads.filter(
      (thread) =>
        /^ {4}\d+ Thread_.*(?:com\.apple\.main-thread|scrolling)/iu.test(
          thread,
        ) ||
        (/^ {4}\d+ Thread_/u.test(thread) &&
          /displayDidRefreshOnScrollingThread|waitForRenderingUpdateCompletionOrTimeout/u.test(
            thread,
          )),
    );
    assert(sampled.length > 0, "sample contains no UI or scrolling thread");
    for (const thread of sampled)
      console.error(thread.split("\n").slice(0, 64).join("\n").trimEnd());
  } catch (error) {
    console.error(
      "Could not sample the fixture's WebKit threads",
      error instanceof Error ? error.message : error,
    );
  }
}

async function launch(
  expected: string,
  env = process.env,
  fixture?: InteractiveFixture,
  stepBudget = 120_000,
) {
  const processRun = exec("src-tauri/target/release/ummka", [], {
    // The interactive suite also has a deadline for each distinct fixture step.
    timeout: fixture ? 300_000 : 45_000,
    env,
  });
  if (fixture)
    console.log(
      `WKWebView process ${processRun.child.pid} started ${expected}.`,
    );
  let lastWebviewStep = "no browser stage reported";
  let lastWindowStep: string | undefined;
  let stalled = false;
  const watchdog = fixture
    ? watchWebviewSteps(() => {
        stalled = true;
        console.error(
          `WKWebView made no further progress after ${lastWindowStep ?? lastWebviewStep}`,
        );
        console.error("macOS WebView before termination:", fixture.progress());
        const pid = processRun.child.pid;
        if (pid)
          void reportWebKitThreads(pid).finally(() => processRun.child.kill());
        else processRun.child.kill();
      }, stepBudget)
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
  {
    workspaceBackOnly,
    externalHandoff,
  }: {
    workspaceBackOnly: boolean;
    externalHandoff: boolean;
  },
) {
  const keychain = join(dir, "sessions.keychain-db");
  const env = {
    ...process.env,
    UMMKA_WEBVIEW_CHECK_PORTS: ports.join(","),
    UMMKA_CHECK_KEYCHAIN: keychain,
    UMMKA_HTTP_TEST_CA: join(dir, "trusted.pem"),
  };
  const os = execFileSync("/usr/bin/sw_vers", [], { encoding: "utf8" }).trim();
  const webkit = execFileSync(
    "/usr/libexec/PlistBuddy",
    [
      "-c",
      "Print CFBundleVersion",
      "/System/Library/Frameworks/WebKit.framework/Versions/A/Resources/Info.plist",
    ],
    { encoding: "utf8" },
  ).trim();
  console.log(`WKWebView fixture host:\n${os}\nWebKit: ${webkit}`);
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
    // A width has its own scrolling tree and dies before the next window opens.
    if (!workspaceBackOnly) {
      for (const width of [320, 820])
        await launch(
          `formatting-${width}`,
          {
            ...env,
            UMMKA_CHECK_KEY_INPUT: "1",
            UMMKA_CHECK_SCENARIO: `formatting-${width}`,
          },
          fixture,
        );
      await launch("PASS", { ...env, UMMKA_CHECK_KEY_INPUT: "1" }, fixture);
    }
    // Back needs an active window and an independent event loop, even after
    // the preceding REST and formatting checks have completed successfully.
    await launch(
      "workspace-back",
      {
        ...env,
        UMMKA_CHECK_KEY_INPUT: "1",
        UMMKA_CHECK_SCENARIO: "workspace-back",
      },
      fixture,
      workspaceBackOnly ? 30_000 : undefined,
    );
    if (workspaceBackOnly) return;
    const posts = postLinks(ports[0]);
    await checkMacSystemLinks(dir, env, posts);
    const linkWindowFailures: unknown[] = [];
    for (const [mode, rejectInvalid] of [
      ["hidden", false],
      ["minimized", false],
      ["minimized", true],
    ] as const) {
      try {
        await checkMacSystemLinks(dir, env, posts, mode, rejectInvalid);
      } catch (error) {
        linkWindowFailures.push(error);
      }
    }
    if (linkWindowFailures.length)
      throw new AggregateError(
        linkWindowFailures,
        "macOS system link window checks failed",
      );
    // The ordinary build verifies the actual NSWindow without showing anything on a developer's Mac.
    await launch("browser-anchor", {
      ...env,
      UMMKA_CHECK_BROWSER_PRESENTATION: "anchor",
    });
    if (isGitHubHostedMac(process.platform, env)) {
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
    // The default browser may take the foreground after its launch request returns.
    // Wait for its HTTP receipt after every check that needs the fixture window.
    if (externalHandoff)
      await launch("external-handoff", {
        ...env,
        UMMKA_CHECK_SCENARIO: "external-handoff",
      });
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
