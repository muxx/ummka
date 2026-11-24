import assert from "node:assert/strict";
import { Configuration, UsersApi } from "../../../vendor/mattermost/index.js";

export async function checkBrowserSignIn(base: string, version: string) {
  const config = await fetch(`${base}/api/v4/config/client?format=old`);
  assert.equal(config.status, 200);
  const profile = await config.json();
  assert.equal(profile.Version, version);
  if (version === "12.1.0") {
    // Team Edition does not advertise GitLab without the OpenID license feature on this release.
    assert.equal(profile.EnableSignUpWithGitLab, undefined);
    console.log(
      "Mattermost 12.1.0 verified the available Team Edition sign-in methods.",
    );
    return;
  }
  assert.equal(version, "10.10.1");
  assert.equal(profile.EnableSignUpWithGitLab, "true");
  const callback = "io.github.muxx.ummka.auth://callback";
  const start = new URL(`${base}/oauth/gitlab/mobile_login`);
  start.searchParams.set("redirect_to", callback);
  const cookies = new Map<string, string>();
  async function visit(url: URL) {
    const headers = new Headers();
    if (url.origin === base && cookies.size)
      headers.set("Cookie", [...cookies.values()].join("; "));
    const response = await fetch(url, { headers, redirect: "manual" });
    if (url.origin === base) {
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";", 1)[0];
        cookies.set(pair.split("=", 1)[0], pair);
      }
    }
    return response;
  }
  const login = await visit(start);
  assert.equal(login.status, 302);
  const authorize = new URL(login.headers.get("location") ?? "");
  assert.equal(authorize.origin, "http://gitlab.example.test:8080");
  assert.equal(authorize.pathname, "/authorize");
  const consent = await visit(authorize);
  assert.equal(consent.status, 302);
  const complete = new URL(consent.headers.get("location") ?? "");
  assert.equal(complete.origin, base);
  assert.equal(complete.pathname, "/signup/gitlab/complete");
  const result = await visit(complete);
  assert.equal(result.status, 200);
  const html = await result.text();
  // Read the application link on Mattermost's mobile completion page. Never print it.
  const href = /io\.github\.muxx\.ummka\.auth:\/\/callback\?[^"'\s<>]+/u.exec(
    html,
  )?.[0];
  assert.ok(href, "missing sign-in return link");
  const location = new URL(href.replaceAll("&amp;", "&"));
  const session = location.searchParams.get("MMAUTHTOKEN");
  assert.ok(session, "missing confirmed session");
  assert.ok(location.searchParams.get("MMCSRF"), "missing CSRF field");
  assert.equal(location.searchParams.has("srv"), false);
  const headers = { Authorization: `Bearer ${session}` };
  const api = new UsersApi(
    new Configuration({ basePath: base, accessToken: session }),
  );
  try {
    const me = await api.getUser({ userId: "me" });
    assert.equal(me.authService, "gitlab");
    assert.equal(me.email, "sso@example.test");
  } finally {
    const logout = await fetch(`${base}/api/v4/users/logout`, {
      method: "POST",
      headers,
    });
    assert.equal(logout.status, 200);
  }
  console.log(
    "Mattermost 10.10.1 verified GitLab browser sign-in, account identity and sign-out.",
  );
}
