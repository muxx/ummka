import { invoke } from "@tauri-apps/api/core";
import { openNativeRestConnection } from "../../src/mattermost/native-rest.ts";

type Connection = Awaited<ReturnType<typeof openNativeRestConnection>>;
type Head = { status: number; headers: [string, string][]; hasBody: boolean };
const ports = String(import.meta.env.VITE_UMMKA_CHECK_PORTS).split(",");
const base = `https://127.0.0.1:${ports[0]}/team/chat`;
const controlBase = `https://127.0.0.1:${ports[1]}`;
const route = "/api/v4/system/ping";
const restored = "exchange-before-reload";

function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw Error(reason);
}
function prepare(connection: number) {
  return invoke<number>("prepare_rest_request", { connection });
}
function send(
  connection: number,
  exchange: number,
  url: string,
  method = "GET",
  headers: string[][] = [],
) {
  return invoke<Head>("send_rest_request", {
    connection,
    exchange,
    method,
    url,
    headers,
  });
}
function read(connection: number, exchange: number) {
  return invoke<ArrayBuffer>("read_rest_body", { connection, exchange });
}
function cancel(connection: number, exchange: number) {
  return invoke<void>("cancel_rest_request", { connection, exchange });
}

async function expectCode(promise: Promise<unknown>, expected: string) {
  try {
    await promise;
  } catch (error) {
    check(error === expected, `${expected}-received-${String(error)}`);
    return;
  }
  throw Error(`missing-${expected}`);
}

