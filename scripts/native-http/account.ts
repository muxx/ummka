import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";

export function respondToAccount(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  firstId: string,
  event: (name: string) => void,
): string | undefined {
  if (url.pathname !== "/team/chat/api/v4/users/me") return;
  assert.equal(request.method, "GET");
  assert.equal(url.search, "");
  const scenario = request.headers["x-test-case"];
  const second = scenario === "second" || scenario === "retire";
  const token = second ? "fixture-second-session" : "fixture-prefixed-session";
  assert.equal(request.headers.authorization, `Bearer ${token}`);
  assert.equal(
    request.rawHeaders.filter((item) => item.toLowerCase() === "authorization")
      .length,
    1,
  );
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
