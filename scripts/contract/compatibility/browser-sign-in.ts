import assert from "node:assert/strict";
import { Configuration, UsersApi } from "../../../vendor/mattermost/index.js";

const callback = "io.github.muxx.ummka.auth://callback";

export async function checkBrowserSignIn(
  base: string,
  version: string,
  fixture: { username: string; password: string; email: string; id: string },
) {
  const config = await fetch(`${base}/api/v4/config/client?format=old`);
  assert.equal(config.status, 200);
  const profile = await config.json();
  assert.equal(profile.Version, version);
  assert.equal(profile.SiteURL, base);
  if (profile.EnableSignUpWithGitLab !== "true") {
    assert.equal(version, "12.1.0");
    assert.equal(profile.EnableSignUpWithGitLab, undefined);
    // Stock 12.1 Team Edition omits this provider. Exercise the available part of the
    // protocol with a real session; only the return URL is assembled by the test.
    const login = await fetch(`${base}/api/v4/users/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        login_id: fixture.username,
        password: fixture.password,
      }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).id, fixture.id);
    const cookies = new Map(
      login.headers.getSetCookie().map((value) => {
        const pair = value.split(";", 1)[0];
        const index = pair.indexOf("=");
        return [pair.slice(0, index), pair.slice(index + 1)];
      }),
    );
    const token = cookies.get("MMAUTHTOKEN");
    const csrf = cookies.get("MMCSRF");
    assert.ok(
      token && token === login.headers.get("token") && csrf,
      "missing issued session fields",
    );
    const location = new URL(callback);
    location.searchParams.set("MMAUTHTOKEN", token);
    location.searchParams.set("MMCSRF", csrf);
    location.searchParams.set("srv", profile.SiteURL);
    await verifyReturnedAccount(
      base,
      version,
      location,
      fixture.email,
      fixture.id,
    );
    console.log(
      "Mattermost 12.1.0 Team Edition verified a server-issued session and CSRF in a constructed mobile return, the account identity and logout. GitLab is unavailable on this edition.",
    );
    return;
  }
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
  await verifyReturnedAccount(
    base,
    version,
    new URL(href.replaceAll("&amp;", "&")),
    "sso@example.test",
  );
  console.log(
    `Mattermost ${version} verified GitLab browser sign-in, account identity and sign-out.`,
  );
}

async function verifyReturnedAccount(
  base: string,
  version: string,
  location: URL,
  email: string,
  id?: string,
) {
  assert.ok(location.href.startsWith(`${callback}?`), "invalid return address");
  const session = location.searchParams.get("MMAUTHTOKEN");
  assert.ok(session, "missing confirmed session");
  assert.ok(location.searchParams.get("MMCSRF"), "missing CSRF field");
  assert.ok(
    version === "10.10.1"
      ? !location.searchParams.has("srv")
      : location.searchParams.get("srv") === base,
    "unexpected callback installation",
  );
  const headers = { Authorization: `Bearer ${session}` };
  const api = new UsersApi(
    new Configuration({ basePath: base, accessToken: session }),
  );
  try {
    const me = await api.getUser({ userId: "me" });
    assert.equal(me.email, email);
    if (id === undefined) assert.equal(me.authService, "gitlab");
    else assert.equal(me.id, id);
  } finally {
    const logout = await fetch(`${base}/api/v4/users/logout`, {
      method: "POST",
      headers,
    });
    assert.equal(logout.status, 200);
  }
  assert.equal(
    (await fetch(`${base}/api/v4/users/me`, { headers })).status,
    401,
  );
}