async function acknowledge(control: Connection, step: string, name = "") {
  const id = await prepare(control.rid);
  const response = await send(
    control.rid,
    id,
    `${control.basePath}${route}?step=${step}&case=${name}`,
  );
  check(response.status === 204 && !response.hasBody, "control-status");
}
function target(name: string) {
  return `${base}${route}?check=${name}`;
}
async function allBytes(connection: number, id: number) {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const block = await read(connection, id);
    check(block instanceof ArrayBuffer, "body-format");
    if (block.byteLength === 0) break;
    size += block.byteLength;
    check(size <= 65_536, "body-size");
    parts.push(new Uint8Array(block));
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

async function testPreparation(connection: number, control: Connection) {
  const pending = await prepare(connection);
  await expectCode(read(control.rid, pending), "unknown_exchange");
  await expectCode(read(connection, pending), "invalid_exchange_state");
  await cancel(connection, pending);
  await expectCode(
    send(connection, pending, target("unused")),
    "unknown_exchange",
  );
  for (const [url, method, expected] of [
    [control.basePath + route, "GET", "outside_installation"],
    [target("unused"), "POST", "operation_denied"],
    [target("unused"), "invalid method", "operation_denied"],
    ["relative", "GET", "outside_installation"],
  ]) {
    const id = await prepare(connection);
    await expectCode(send(connection, id, url, method), expected);
    await expectCode(read(connection, id), "unknown_exchange");
  }
  const bad = await prepare(connection);
  await expectCode(
    send(connection, bad, target("unused"), "GET", [
      ["invalid name", "fixture"],
    ]),
    "operation_denied",
  );
  await expectCode(cancel(connection, bad), "unknown_exchange");
  await acknowledge(control, "before");
}

async function testResponses(connection: number, verifyRoute: () => void) {
  const binary = await prepare(connection);
  const head = await send(connection, binary, target("bytes"), "GET", [
    ["X-Fixture", "café"],
  ]);
  check(head.status === 200 && head.hasBody, "byte-status");
  const headers = new Headers(head.headers);
  check(
    headers.get("x-fixture") === "café" &&
      !headers.has("set-cookie") &&
      !headers.has("set-cookie2"),
    "byte-headers",
  );
  const bytes = await allBytes(connection, binary);
  check(
    bytes.length === 65_536 &&
      bytes.every((value, index) => value === index % 251),
    "byte-content",
  );
  verifyRoute();
  await expectCode(read(connection, binary), "unknown_exchange");
  for (const status of [204, 205, 304, 401, 503]) {
    const id = await prepare(connection);
    const head = await send(connection, id, target(String(status)));
    check(
      head.status === status && head.hasBody === status >= 400,
      "response-status",
    );
    if (head.hasBody)
      check(
        new TextDecoder().decode(await allBytes(connection, id)) ===
          "status body",
        "status-body",
      );
    await expectCode(read(connection, id), "unknown_exchange");
  }
  const redirected = await prepare(connection);
  await expectCode(
    send(connection, redirected, target("redirect")),
    "redirect",
  );
  await expectCode(read(connection, redirected), "unknown_exchange");
  const untrusted = await openNativeRestConnection(
    `https://127.0.0.1:${ports[2]}`,
  );
  const id = await prepare(untrusted.rid);
  await expectCode(
    send(untrusted.rid, id, untrusted.basePath + route),
    "network",
  );
  await expectCode(read(untrusted.rid, id), "unknown_exchange");
  await untrusted.close();
  if (navigator.userAgent.includes("Android")) {
    const plain = await openNativeRestConnection(
      base.replace("https://", "http://"),
    );
    const id = await prepare(plain.rid);
    await expectCode(
      send(plain.rid, id, plain.basePath + route),
      "cleartext_denied",
    );
    await expectCode(cancel(plain.rid, id), "unknown_exchange");
    await plain.close();
  }
}

async function testCancellation(connection: number, control: Connection) {
  const headers = await prepare(connection);
  const waiting = expectCode(
    send(connection, headers, target("headers")),
    "cancelled",
  );
  await acknowledge(control, "received", "headers");
  await expectCode(read(connection, headers), "invalid_exchange_state");
  await expectCode(
    send(connection, headers, target("unused")),
    "invalid_exchange_state",
  );
  await cancel(connection, headers);
  await waiting;
  await acknowledge(control, "closed", "headers");
  await expectCode(read(connection, headers), "unknown_exchange");

  const body = await prepare(connection);
  await send(connection, body, target("body"));
  check(
    new TextDecoder().decode(await read(connection, body)) === "A",
    "held-first-byte",
  );
  const first = read(connection, body).then(
    () => "unexpected-body",
    (error: unknown) => error,
  );
  const second = read(connection, body).then(
    () => "unexpected-body",
    (error: unknown) => error,
  );
  check(
    (await Promise.race([first, second])) === "invalid_exchange_state",
    "concurrent-read",
  );
  await cancel(connection, body);
  const outcomes = await Promise.all([first, second]);
  check(outcomes.includes("cancelled"), "cancel-pending-read");
  await acknowledge(control, "closed", "body");

  const broken = await prepare(connection);
  await send(connection, broken, target("disconnect"));
  check(
    new TextDecoder().decode(await read(connection, broken)) === "A",
    "partial-first-byte",
  );
  await acknowledge(control, "disconnect");
  await expectCode(read(connection, broken), "network");
  await expectCode(cancel(connection, broken), "unknown_exchange");

  const owner = await openNativeRestConnection(base);
  const id = await prepare(owner.rid);
  const stopped = expectCode(send(owner.rid, id, target("owner")), "cancelled");
  await acknowledge(control, "received", "owner");
  await owner.close();
  await stopped;
  await acknowledge(control, "closed", "owner");
  await expectCode(read(owner.rid, id), "unknown_connection");
}

export async function beginExchanges(verifyRoute: () => void) {
  check(
    ports.length === 3 && ports.every((p) => /^\d+$/.test(p)),
    "fixture-ports",
  );
  const owner = await openNativeRestConnection(base);
  const control = await openNativeRestConnection(controlBase);
  await testPreparation(owner.rid, control);
  await testResponses(owner.rid, verifyRoute);
  await testCancellation(owner.rid, control);
  const id = await prepare(owner.rid);
  void send(owner.rid, id, target("reload")).catch(() => {});
  await acknowledge(control, "received", "reload");
  sessionStorage.setItem(restored, String(owner.rid));
  location.reload();
}

export async function finishExchangesAfterReload(): Promise<boolean> {
  const old = sessionStorage.getItem(restored);
  if (old === null) return false;
  await expectCode(prepare(Number(old)), "unknown_connection");
  const control = await openNativeRestConnection(controlBase);
  await acknowledge(control, "closed", "reload");
  await control.close();
  sessionStorage.removeItem(restored);
  return true;
}
