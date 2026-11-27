import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

const cases = {
  slow: "s",
  fast: "f",
  "thread-a": "a",
  "thread-b": "b",
  retry: "r",
  absent: "h",
  denied: "d",
  "late-denied": "l",
  blocked: "k",
  "cancel-response": "e",
  close: "c",
  disconnect: "n",
  retire: "t",
  peer: "p",
  invalid: "i",
  "server-limit": "m",
  stream: "u",
} as const;
type Name = keyof typeof cases;

export function draftFileUploadFixture() {
  const base = "/Drafts%20Site//A%2FB";
  const seen = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  const visits = new Map<Name, number>();
  const ids = new Set<string>();
  function waitFor(key: string) {
    if (seen.has(key)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const list = waiters.get(key) ?? [];
      list.push(resolve);
      waiters.set(key, list);
    });
  }
  function signal(key: string) {
    seen.add(key);
    for (const resolve of waiters.get(key) ?? []) resolve();
    waiters.delete(key);
  }

  async function upload(request: IncomingMessage, response: ServerResponse) {
    assert.equal(request.method, "POST");
    const parts: Buffer[] = [];
    let tail = Buffer.alloc(0);
    let reading = false;
    try {
      for await (const data of request) {
        const part = Buffer.from(data);
        parts.push(part);
        if (!reading) {
          tail = Buffer.concat([tail, part]);
          if (tail.includes('filename="reading.txt"')) {
            reading = true;
            signal("reading/seen");
            await waitFor("reading/release");
          }
          tail = tail.subarray(-64);
        }
      }
    } catch (error) {
      if (!request.destroyed) throw error;
      if (reading) signal("reading/closed");
      // The unknown-length fixture can hit a local byte limit after opening the
      // HTTP body. Its buffered prefix is allowed to be discarded by the client.
      return;
    }
    assert.equal(
      reading,
      false,
      "reading cancellation must interrupt the body",
    );
    const form = await new Response(new Uint8Array(Buffer.concat(parts)), {
      headers: { "Content-Type": request.headers["content-type"] ?? "" },
    }).formData();
    assert.deepEqual([...form.keys()], ["channel_id", "client_ids", "files"]);
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.ok(file.name.endsWith(".txt"));
    const name = file.name.slice(0, -4) as Name;
    assert.ok(Object.hasOwn(cases, name), file.name);
    assert.equal(
      request.headers.authorization,
      name === "peer" || name === "disconnect"
        ? "Bearer draft-peer"
        : "Bearer draft-member",
    );
    const channel = name === "peer" || name === "disconnect" ? "p" : "c";
    assert.equal(form.get("channel_id"), channel.repeat(26));
    assert.equal(await file.text(), name === "stream" ? "cloud" : name);
    const clientId = form.get("client_ids");
    assert.ok(typeof clientId === "string" && /^[a-f0-9-]{36}$/.test(clientId));
    assert.ok(!ids.has(clientId));
    ids.add(clientId);
    const count = (visits.get(name) ?? 0) + 1;
    visits.set(name, count);
    if (name === "retry" && count === 1) {
      request.socket.destroy();
      return;
    }
    response.once("close", () => signal(`${name}/closed`));
    signal(`${name}/seen`);
    if (
      [
        "slow",
        "thread-a",
        "late-denied",
        "cancel-response",
        "close",
        "disconnect",
        "retire",
      ].includes(name)
    ) {
      await waitFor(`${name}/release`);
    }
    const denied = ["denied", "late-denied", "cancel-response"].includes(name);
    const status = denied ? 403 : name === "server-limit" ? 413 : 201;
    response.writeHead(status, { "Content-Type": "application/json" }).end(
      JSON.stringify(
        status === 201
          ? {
              client_ids: [name === "invalid" ? "wrong-client-id" : clientId],
              file_infos: [
                {
                  id: cases[name].repeat(26),
                  channel_id: form.get("channel_id"),
                  user_id: (channel === "p" ? "b" : "a").repeat(26),
                  name: name === "fast" ? "renamed.txt" : file.name,
                  size: name === "fast" ? 20 : file.size,
                },
              ],
            }
          : {
              id: denied
                ? "api.context.permissions.app_error"
                : "api.file.upload_file.too_large_detailed.app_error",
              detailed_error: "private detail",
            },
      ),
    );
  }
  return {
    handle(request: IncomingMessage, response: ServerResponse) {
      const path = request.url ?? "";
      if (path === `${base}/api/v4/files`) {
        void upload(request, response);
        return true;
      }
      const control = path.match(
        /^\/draft-upload-check\/([a-z-]+)\/(seen|closed|release|count)$/,
      );
      if (!control) return false;
      const [, name, action] = control;
      if (action === "release") {
        signal(`${name}/release`);
        response.end("OK");
      } else if (action === "count") {
        response.end(String(visits.get(name as Name) ?? 0));
      } else {
        void waitFor(`${name}/${action}`).then(() => response.end("OK"));
      }
      return true;
    },
    verify(android: boolean) {
      assert.deepEqual(
        Object.fromEntries(visits),
        Object.fromEntries(
          Object.keys(cases)
            .filter((name) => name !== "stream" || android)
            .map((name) => [name, name === "retry" ? 2 : 1]),
        ),
      );
    },
  };
}
