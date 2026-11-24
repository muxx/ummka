import { loadInstallationProfile } from "../../src/mattermost/installation-profile.ts";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";
import {
  Configuration,
  FetchError,
  type InitOverrideFunction,
  ResponseError,
  SystemApi,
  UsersApi,
} from "../../vendor/mattermost/index.js";
import { checkChannelHistory } from "./history.ts";
import { checkTeamReads } from "./team-reads.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

async function rejected(action: Promise<unknown>) {
  try {
    await action;
  } catch (error) {
    return error;
  }
  throw Error("generated request unexpectedly succeeded");
}

export async function checkGeneratedRequests(ports: string[]) {
  const origin = `https://127.0.0.1:${ports[0]}`;
  const root = await openNativeRestConnection(origin);
  const prefixed = await openNativeRestConnection(`${origin}/team/chat///`);
  const control = await openNativeRestConnection(
    `https://127.0.0.1:${ports[1]}`,
  );
  const foreign = await openNativeRestConnection(
    `https://127.0.0.1:${ports[2]}`,
  );
  const query = { useRestSemantics: true };
  const api = new SystemApi(new Configuration(prefixed));
  function scenario(name: string, signal?: AbortSignal): InitOverrideFunction {
    return async ({ init }) => {
      const headers = new Headers(init.headers);
      headers.set("X-Test-Case", name);
      return { headers, signal };
    };
  }
  async function observed(step: string, name: string) {
    const response = await control.fetchApi(
      `${control.basePath}/api/v4/system/ping?step=${step}&case=${name}`,
    );
    check(
      response.status === 204 && response.body === null,
      "generated-control",
    );
  }
  async function checkAbort(
    name: string,
    send: (overrides: InitOverrideFunction) => Promise<{ raw: Response }>,
  ) {
    const beforeHeaders = new AbortController();
    const pending = rejected(send(scenario("headers", beforeHeaders.signal)));
    await Promise.race([
      observed("received", `${name}-headers`),
      pending.then(() => {
        throw Error(`${name}-ended-before-server-received`);
      }),
    ]);
    const reason = new Error("fixture cancelled");
    beforeHeaders.abort(reason);
    const stopped = await pending;
    check(
      stopped instanceof FetchError && stopped.cause === reason,
      `${name}-abort-headers`,
    );
    await observed("closed", `${name}-headers`);

    const duringBody = new AbortController();
    const { raw } = await send(scenario("body", duringBody.signal));
    check(raw.body, `${name}-missing-body`);
    const reader = raw.body.getReader();
    check(
      new TextDecoder().decode((await reader.read()).value) === "A",
      `${name}-first-byte`,
    );
    const tail = rejected(reader.read());
    duringBody.abort(reason);
    check((await tail) === reason, `${name}-abort-body`);
    await observed("closed", `${name}-body`);
  }
  try {
    const atRoot = await new SystemApi(new Configuration(root)).getPing(query);
    check(atRoot.status === "OK", "generated-root");
    const first = await api.getPing(query);
    const second = await api.getPing(query);
    check(first.status === "OK" && second.status === "OK", "generated-prefix");
    const anonymousUser = new UsersApi(new Configuration(root));
    const unauthenticated = await rejected(
      anonymousUser.getUserRaw({ userId: "me" }),
    );
    check(
      unauthenticated instanceof ResponseError &&
        unauthenticated.response.status === 401,
      "generated-user-auth",
    );
    check(
      (await unauthenticated.response.json()).message === "session required",
      "generated-user-error-body",
    );
    const signed = new Configuration({
      ...prefixed,
      accessToken: "synthetic-session",
    });
    const users = new UsersApi(signed);
    const userId = "Abc01234567890123456789012";
    const batch = { requestBody: [userId, "b".repeat(26)], since: 123 };
    const profiles = await (await users.getUsersByIdsRaw(batch)).value();
    check(
      profiles.length === 2 &&
        profiles[0]?.id === batch.requestBody[1] &&
        profiles[0].firstName === "Юлия" &&
        profiles[1]?.id === userId,
      "generated-user-batch",
    );
    const unsignedBatch = await rejected(anonymousUser.getUsersByIdsRaw(batch));
    check(
      unsignedBatch instanceof ResponseError &&
        unsignedBatch.response.status === 401 &&
        (await unsignedBatch.response.json()).message === "session required",
      "generated-user-batch-auth",
    );
    const rawText = await root.fetchApi(`${root.basePath}/api/v4/users/ids`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Test-Case": "text",
      },
      body: '\ufeff ["Привет 👋"]\n',
    });
    check(rawText.status === 204 && rawText.body === null, "native-utf8-body");
    const user = await (await users.getUserRaw({ userId })).value();
    check(
      user.id === userId &&
        user.firstName === "Ada" &&
        user.username === "fixture",
      "generated-user",
    );
    const rootSession = new Configuration({
      ...root,
      accessToken: "synthetic-session",
    });
    await checkTeamReads(rootSession, signed);
    await checkChannelHistory(rootSession, signed, new Configuration(root));
    const profile = await loadInstallationProfile(
      prefixed,
      new AbortController().signal,
    );
    check(
      profile.version === "10.10.1" &&
        profile.siteName === "Fixture" &&
        profile.ssoProviders.join(",") === "gitlab" &&
        profile.passwordIdentifiers.length === 0 &&
        !profile.guestMagicLink,
      "generated-installation-profile",
    );
    check(
      (await api.getPing(query, scenario("unhealthy"))).status === "UNHEALTHY",
      "generated-unhealthy",
    );
    const http = await rejected(api.getPing(query, scenario("error")));
    check(
      http instanceof ResponseError && http.response.status === 503,
      "generated-http-error",
    );
    check(
      (await http.response.json()).message === "unavailable",
      "generated-error-body",
    );
    const redirect = await rejected(api.getPing(query, scenario("redirect")));
    check(
      redirect instanceof FetchError &&
        redirect.cause instanceof TypeError &&
        redirect.cause.cause === "redirect",
      "generated-redirect",
    );
    const tls = await rejected(
      new SystemApi(new Configuration(foreign)).getPing(query),
    );
    check(
      tls instanceof FetchError &&
        tls.cause instanceof TypeError &&
        tls.cause.cause === "network",
      "generated-tls",
    );

    await checkAbort("ping", (init) => api.getPingRaw(query, init));
    await checkAbort("batch", (init) => users.getUsersByIdsRaw(batch, init));
  } finally {
    await Promise.all([
      root.close(),
      prefixed.close(),
      control.close(),
      foreign.close(),
    ]);
  }
}
