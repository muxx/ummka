import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { ServerResponse } from "node:http";
import { type TestContext, test } from "node:test";
import { loadInstallationProfile } from "../../src/mattermost/installation-profile.ts";
import { createRestTransport } from "../../src/mattermost/rest-transport.ts";
import { ResponseError } from "../../vendor/mattermost/index.js";
import { listen } from "./test-server.ts";

const config = { Version: "10.10.1" };
const free = { IsLicensed: "false" };
function profile(settings: unknown, license: unknown = free) {
  return loadInstallationProfile(
    createRestTransport("https://fixture.example.test", async (input) =>
      Response.json(
        new URL(String(input)).pathname === "/api/v4/config/client"
          ? settings
          : license,
      ),
    ),
  );
}

test("reads settings for password, GitLab and disabled installations", async () => {
  const empty = {
    version: "10.10.1",
    siteName: "",
    passwordIdentifiers: [],
    ssoProviders: [],
    guestMagicLink: false,
  };
  assert.deepEqual(await profile(config), empty);
  assert.deepEqual(
    await profile({
      ...config,
      EnableSignInWithEmail: "true",
      EnableSignInWithUsername: "TRUE",
      EnableSignUpWithEmail: "true",
    }),
    { ...empty, passwordIdentifiers: ["email"] },
  );
  assert.deepEqual(
    await profile({
      ...config,
      EnableSignUpWithGitLab: "true",
      SiteName: "Рабочий чат",
      CustomObject: { enabled: true },
    }),
    { ...empty, siteName: "Рабочий чат", ssoProviders: ["gitlab"] },
  );
});

test("matches available OAuth providers and checks LDAP and SAML licensing independently", async () => {
  const settings = {
    ...config,
    EnableSignInWithEmail: "true",
    EnableSignInWithUsername: "true",
    EnableSaml: "true",
    EnableLdap: "true",
    EnableSignUpWithGitLab: "true",
    EnableSignUpWithGoogle: "true",
    EnableSignUpWithOffice365: "true",
    EnableSignUpWithOpenId: "true",
  };
  const oauth = ["gitlab", "google", "office365", "openid"];
  for (const [license, ids, providers] of [
    [
      { IsLicensed: "false", LDAP: "true", SAML: "true" },
      ["email", "username"],
      oauth,
    ],
    [
      { IsLicensed: "true", LDAP: "true" },
      ["email", "username", "ldap"],
      oauth,
    ],
    [
      { IsLicensed: "true", SAML: "true" },
      ["email", "username"],
      [...oauth, "saml"],
    ],
    [
      { IsLicensed: "true", LDAP: "true", SAML: "true" },
      ["email", "username", "ldap"],
      [...oauth, "saml"],
    ],
  ] as const) {
    const result = await profile(settings, license);
    assert.deepEqual(result.passwordIdentifiers, ids);
    assert.deepEqual(result.ssoProviders, providers);
  }
});

test("12.1 guest magic links and the missing GitLab flag follow the server's announcement", async () => {
  const c = { Version: "12.1.0", EnableSignInWithEmail: "true" };
  const plain = await profile(c);
  assert.deepEqual(plain.ssoProviders, []);
  assert.deepEqual(
    await profile({ ...c, EnableGuestMagicLink: "false" }),
    plain,
  );
  assert.deepEqual(await profile({ ...c, EnableGuestMagicLink: "true" }), {
    ...plain,
    guestMagicLink: true,
  });
});

test("requires the two records, a version and valid string fields", async () => {
  for (const [settings, license] of [
    [[], free],
    [null, free],
    [{}, free],
    [{ Version: " " }, free],
    [config, {}],
    [config, { IsLicensed: "no" }],
    [config, []],
    [{ ...config, EnableSaml: true }, free],
    [config, { ...free, LDAP: 1 }],
  ]) {
    await assert.rejects(profile(settings, license), {
      name: "TypeError",
      message: "Invalid Mattermost installation profile",
    });
  }
});

