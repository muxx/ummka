import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { checkMacSystemLinks } from "./macos-links.ts";

const exec = promisify(execFile);

async function launch(expected: string, env = process.env) {
  const processRun = exec("src-tauri/target/release/ummka", [], {
    timeout: 45_000,
    env,
  });
  const { stdout } = await processRun;
  assert(
    stdout.split(/\r?\n/u).includes(`UMMKA_WEBVIEW_CHECK ${expected}`),
    stdout,
  );
  console.log(
    `WKWebView process ${processRun.child.pid} verified ${expected}.`,
  );
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
    await launch("PASS", env);
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
