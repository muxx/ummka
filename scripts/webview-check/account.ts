import { invoke } from "@tauri-apps/api/core";
import {
  forgetLocalAccount,
  getCurrentAccountId,
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
  const confirmed = await openAccountRestConnection(
    `${first.basePath}/confirmed`,
    "d".repeat(26),
  );
  try {
    check(
      (await getCurrentAccountId(confirmed.basePath)) === "d".repeat(26),
      "current-before-sign-out",
    );
    const result = await confirmed.signOut();
    check(
      (await getCurrentAccountId(confirmed.basePath)) === null,
      "current-after-confirmed-sign-out",
    );
    check(
      result.status === "signed_out" && Object.keys(result).length === 1,
      "server-sign-out",
    );
    const old = await confirmed.signOut();
    check(
      old.status === "superseded" && Object.keys(old).length === 1,
      "superseded-sign-out",
    );
    check(
      (await confirmed.signOutOnDevice()) === "superseded",
      "superseded-local-sign-out",
    );
  } finally {
    await confirmed.close();
  }
  const secondId = "b".repeat(26);
  const second = await openAccountRestConnection(
    `${first.basePath}/secondary`,
    secondId,
  );
  try {
    check(
      (await listAccountIds(first.basePath)).join(",") === userId &&
        (await listAccountIds(second.basePath)).join(",") === secondId,
      "restored-ids",
    );
    if (navigator.userAgent.includes("Android")) {
      const base = `${new URL(first.basePath).origin}/vault-refusal`;
      const locked = await openAccountRestConnection(base, userId);
      try {
        const query = { ids: [userId], usernames: [] };
        const profile = (await first.readSavedProfiles(query)).profiles[userId];
        check(profile?.username === "fixture", "neighbor-has-saved-profile");
        await invoke("store_channel_profiles", {
          rid: locked.rid,
          profiles: [profile],
        });
        check(
          (await locked.readSavedProfiles(query)).profiles[userId]?.username ===
            "fixture",
          "store-before-refusal",
        );
        const result = await locked.signOut();
        check(
          result.status === "server_confirmed_local_removal_failed" &&
            result.cause === "credential_storage_unavailable" &&
            Object.keys(result).sort().join(",") === "cause,status",
          "confirmed-with-local-error",
        );
        const error = await locked
          .signOutOnDevice()
          .catch((error: unknown) => error);
        check(error === "credential_storage_unavailable", "local-retry-error");
        check(
          (await listAccountIds(base)).join(",") === userId,
          "failed-removal-is-durable",
        );
        const expired = await locked
          .readSavedProfiles(query)
          .catch((cause: unknown) => cause);
        check(
          expired === "session_unavailable",
          "purged-history-view-is-expired",
        );
        const refusal = await forgetLocalAccount(base, userId).catch(
          (cause: unknown) => cause,
        );
        check(refusal === "credential_storage_unavailable", "commit-error");
        const recovered = await openAccountRestConnection(base, userId);
        try {
          check(
            !Object.keys((await recovered.readSavedProfiles(query)).profiles)
              .length,
            "refused-vault-does-not-restore-purged-history",
          );
        } finally {
          await recovered.close();
        }
        check(
          (await first.readSavedProfiles(query)).profiles[userId]?.username ===
            "fixture",
          "neighbor-survives-failed-removal",
        );
      } finally {
        await locked.close();
      }
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

    const choice = await second.signOut();
    check(
      choice.status === "unconfirmed" && Object.keys(choice).length === 1,
      "unconfirmed-sign-out",
    );
    check(
      (await getCurrentAccountId(second.basePath)) === secondId,
      "kept-until-choice",
    );
    const secondMe = `${second.basePath}/api/v4/users/me`;
    const pending = second
      .fetchApi(secondMe, { headers: { "X-Test-Case": "retire" } })
      .catch((error: unknown) => error);
    await Promise.race([
      observed("received", "account-retire"),
      pending.then(() => {
        throw Error("account-retired-early");
      }),
    ]);
    check(
      (await second.signOutOnDevice()) === "removed",
      "explicit-local-sign-out",
    );
    check(
      (await getCurrentAccountId(second.basePath)) === null,
      "current-after-local-sign-out",
    );
    check(
      (await getCurrentAccountId(first.basePath)) === userId,
      "neighbor-still-current",
    );
    const retired = await pending;
    check(
      retired instanceof TypeError && retired.cause === "cancelled",
      "pending-forget",
    );
    await observed("closed", "account-retire");
    const stale = await second
      .fetchApi(secondMe)
      .catch((error: unknown) => error);
    check(
      stale instanceof TypeError && stale.cause === "unknown_connection",
      "old-handle",
    );
    await forgetLocalAccount(second.basePath, secondId);
  } finally {
    await second.close();
  }
}
