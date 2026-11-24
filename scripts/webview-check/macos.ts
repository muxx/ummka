import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

export async function checkMacWebview(
  ports: number[],
  ca: string,
  config: string,
) {
  const env = {
    ...process.env,
    UMMKA_WEBVIEW_CHECK_PORTS: ports.join(","),
    UMMKA_HTTP_TEST_CA: ca,
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
  const result = await promisify(execFile)(
    "src-tauri/target/release/ummka",
    [],
    { timeout: 45_000, env },
  );
  assert.match(result.stdout, /^UMMKA_WEBVIEW_CHECK PASS$/m);
  console.log(
    "WKWebView verified REST connection lifetime, binary reads and cancellation.",
  );
}
