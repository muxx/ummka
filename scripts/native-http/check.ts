import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildWebviewFixture } from "../webview-check/build.ts";
import { checkMacWebview } from "../webview-check/macos.ts";
import { checkAndroid } from "./android.ts";
import { macExternalLinkReceiver } from "./external-link.ts";
import { startFixture } from "./fixture.ts";

const platform = process.argv[2];
assert(
  platform === "macos" || platform === "android",
  "expected macos or android",
);
const dir = await mkdtemp(join(tmpdir(), "ummka-http-"));
const external = platform === "macos" ? await macExternalLinkReceiver() : null;
try {
  const fixture = await startFixture(dir);
  try {
    const config = await buildWebviewFixture(
      dir,
      fixture.webviewPorts,
      platform,
      external?.href,
    );
    if (platform === "android")
      await checkAndroid(
        dir,
        fixture.ports,
        fixture.webviewPorts,
        fixture.ca,
        config,
        fixture.onAndroidInputReady,
        fixture.lastNativeProbe,
      );
    else {
      const result = await promisify(execFile)(
        "cargo",
        [
          "test",
          "--locked",
          "--features",
          "native-http-check",
          "--lib",
          "native_http::checks::wire",
          "--",
          "--exact",
          "--nocapture",
        ],
        {
          cwd: "src-tauri",
          timeout: 300_000,
          env: {
            ...process.env,
            UMMKA_HTTP_PORTS: fixture.ports.join(","),
            UMMKA_HTTP_TEST_CA: join(dir, "trusted.pem"),
          },
        },
      );
      assert.match(result.stdout, /1 passed/);
      await checkMacWebview(
        fixture.webviewPorts,
        dir,
        config,
        fixture.onMacInputReady,
      );
    }
    external?.verify();
    fixture.verify(platform === "android");
    console.log(
      `Generated Mattermost requests verified in the ${platform} WebView: installation profile, users, team channels, channel history and JSON profile batches, HTTP states, TLS and abort.`,
    );
    console.log(
      `Native HTTP verified on ${platform}: installation scope, TLS, connection reuse, HTTP/2 streams, redirects, cookies, cancellation and disconnects.`,
    );
  } finally {
    fixture.close();
  }
} finally {
  external?.close();
  await rm(dir, { recursive: true, force: true });
}
