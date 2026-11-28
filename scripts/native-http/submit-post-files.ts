import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";

const channel = "filesroom".padEnd(26, "0");
const thread = "filesparent".padEnd(26, "0");

export function fileSubmissionFixture(
  userId: string,
  signal: (name: string, step: "received" | "closed") => void,
) {
  let firstAttempt: string | undefined;
  let finishRetry: (() => void) | undefined;
  return {
    release() {
      assert(finishRetry);
      finishRetry();
      finishRetry = undefined;
    },
    respond(
      body: Record<string, unknown>,
      res: ServerResponse,
      prefixed: boolean,
      search: string,
    ) {
      if (body.channel_id !== channel) return;
      assert(prefixed);
      assert.equal(search, "");
      const pending = body.pending_post_id;
      assert(typeof pending === "string" && pending.startsWith(`${userId}:`));
      const idList = (letters: string) =>
        [...letters].map((id) => id.repeat(26));
      const check = (message: string, files: string, root?: string) =>
        assert.deepEqual(body, {
          channel_id: channel,
          message,
          pending_post_id: pending,
          file_ids: idList(files),
          ...(root && { root_id: root }),
        });
      const accepted = (
        id: string,
        files: string,
        root: string,
        echoedKey: string,
      ) =>
        res.writeHead(201, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            id: id.padEnd(26, "0"),
            channel_id: channel,
            user_id: userId,
            root_id: root,
            message: body.message,
            pending_post_id: echoedKey,
            file_ids: idList(files),
            delete_at: 0,
          }),
        );
      switch (body.message) {
        case "Reordered files":
          check("Reordered files", "ef");
          accepted("reorderedfiles", "fe", "", pending);
          return "submit-file-reordered";
        case "Two queued files":
          check("Two queued files", "za");
          if (!firstAttempt) {
            firstAttempt = pending;
            res.destroy();
            return "submit-file-unknown";
          }
          assert.equal(pending, firstAttempt);
          assert.equal(finishRetry, undefined);
          finishRetry = () => accepted("filecanonical", "a", "", "");
          signal("submit-file-retry", "received");
          return "submit-file-retry";
        case "":
          check("", "b", thread);
          accepted("filereply", "b", thread, pending);
          return "submit-file-only-reply";
        case "Rejected files":
          check("Rejected files", "c");
          res.writeHead(403, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              id: "api.context.permissions.app_error",
              status_code: 403,
              message: "Fixture refused the file post",
            }),
          );
          return "submit-file-refused";
        case "Close after files":
          check("Close after files", "d");
          res.once("close", () => signal("submit-file-retire", "closed"));
          signal("submit-file-retire", "received");
          return "submit-file-retire";
        default:
          assert.fail("Unexpected file submission");
      }
    },
  };
}
