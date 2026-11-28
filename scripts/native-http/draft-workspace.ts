import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { arrayBuffer } from "node:stream/consumers";

const fileIds = new Map([
  ["bridge-slow", "s"],
  ["bridge-fast", "f"],
  ["bridge-retry", "r"],
  ["bridge-denied", "d"],
  ["bridge-hold", "h"],
]);
const channelId = "draftfileworkspace".padEnd(26, "0");

export function draftWorkspaceFixture(
  userId: string,
  signal: (name: string, step: "received" | "closed") => void,
) {
  const attempts = new Map<string, number>();
  const requestIds = new Set<string>();
  let releaseSlow: (() => void) | undefined;
  return {
    release() {
      assert(releaseSlow, "missing held draft upload");
      releaseSlow();
      releaseSlow = undefined;
    },
    async respond(req: IncomingMessage, res: ServerResponse, url: URL) {
      if (url.pathname !== "/team/chat/api/v4/files") return;
      assert.equal(req.method, "POST");
      assert.equal(url.search, "");
      assert.equal(
        req.headers.authorization,
        "Bearer fixture-prefixed-session",
      );
      assert.equal(req.headers.cookie, undefined);
      const form = await new Response(await arrayBuffer(req), {
        headers: { "Content-Type": req.headers["content-type"] ?? "" },
      }).formData();
      assert.deepEqual([...form.keys()], ["channel_id", "client_ids", "files"]);
      assert.equal(form.get("channel_id"), channelId);
      const file = form.get("files");
      assert(file instanceof File && file.name.endsWith(".txt"));
      const name = file.name.slice(0, -4);
      const id = fileIds.get(name);
      assert(id, `unexpected draft upload ${name}`);
      assert.equal(await file.text(), name);
      const requestId = form.get("client_ids");
      assert(
        typeof requestId === "string" && /^[a-f0-9-]{36}$/u.test(requestId),
      );
      assert(!requestIds.has(requestId));
      requestIds.add(requestId);
      const attempt = (attempts.get(name) ?? 0) + 1;
      attempts.set(name, attempt);
      const visit = `${name}-${attempt}`;
      const accept = () =>
        res.writeHead(201, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            client_ids: [requestId],
            file_infos: [
              {
                id: id.repeat(26),
                name: name === "bridge-fast" ? "confirmed-fast.txt" : file.name,
                size: file.size,
                channel_id: channelId,
                user_id: userId,
              },
            ],
          }),
        );
      if (name === "bridge-retry" && attempt === 1) {
        res.destroy();
      } else if (name === "bridge-denied") {
        res.writeHead(403, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            id: "api.context.permissions.app_error",
            message: "Fixture rejects upload",
          }),
        );
      } else if (name === "bridge-slow") {
        assert.equal(releaseSlow, undefined);
        releaseSlow = accept;
        signal(visit, "received");
      } else if (name === "bridge-hold") {
        res.once("close", () => signal(visit, "closed"));
        signal(visit, "received");
      } else {
        accept();
      }
      return visit;
    },
  };
}
