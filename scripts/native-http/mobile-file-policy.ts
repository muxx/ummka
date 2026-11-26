import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

export function mobileFilePolicyFixture() {
  const actions = [
    "allow",
    "deny",
    "missing",
    "malformed",
    "duplicate",
    "forbidden",
    "unexpected",
    "too-large",
    "truncated",
    "cancel",
    "close",
    "retire",
  ] as const;
  const events = new EventEmitter();
  const waiting = new Map(
    ["cancel", "close", "retire"].map((key) => [key, once(events, key)]),
  );
  const departed = Promise.all(
    [...waiting.keys()].map((key) => once(events, `closed-${key}`)),
  );
  let index = 0;
  let peer = 0;
  function handle(req: IncomingMessage, res: ServerResponse) {
    const path = req.url ?? "";
    if (path === "/mobile-policy-check/departed") {
      void departed.then(() => res.end("OK"));
      return true;
    }
    if (path.startsWith("/mobile-policy-check/")) {
      const ready = waiting.get(path.slice("/mobile-policy-check/".length));
      assert(ready);
      void ready.then(() => res.end("OK"));
      return true;
    }
    if (!path.startsWith("/Policy%20") && !path.startsWith("/Peer%20Policy"))
      return false;
    const isPeer = path.startsWith("/Peer%20Policy");
    const prefix = isPeer ? "Peer%20Policy" : "Policy%20Site";
    assert.equal(path, `/${prefix}//A%2FB/api/v4/config/client?format=old`);
    assert.equal(req.method, "GET");
    assert.equal(
      req.headers.authorization,
      isPeer ? "Bearer mobile-policy-peer" : "Bearer mobile-policy-member",
    );
    assert.equal(req.headers.cookie, undefined);
    if (isPeer) {
      peer++;
      res.end('{"EnableMobileFileDownload":"false"}');
      return true;
    }
    const action = actions[index++];
    switch (action) {
      case "allow":
        res.end('{"Other":true,"EnableMobileFileDownload":"true"}');
        break;
      case "deny":
        res.end('{"EnableMobileFileDownload":"false"}');
        break;
      case "missing":
        res.end("{}");
        break;
      case "malformed":
        res.end('{"EnableMobileFileDownload":true}');
        break;
      case "duplicate":
        res.end(
          '{"EnableMobileFileDownload":"true","EnableMobileFileDownload":"true"}',
        );
        break;
      case "forbidden":
        res.writeHead(403).end(
          JSON.stringify({
            id: "config.refused",
            message: "mobile-policy-member",
            detailed_error: "private",
            request_id: "policy-request",
          }),
        );
        break;
      case "unexpected":
        res.writeHead(204).end();
        break;
      case "too-large":
        res.write(" ".repeat(1024 * 1024));
        res.end('{"EnableMobileFileDownload":"true"}');
        break;
      case "truncated":
        res
          .writeHead(200, { "Content-Length": 99 })
          .write('{"EnableMobileFileDownload":"true"}', () => res.destroy());
        break;
      case "close":
      case "cancel":
      case "retire":
        req.socket.once("close", () => events.emit(`closed-${action}`));
        res.write('{"EnableMobileFileDownload":"true"}');
        events.emit(action);
        break;
      default:
        throw Error("Unexpected additional mobile export policy request");
    }
    return true;
  }
  return {
    handle,
    verify() {
      assert.equal(index, actions.length);
      assert.equal(peer, 1);
    },
  };
}
