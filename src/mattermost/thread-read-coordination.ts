import { ResponseError } from "../../vendor/mattermost/index.js";
import type { accountFollowedThreads } from "./account-followed-threads.ts";
import { isMattermostId } from "./model-fields.ts";
import { canonicalServerUrl } from "./server-url.ts";
import type { ThreadPost } from "./thread-following.ts";

type Transport = Pick<
  ReturnType<typeof accountFollowedThreads>,
  | "markFollowedThreadRead"
  | "markThreadUnreadFromPost"
  | "readFollowedThreadState"
>;
type Target = Parameters<Transport["readFollowedThreadState"]>[0];
type ReadState = Awaited<ReturnType<Transport["markFollowedThreadRead"]>>;
type Action = "auto" | "read" | "unread";
type Unknown = Readonly<{ action: Action }>;
type Manual =
  | { kind: "read" }
  | {
      kind: "unread";
      lastPost: (signal: AbortSignal) => Promise<ThreadPost | null>;
    };
type NotSent = {
  kind: "not-sent";
  reason:
    | "busy"
    | "cancelled"
    | "access"
    | "empty"
    | "failed"
    | "previous-unknown";
  error?: unknown;
  previous?: Unknown;
};
type Outcome =
  | { kind: "confirmed"; mark: ReadState }
  | { kind: "refused"; error: ResponseError }
  | { kind: "unknown"; attempt: Unknown; error: unknown }
  | NotSent;
type Running = { action: Action; sent: boolean; cancel: () => void };
type Waiting = {
  cancel: (outcome: NotSent) => void;
  settle: (outcome: Outcome) => void;
};
type Root = {
  visit?: symbol;
  revision?: symbol;
  active?: Running;
  waiting?: Waiting;
  unknown?: Unknown;
};
const cancelled = Symbol("Thread read operation cancelled");

function notSent(reason: NotSent["reason"], error?: unknown): NotSent {
  return {
    kind: "not-sent",
    reason,
    ...(error === undefined ? {} : { error }),
  };
}

function accessRefused(outcome: Outcome) {
  return outcome.kind === "refused" && outcome.error.response.status !== 400;
}

