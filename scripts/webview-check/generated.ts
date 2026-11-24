import { loadInstallationProfile } from "../../src/mattermost/installation-profile.ts";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";
import {
  Configuration,
  FetchError,
  ResponseError,
  SystemApi,
  UsersApi,
} from "../../vendor/mattermost/index.js";

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
  function scenario(name: string) {
    return { headers: { "X-Test-Case": name } };
  }
  async function observed(step: string, name: string) {
    const response = await control.fetchApi(
      `${control.basePath}/api/v4/system/ping?step=${step}&case=ping-${name}`,
    );
    check(
      response.status === 204 && response.body === null,
      "generated-control",
    );
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
    const users = new UsersApi(
      new Configuration({ ...prefixed, accessToken: "synthetic-session" }),
    );
    const userId = "Abc01234567890123456789012";
    const user = await (await users.getUserRaw({ userId })).value();
    check(
      user.id === userId &&
        user.firstName === "Ada" &&
        user.username === "fixture",
      "generated-user",
    );
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

    const beforeHeaders = new AbortController();
    const pending = rejected(
      api.getPing(query, {
        ...scenario("headers"),
        signal: beforeHeaders.signal,
      }),
    );
    await observed("received", "headers");
    const reason = new Error("fixture cancelled");
    beforeHeaders.abort(reason);
    const stopped = await pending;
    check(
      stopped instanceof FetchError && stopped.cause === reason,
      "generated-abort-headers",
    );
    await observed("closed", "headers");

    const duringBody = new AbortController();
    const { raw } = await api.getPingRaw(query, {
      ...scenario("body"),
      signal: duringBody.signal,
    });
    check(raw.body, "generated-missing-body");
    const reader = raw.body.getReader();
    check(
      new TextDecoder().decode((await reader.read()).value) === "A",
      "generated-first-byte",
    );
    const tail = rejected(reader.read());
    duringBody.abort(reason);
    check((await tail) === reason, "generated-abort-body");
    await observed("closed", "body");
  } finally {
    await Promise.all([
      root.close(),
      prefixed.close(),
      control.close(),
      foreign.close(),
    ]);
  }
}
