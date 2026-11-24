// A test identity provider for the isolated Compose network.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const clientId = "ummka-browser-fixture";
const clientSecret = process.env.UMMKA_FIXTURE_GITLAB_SECRET;
if (!clientSecret) throw Error("Missing test GitLab client secret");
const redirect = "http://mattermost:8065/signup/gitlab/complete";
const codes = new Set<string>();
const tokens = new Set<string>();

createServer(async (request, response) => {
  const url = new URL(request.url ?? "", "http://gitlab.example.test:8080");
  if (request.method === "GET" && url.pathname === "/authorize") {
    const state = url.searchParams.get("state");
    if (
      !state ||
      url.searchParams.get("client_id") !== clientId ||
      url.searchParams.get("redirect_uri") !== redirect ||
      url.searchParams.get("response_type") !== "code"
    ) {
      response.writeHead(400).end();
      return;
    }
    const code = randomBytes(24).toString("hex");
    codes.add(code);
    const complete = new URL(redirect);
    complete.searchParams.set("code", code);
    complete.searchParams.set("state", state);
    response.writeHead(302, { Location: complete.href }).end();
    return;
  }
  if (request.method === "POST" && url.pathname === "/token") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    if (
      body.get("grant_type") !== "authorization_code" ||
      body.get("client_id") !== clientId ||
      body.get("client_secret") !== clientSecret ||
      body.get("redirect_uri") !== redirect ||
      !codes.delete(body.get("code") ?? "")
    ) {
      response.writeHead(400).end();
      return;
    }
    const token = randomBytes(24).toString("hex");
    tokens.add(token);
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ access_token: token, token_type: "Bearer" }));
    return;
  }
  if (
    request.method === "GET" &&
    url.pathname === "/user" &&
    tokens.has(request.headers.authorization?.replace(/^Bearer /iu, "") ?? "")
  ) {
    response.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        id: 52,
        username: "sso-fixture",
        email: "sso@example.test",
        name: "SSO Fixture",
        state: "active",
      }),
    );
    return;
  }
  response.writeHead(404).end();
}).listen(8080, "0.0.0.0");