function json(res: ServerResponse, value: unknown) {
  res
    .writeHead(200, { "Content-Type": "application/json" })
    .end(JSON.stringify(value));
}

test("independent installations each send their two anonymous requests before either response", {
  timeout: 10_000,
}, async (t) => {
  const waiting = new Map<string, ServerResponse>();
  const { base } = await listen(t, (req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    const path = req.url ?? "";
    assert(!waiting.has(path));
    waiting.set(path, res);
    if (waiting.size !== 4) return;
    for (const team of ["alpha", "beta"]) {
      const c = waiting.get(`/${team}/api/v4/config/client?format=old`);
      const l = waiting.get(`/${team}/api/v4/license/client?format=old`);
      assert(c && l);
      json(c, {
        ...config,
        SiteName: team,
        EnableSignUpWithGitLab: team === "alpha" ? "true" : "false",
      });
      json(l, free);
    }
  });
  const [a, b] = await Promise.all(
    ["alpha", "beta"].map((team) =>
      loadInstallationProfile(createRestTransport(`${base}/${team}`, fetch)),
    ),
  );
  assert.equal(a.siteName, "alpha");
  assert.deepEqual(a.ssoProviders, ["gitlab"]);
  assert.equal(b.siteName, "beta");
  assert.deepEqual(b.ssoProviders, []);
});

async function heldSettings(t: TestContext) {
  const events = new EventEmitter();
  const received = once(events, "pair");
  const closedLicense = once(events, "license-closed");
  const closedConfig = once(events, "config-closed");
  const responses = new Map<string, ServerResponse>();
  let recover = false;
  const { base } = await listen(t, (req, res) => {
    const name = new URL(req.url ?? "/", "http://localhost").pathname.split(
      "/",
    )[3];
    assert(name === "config" || name === "license");
    if (recover) {
      json(res, name === "config" ? config : free);
      return;
    }
    req.socket.once("close", () => events.emit(`${name}-closed`));
    responses.set(name, res);
    if (responses.size === 2) events.emit("pair");
  });
  return {
    transport: createRestTransport(base, fetch),
    received,
    closedLicense,
    closedConfig,
    responses,
    recover: () => {
      recover = true;
    },
  };
}

for (const mode of ["HTTP error", "invalid JSON", "caller abort"] as const) {
  test(`stops the pair on ${mode} and leaves the connection reusable`, {
    timeout: 10_000,
  }, async (t) => {
    const fixture = await heldSettings(t);
    const controller = new AbortController();
    const pending = loadInstallationProfile(
      fixture.transport,
      controller.signal,
    ).catch((e: unknown) => e);
    await fixture.received;
    const configResponse = fixture.responses.get("config"),
      licenseResponse = fixture.responses.get("license");
    assert(configResponse && licenseResponse);
    licenseResponse
      .writeHead(200, { "Content-Type": "application/json" })
      .write("{");
    const reason = new Error("stopped by caller");
    if (mode === "caller abort") controller.abort(reason);
    else if (mode === "HTTP error")
      configResponse.writeHead(503).write("held error body");
    else configResponse.end("unparseable-private-marker");
    const error = await pending;
    if (mode === "HTTP error") {
      assert(error instanceof ResponseError);
      assert.equal(error.response.status, 503);
    } else if (mode === "caller abort") assert.equal(error, reason);
    else {
      assert(error instanceof TypeError);
      assert.equal(error.message, "Invalid Mattermost installation profile");
    }
    await fixture.closedLicense;
    if (mode !== "invalid JSON") await fixture.closedConfig;
    fixture.recover();
    assert.equal(
      (await loadInstallationProfile(fixture.transport)).version,
      "10.10.1",
    );
  });
}

test("already cancelled discovery allocates no requests", async () => {
  let calls = 0;
  const transport = createRestTransport(
    "https://fixture.example.test",
    async () => {
      calls++;
      return Response.json({});
    },
  );
  const reason = { source: "caller" };
  await assert.rejects(
    loadInstallationProfile(transport, AbortSignal.abort(reason)),
    (error: unknown) => error === reason,
  );
  assert.equal(calls, 0);
});
