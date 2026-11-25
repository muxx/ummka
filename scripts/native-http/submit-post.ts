import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";

export function submissionFixture(userId: string, received: () => void) {
  const channel = "submitroom".padEnd(26, "0");
  const root = "submissionroot".padEnd(26, "0");
  let rejectedId: string | undefined;
  let uncertainId: string | undefined;
  let release: (() => void) | undefined;
  return {
    release() {
      assert(release);
      release();
      release = undefined;
    },
    respond(
      body: Record<string, unknown>,
      res: ServerResponse,
      prefixed: boolean,
      search: string,
    ) {
      if (body.channel_id !== channel) return;
      const message = body.message;
      assert.equal(search, "");
      assert.equal(prefixed, message !== "Sign-in expired");
      const id = body.pending_post_id;
      assert.equal(typeof id, "string");
      assert.ok(typeof id === "string" && id.startsWith(`${userId}:`));
      const inThread =
        message === "Declined reply" || message === "Corrected reply";
      assert.deepEqual(
        Object.keys(body).sort(),
        (inThread
          ? ["channel_id", "message", "pending_post_id", "root_id"]
          : ["channel_id", "message", "pending_post_id"]
        ).sort(),
      );
      if (inThread) assert.equal(body.root_id, root);
      const json = (status: number, payload: object) =>
        res
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(payload));
      const accept = (postId: string, author = userId, echo = true) =>
        json(201, {
          id: postId,
          channel_id: channel,
          user_id: author,
          root_id: inThread ? root : "",
          message,
          delete_at: 0,
          ...(echo && { pending_post_id: id }),
        });
      const denied = () =>
        json(403, {
          id: "api.context.permissions.app_error",
          message: "Fixture channel is read only",
          detailed_error: "internal diagnostic",
        });
      switch (message) {
        case "  **First** 🐻‍❄️\n":
          assert.equal(release, undefined);
          release = () => {
            accept(root);
          };
          received();
          return "submit-root";
        case "Declined reply":
          assert.equal(rejectedId, undefined);
          rejectedId = id;
          denied();
          return "submit-refused";
        case "Corrected reply":
          assert.equal(id, rejectedId);
          accept("submissionreply".padEnd(26, "0"), userId, false);
          return "submit-corrected";
        case "Response lost":
          if (!uncertainId) {
            uncertainId = id;
            json(503, {
              id: "fixture.gateway",
              message: "No upstream response",
            });
            return "submit-unknown";
          }
          assert.equal(id, uncertainId);
          denied();
          return "submit-unknown-retry";
        case "Wrong author":
          accept("foreignsubmission".padEnd(26, "0"), "x".repeat(26));
          return "submit-wrong-author";
        case "Sign-in expired":
          json(401, { id: "api.context.session_expired", message: "Expired" });
          return "submit-expired";
        default:
          assert.fail("Unknown submission in fixture");
      }
    },
  };
}
