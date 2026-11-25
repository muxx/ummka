import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export function respondToAccount(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  firstId: string,
  event: (name: string) => void,
): string | undefined {
  if (url.pathname === "/browser-action-check/api/v4/users/me") {
    assert.equal(request.method, "GET");
    assert.equal(
      request.headers.authorization,
      "Bearer fixture-browser-action",
    );
    assert.equal(request.headers.cookie, undefined);
    assert.equal(url.search, "");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "f".repeat(26), roles: "system_user" }));
    return "browser-action-confirmed";
  }
  if (url.pathname === "/browser-action-check/api/v4/users/logout") {
    assert.equal(request.method, "POST");
    assert.equal(
      request.headers.authorization,
      "Bearer fixture-browser-action",
    );
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "fixture.logout.unavailable" }));
    return "browser-entry-unconfirmed";
  }
  const prefix = "/browser-action-check/api/v4/";
  if (url.pathname.startsWith(prefix)) {
    const path = url.pathname.slice(prefix.length);
    const teamId = "Team0123456789012345678901";
    const userId = "f".repeat(26);
    const replies: Record<string, unknown> = {
      "config/client": {
        Version: "10.10.1",
        SiteName: "Browser fixture",
        EnableSignUpWithGitLab: "true",
        EnableSignUpWithGoogle: "true",
      },
      "license/client": { IsLicensed: "false" },
      "users/me/teams": [
        {
          id: teamId,
          name: "browser",
          display_name: "Browser team",
          delete_at: 0,
        },
      ],
      "users/me/teams/members": [
        { team_id: teamId, user_id: userId, roles: "team_user", delete_at: 0 },
      ],
      "users/me/preferences": null,
    };
    assert(
      Object.hasOwn(replies, path),
      "unexpected browser entry fixture route",
    );
    const publicRead = path === "config/client" || path === "license/client";
    assert.equal(request.method, "GET");
    assert.equal(
      request.headers.authorization,
      publicRead ? undefined : "Bearer fixture-browser-action",
    );
    assert.equal(request.headers.cookie, undefined);
    assert.equal(url.search, publicRead ? "?format=old" : "");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(replies[path]));
    return "browser-entry-" + path;
  }
  if (url.pathname === "/vault-refusal/api/v4/users/logout") {
    assert.equal(request.method, "POST");
    assert.equal(url.search, "");
    assert.equal(request.headers.cookie, undefined);
    assert.equal(
      request.headers.authorization,
      "Bearer fixture-local-removal-failure",
    );
    response.setHeader("X-Fixture-Diagnostic", "private-storage-diagnostic");
    response.end(
      JSON.stringify({ status: "OK", internal: "private-storage-diagnostic" }),
    );
    return "account-logout-local-failure";
  }
  if (
    url.pathname === "/team/chat/confirmed/api/v4/users/logout" ||
    url.pathname === "/team/chat/secondary/api/v4/users/logout"
  ) {
    assert.equal(request.method, "POST");
    assert.equal(url.search, "");
    assert.equal(request.headers.cookie, undefined);
    const auth = request.headers.authorization;
    if (url.pathname === "/team/chat/confirmed/api/v4/users/logout") {
      assert.equal(auth, "Bearer fixture-exit-session");
      response.end(JSON.stringify({ status: "OK" }));
      return "account-logout-confirmed";
    }
    assert.equal(auth, "Bearer fixture-second-session");
    response.writeHead(503).end(JSON.stringify({ id: "fixture.unavailable" }));
    return "account-logout-unconfirmed";
  }
  if (
    url.pathname !== "/team/chat/api/v4/users/me" &&
    url.pathname !== "/team/chat/secondary/api/v4/users/me"
  )
    return;
  assert.equal(request.method, "GET");
  assert.equal(url.search, "");
  const scenario = request.headers["x-test-case"];
  const second = scenario === "second" || scenario === "retire";
  assert.equal(
    url.pathname,
    second
      ? "/team/chat/secondary/api/v4/users/me"
      : "/team/chat/api/v4/users/me",
  );
  const token = second ? "fixture-second-session" : "fixture-prefixed-session";
  assert.equal(request.headers.authorization, `Bearer ${token}`);
  assert.equal(
    request.rawHeaders.filter((item) => item.toLowerCase() === "authorization")
      .length,
    1,
  );
  if (scenario === undefined) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: firstId, roles: "system_user" }));
    return "account-role-owner";
  }
  if (scenario === "retire") {
    request.socket.once("close", () => event("account-retire-closed"));
    event("account-retire-received");
    return "account-retire";
  }
  if (scenario === "first" || second) {
    response.setHeader("X-Fixture-Diagnostic", `private ${token}`);
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: second ? "b".repeat(26) : firstId }));
    return `account-${scenario}`;
  }
  assert.equal(typeof scenario, "string");
  if (scenario === "error-body") {
    request.socket.once("close", () => event("account-error-body-closed"));
    response
      .writeHead(403, { "Content-Type": "application/json" })
      .write('{"message":"');
    return "account-error-body";
  }
  const status = scenario === "expired" ? 401 : 403;
  response.statusCode = status;
  response.setHeader("X-Fixture-Diagnostic", token);
  response.setHeader("WWW-Authenticate", "Bearer");
  response.setHeader("Retry-After", "7");
  if (scenario === "truncated") {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": 1024,
    });
    response.write('{"id":"incomplete"}', () => response.socket?.end());
  } else if (scenario === "html") {
    response.setHeader("Content-Type", "text/html");
    response.end("<html>Fixture proxy error</html>");
  } else {
    assert(
      scenario === "denied" || scenario === "expired" || scenario === "large",
    );
    const body = JSON.stringify({
      status_code: 500,
      id: "fixture.refused",
      message: scenario === "expired" ? `private ${token}` : "Access denied",
      request_id: "public-request",
      detailed_error: token,
      internal: { text: scenario === "large" ? "x".repeat(70_000) : token },
    });
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Content-Length", Buffer.byteLength(body));
    response.end(body);
  }
  return `account-${scenario}`;
}
