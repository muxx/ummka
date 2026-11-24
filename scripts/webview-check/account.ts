import {
  forgetLocalAccount,
  listAccountIds,
  openAccountRestConnection,
} from "../../src/mattermost/native-rest.ts";
import {
  AppErrorFromJSON,
  Configuration,
  UsersApi,
} from "../../vendor/mattermost/index.js";

type Account = Awaited<ReturnType<typeof openAccountRestConnection>>;

function check(ok: unknown, name: string): asserts ok {
  if (!ok) throw Error(`account-${name}`);
}

export async function checkAccountResponses(
  first: Account,
  userId: string,
  observed: (step: string, name: string) => Promise<void>,
) {
  const secondId = "b".repeat(26);
  const second = await openAccountRestConnection(first.basePath, secondId);
  try {
    check(
      (await listAccountIds(first.basePath)).join(",") ===
        [userId, secondId].join(","),
      "restored-ids",
    );
    if (navigator.userAgent.includes("Android")) {
      const refusal = await forgetLocalAccount(first.basePath, userId).catch(
        (error: unknown) => error,
      );
      check(refusal === "credential_storage_unavailable", "commit-error");
    }
    for (const [account, name, id] of [
      [first, "first", userId],
      [second, "second", secondId],
    ] as const) {
      const users = new UsersApi(new Configuration(account));
      const result = await users.getUserRaw(
        { userId: "me" },
        { headers: { "X-Test-Case": name } },
      );
      check(
        !result.raw.headers.has("x-fixture-diagnostic") &&
          (await result.value()).id === id,
        name,
      );
    }
    const me = `${first.basePath}/api/v4/users/me`;
    for (const name of ["denied", "expired", "html", "large", "truncated"]) {
      const response = await first.fetchApi(me, {
        headers: { "X-Test-Case": name },
      });
      const status = name === "expired" ? 401 : 403;
      check(response.status === status, "status");
      check(
        response.headers.get("content-type") === "application/json" &&
          !response.headers.has("content-length") &&
          !response.headers.has("x-fixture-diagnostic") &&
          response.headers.get("www-authenticate") === "Bearer" &&
          response.headers.get("retry-after") === "7",
        "metadata",
      );
      const result = await response.json();
      const error = AppErrorFromJSON(result);
      check(
        error.statusCode === status && error.requestId === result.request_id,
        "generated-error",
      );
      const detailed = name === "denied" || name === "expired";
      const expected = ["status_code"];
      if (detailed) expected.push("id", "request_id");
      if (name === "denied") expected.push("message");
      check(
        Object.keys(result).sort().join(",") === expected.sort().join(","),
        "fields",
      );
      check(result.status_code === status, "actual-status");
      if (detailed)
        check(
          result.id === "fixture.refused" &&
            result.request_id === "public-request",
          "identity",
        );
      if (name === "denied")
        check(result.message === "Access denied", "message");
    }
    const controller = new AbortController();
    const response = await first.fetchApi(me, {
      signal: controller.signal,
      headers: { "X-Test-Case": "error-body" },
    });
    check(response.status === 403 && response.body, "error-stream-headers");
    const reason = new Error("cancel fixture error body");
    const read = response.body
      .getReader()
      .read()
      .catch((error: unknown) => error);
    controller.abort(reason);
    check((await read) === reason, "error-stream-abort");
    await observed("closed", "account-error-body");

    const pending = second
      .fetchApi(me, { headers: { "X-Test-Case": "retire" } })
      .catch((error: unknown) => error);
    await Promise.race([
      observed("received", "account-retire"),
      pending.then(() => {
        throw Error("account-retired-early");
      }),
    ]);
    await forgetLocalAccount(first.basePath, secondId);
    const retired = await pending;
    check(
      retired instanceof TypeError && retired.cause === "cancelled",
      "pending-forget",
    );
    await observed("closed", "account-retire");
    const stale = await second.fetchApi(me).catch((error: unknown) => error);
    check(
      stale instanceof TypeError && stale.cause === "unknown_connection",
      "old-handle",
    );
    await forgetLocalAccount(first.basePath, secondId);
  } finally {
    await second.close();
  }
}
