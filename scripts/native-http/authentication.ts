import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export const authPrefix = "/Login%20Site//Blue/api/v4/users/";

export async function handleAuth(
  request: IncomingMessage,
  response: ServerResponse,
  visits: string[],
  beforeLogout: (name: string) => Promise<void>,
) {
  assert.equal(request.headers.cookie, undefined);
  if (request.url === `${authPrefix}me`) {
    assert.equal(request.method, "GET");
    const auth = request.headers.authorization;
    assert(
      typeof auth === "string" &&
        [
          "saved",
          "replaced",
          "out-refused",
          "out-lost",
          "out-invalid",
          "out-new",
        ].some((name) => auth === `Bearer fixture-grant-${name}`),
    );
    visits.push(`me-${auth.slice("Bearer fixture-grant-".length)}`);
    response.end(JSON.stringify({ id: "Abc01234567890123456789012" }));
    return;
  }
  assert.equal(request.method, "POST");
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  response.setHeader("Content-Type", "application/json");
  if (request.url === `${authPrefix}logout`) {
    const auth = request.headers.authorization;
    assert(
      typeof auth === "string" && auth.startsWith("Bearer fixture-grant-"),
    );
    assert.equal(bytes.length, 0);
    const name = auth.slice("Bearer fixture-grant-".length);
    visits.push(`logout-${name}`);
    await beforeLogout(name);
    if (name === "no-reply" || name === "out-lost") {
      request.socket.destroy();
    } else if (["refused-logout", "refused", "out-refused"].includes(name)) {
      response
        .writeHead(403)
        .end(JSON.stringify({ id: "logout.refused", message: auth }));
    } else {
      response.end(
        JSON.stringify({
          status: ["bad-logout", "out-invalid"].includes(name) ? "FAIL" : "OK",
        }),
      );
    }
    return name;
  }
  assert.equal(request.url, `${authPrefix}login`);
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers["content-type"], "application/json");
  const input = JSON.parse(bytes.toString("utf8"));
  const name = input.login_id;
  assert.equal(typeof name, "string");
  assert.equal(input.password, "fixture-password");
  if (name === "ordinary")
    assert.deepEqual(input, {
      login_id: name,
      password: "fixture-password",
      token: "fixture-code",
      ldap_only: "true",
    });
  visits.push(`login-${name}`);
  if (name === "redirect") {
    response.writeHead(302, { Location: "/destination" }).end();
  } else if (name === "mfa" || name === "foreign-header") {
    response.setHeader("Token", "fixture-error-header");
    response.writeHead(401).end(
      JSON.stringify({
        id: "mfa.validate_token.authenticate.app_error",
        message: name === "mfa" ? "fixture-password" : "fixture-error-header",
        request_id: name === "mfa" ? "fixture-code" : "request-1",
        detailed_error: input.password,
      }),
    );
  } else if (name === "too-large") {
    response.setHeader("Token", "fixture-large");
    response.write('{"id":"Abc01234567890123456789012"}');
    response.end(" ".repeat(1024 * 1024));
  } else if (name === "broken-error" || name === "broken-success") {
    response.writeHead(name === "broken-error" ? 403 : 200, {
      "Content-Length": 100,
      Token: "fixture-partial",
    });
    response.write('{"id":"', () => response.socket?.end());
  } else {
    if (name !== "missing")
      response.setHeader(
        "Token",
        name === "duplicate"
          ? ["fixture-one", "fixture-two"]
          : `fixture-grant-${name}`,
      );
    response.writeHead(name === "wrong-status" ? 201 : 200).end(
      JSON.stringify({
        id: name === "bad-id" ? "me" : "Abc01234567890123456789012",
      }),
    );
  }
}

export function checkAuthVisits(visits: string[]) {
  assert.deepEqual(visits, [
    "login-ordinary",
    "logout-ordinary",
    "login-mfa",
    "login-foreign-header",
    "login-broken-error",
    "login-missing",
    "login-duplicate",
    "login-bad-id",
    "login-wrong-status",
    "login-broken-success",
    "login-too-large",
    "login-redirect",
    "login-bad-logout",
    "logout-bad-logout",
    "login-refused-logout",
    "logout-refused-logout",
    "login-saved",
    "me-saved",
    "login-mfa",
    "login-confirmed",
    "logout-confirmed",
    "login-refused",
    "logout-refused",
    "login-no-reply",
    "logout-no-reply",
    "me-saved",
    "me-saved",
    "login-empty",
    "logout-empty",
    "login-detached",
    "logout-detached",
    "me-saved",
    "login-replaced",
    "me-replaced",
    "me-replaced",
    "login-out-success",
    "logout-out-success",
    "login-out-refused",
    "logout-out-refused",
    "me-out-refused",
    "login-out-lost",
    "logout-out-lost",
    "me-out-lost",
    "login-out-invalid",
    "logout-out-invalid",
    "me-out-invalid",
    "login-out-local-fail",
    "logout-out-local-fail",
    "login-out-dismiss",
    "logout-out-dismiss",
    "login-out-race",
    "logout-out-race",
    "login-out-new",
    "me-out-new",
  ]);
}
