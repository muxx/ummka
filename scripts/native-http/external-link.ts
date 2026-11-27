import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";

/** The disposable GitHub macOS runner may use its default browser for a loopback receipt. */
export async function macExternalLinkReceiver() {
  if (process.env.UMMKA_CHECK_EXTERNAL_HANDOFF !== "1") return null;
  assert.equal(process.platform, "darwin");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  return startExternalLinkReceiver();
}

export async function startExternalLinkReceiver() {
  let reportReceipt!: (received: boolean) => void;
  const receipt = new Promise<boolean>((resolve) => {
    reportReceipt = resolve;
  });
  let received = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/post/@bear?value=a%2Fb") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        "<script>if(location.hash === '#anchor') fetch('/accepted',{method:'POST'})</script>",
      );
    } else if (request.method === "POST" && request.url === "/accepted") {
      received++;
      response.writeHead(204).end(() => reportReceipt(true));
    } else response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    href: `http://127.0.0.1:${address.port}/post/@bear?value=a%2Fb#anchor`,
    receipt,
    verify() {
      assert.equal(
        received,
        1,
        "The default macOS handler did not acknowledge exactly one link.",
      );
    },
    close() {
      reportReceipt(false);
      server.close();
      server.closeAllConnections();
    },
  };
}