// There is one owner per App. A team and a replacement RID route requests for
// a root, but neither owns the state of an earlier write to that root.
export function createThreadReadCoordination(deadlineMs = 15_000) {
  const roots = new Map<string, Root>();
  const connections = new Map<string, AbortController>();
  return {
    bind(serverUrl: string, userId: string, connection: Transport) {
      const account = JSON.stringify([canonicalServerUrl(serverUrl), userId]);
      connections.get(account)?.abort();
      const lifetime = new AbortController();
      connections.set(account, lifetime);
      return {
        close() {
          if (connections.get(account) === lifetime)
            connections.delete(account);
          lifetime.abort();
        },
        visit(target: Target) {
          const { teamId, channelId, rootId } = target;
          if (![teamId, channelId, rootId].every(isMattermostId))
            throw new TypeError("Invalid Mattermost thread read target.");
          lifetime.signal.throwIfAborted();
          const key = JSON.stringify([account, rootId]);
          const root = roots.get(key) ?? {};
          roots.set(key, root);
          const visit = Symbol();
          root.visit = visit;
          root.waiting?.cancel(notSent("cancelled"));
          let manual = false;
          let autoConfirmed = false;
          let revoked = false;

          function available() {
            return !lifetime.signal.aborted && root.visit === visit && !revoked;
          }
          function blocked(): NotSent {
            return { ...notSent("previous-unknown"), previous: root.unknown };
          }
          async function write(
            command: { kind: "auto" } | Manual,
            observer?: AbortSignal,
          ): Promise<Outcome> {
            const controller = new AbortController();
            const { signal } = controller;
            root.revision = Symbol();
            const operation: Running = {
              action: command.kind,
              sent: false,
              cancel: () => controller.abort(cancelled),
            };
            root.active = operation;
            const deadline = setTimeout(
              () =>
                controller.abort(
                  new Error("Thread read confirmation timed out"),
                ),
              deadlineMs,
            );
            const ownerClosed = operation.cancel;
            const stopObserving = () => {
              if (!operation.sent) operation.cancel();
            };
            lifetime.signal.addEventListener("abort", ownerClosed, {
              once: true,
            });
            observer?.addEventListener("abort", stopObserving, { once: true });
            const onSend = () => {
              operation.sent = true;
            };
            let rejectAbort: (reason: unknown) => void;
            const interrupted = new Promise<never>((_, reject) => {
              rejectAbort = reject;
            });
            const onAbort = () => rejectAbort(signal.reason);
            signal.addEventListener("abort", onAbort, { once: true });
            async function request() {
              if (command.kind === "unread") {
                const post = await command.lastPost(signal);
                signal.throwIfAborted();
                if (post === null) return null;
                if ((post.rootId ?? post.id) !== rootId)
                  throw new TypeError(
                    "Expected a post from the requested thread.",
                  );
                return connection.markThreadUnreadFromPost(
                  teamId,
                  post,
                  signal,
                  onSend,
                );
              }
              return connection.markFollowedThreadRead(
                teamId,
                rootId,
                Date.now(),
                signal,
                onSend,
              );
            }
            let outcome: Outcome;
            try {
              const mark = await Promise.race([request(), interrupted]);
              signal.throwIfAborted();
              outcome = mark ? { kind: "confirmed", mark } : notSent("empty");
              if (mark && command.kind === "auto") autoConfirmed = true;
            } catch (error) {
              const status =
                error instanceof ResponseError
                  ? error.response.status
                  : undefined;
              const access = status === 401 || status === 403;
              if (access) revoked = true;
              if (!operation.sent) {
                if (revoked) outcome = notSent("access", error);
                else if (signal.reason === cancelled)
                  outcome = notSent("cancelled");
                else outcome = notSent("failed", error);
                // POST can return 400 after changing following. Both routes can
                // return 404 while constructing the receipt after a write.
              } else if (
                error instanceof ResponseError &&
                (access || (status === 400 && command.kind !== "unread"))
              ) {
                outcome = { kind: "refused", error };
              } else {
                const attempt = { action: command.kind };
                root.unknown = attempt;
                outcome = { kind: "unknown", attempt, error };
              }
            } finally {
              clearTimeout(deadline);
              signal.removeEventListener("abort", onAbort);
              observer?.removeEventListener("abort", stopObserving);
              lifetime.signal.removeEventListener("abort", ownerClosed);
              root.active = undefined;
              root.revision = Symbol();
            }
            root.waiting?.settle(outcome);
            return outcome;
          }
          return {
            getUncertainty: () => root.unknown,
            async observe(signal?: AbortSignal) {
              const revision = root.revision;
              const active = signal
                ? AbortSignal.any([lifetime.signal, signal])
                : lifetime.signal;
              active.throwIfAborted();
              if (!available())
                throw new DOMException("Thread read visit ended", "AbortError");
              const state = await connection.readFollowedThreadState(
                target,
                active,
              );
              active.throwIfAborted();
              if (!available() || root.revision !== revision)
                throw new DOMException(
                  "Thread read observation superseded",
                  "AbortError",
                );
              return state;
            },
            auto(observer: AbortSignal) {
              if (!available() || observer.aborted)
                return Promise.resolve(notSent("cancelled"));
              if (root.unknown) return Promise.resolve(blocked());
              if (manual || autoConfirmed || root.active)
                return Promise.resolve(notSent("busy"));
              return write({ kind: "auto" }, observer);
            },
            manual(command: Manual, afterUnknown?: Unknown): Promise<Outcome> {
              if (!available()) return Promise.resolve(notSent("cancelled"));
              if (root.unknown !== afterUnknown)
                return Promise.resolve(blocked());
              if (
                root.waiting ||
                (root.active && root.active.action !== "auto")
              )
                return Promise.resolve(notSent("busy"));
              manual = true;
              if (root.unknown) {
                // Consuming the permission to proceed does not settle the old write.
                root.unknown = { action: root.unknown.action };
              }
              if (!root.active) return write(command);
              const pendingAuto = root.active;
              return new Promise((resolve) => {
                function cancel(outcome: NotSent) {
                  root.waiting = undefined;
                  lifetime.signal.removeEventListener("abort", ownerClosed);
                  resolve(outcome);
                }
                function ownerClosed() {
                  cancel(notSent("cancelled"));
                }
                root.waiting = {
                  cancel,
                  settle(outcome) {
                    if (root.unknown) cancel(blocked());
                    else if (
                      accessRefused(outcome) ||
                      (outcome.kind === "not-sent" &&
                        outcome.reason === "access")
                    )
                      cancel(notSent("access"));
                    else if (!available()) ownerClosed();
                    else {
                      root.waiting = undefined;
                      lifetime.signal.removeEventListener("abort", ownerClosed);
                      resolve(write(command));
                    }
                  },
                };
                lifetime.signal.addEventListener("abort", ownerClosed, {
                  once: true,
                });
                if (!pendingAuto.sent) pendingAuto.cancel();
              });
            },
            revoke() {
              if (!available()) return;
              revoked = true;
              root.waiting?.cancel(notSent("access"));
              if (root.active && !root.active.sent) root.active.cancel();
            },
          };
        },
      };
    },
  };
}

export type ThreadReadCoordination = ReturnType<
  typeof createThreadReadCoordination
>;
export type AccountThreadReads = ReturnType<ThreadReadCoordination["bind"]>;
export type ThreadReadVisit = ReturnType<AccountThreadReads["visit"]>;
