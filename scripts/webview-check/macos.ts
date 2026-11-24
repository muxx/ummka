import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const result = await promisify(execFile)("src-tauri/target/release/ummka", [], {
  timeout: 30_000,
});
assert.match(result.stdout, /^UMMKA_WEBVIEW_CHECK PASS$/m);
console.log(
  "WKWebView opened and closed native REST connections across a reload.",
);
