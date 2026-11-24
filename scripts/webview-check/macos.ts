import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

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

async function checkRestarts() {
  await launch("registry-removed");
  await launch("registry-confirmed");
}

export async function checkMacWebview(
  ports: number[],
  dir: string,
  config: string,
) {
  const env = {
    ...process.env,
    UMMKA_WEBVIEW_CHECK_PORTS: ports.join(","),
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
  await launch("PASS", env);
  if (process.env.UMMKA_CHECK_MACOS_OFFLINE === "1") {
    const { stdout } = await exec(
      "bash",
      ["scripts/with-macos-offline.sh", process.execPath, import.meta.filename],
      { env },
    );
    console.log(stdout.trim());
  } else {
    await checkRestarts();
  }
  const file = join(dir, "data", "installations.sqlite");
  await unlink(file);
  const query = (sql: string) =>
    execFileSync("/usr/bin/sqlite3", [file, sql], { encoding: "utf8" }).trim();
  query(
    "CREATE TABLE other(value TEXT); INSERT INTO other VALUES ('kept'); PRAGMA user_version = 3;",
  );
  const before = await readFile(file);
  await launch("registry-unsupported");
  assert.deepEqual(await readFile(file), before);
  assert.equal(query("SELECT value FROM other"), "kept");
}

if (import.meta.main) await checkRestarts();
