import { invoke } from "@tauri-apps/api/core";

type Head = { status: number; headers: [string, string][]; hasBody: boolean };
const errors = new Set([
  "unknown_connection",
  "unknown_exchange",
  "invalid_exchange_state",
  "cancelled",
  "outside_installation",
  "operation_denied",
  "session_unavailable",
  "redirect",
  "cleartext_denied",
  "network",
]);

function known(code: unknown): code is string {
  return typeof code === "string" && errors.has(code);
}

function failure(code: unknown) {
  return new TypeError("Native REST request failed", {
    cause: known(code) ? code : "ipc",
  });
}

async function readJsonBody(
  request: Request,
  body: ReadableStream<Uint8Array>,
) {
  const type = request.headers.get("content-type")?.split(";", 1)[0];
  if (type?.trim().toLowerCase() !== "application/json")
    throw failure("operation_denied");
  const { signal } = request;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const parts: string[] = [];
  function cancel(reason: unknown) {
    // Source cleanup can outlive the request. The caller owns the abort reason.
    void reader.cancel(reason).catch(() => {});
  }
  function onAbort() {
    cancel(signal.reason);
  }
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch {
    signal.throwIfAborted();
    const error = new TypeError("Invalid REST request body");
    cancel(error);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

export async function nativeFetch(
  connection: number,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let request: Request;
  try {
    request = new Request(input, init);
  } catch {
    throw new TypeError("Invalid REST request");
  }
  const { signal } = request;
  signal.throwIfAborted();
  const body =
    request.body === null
      ? undefined
      : await readJsonBody(request, request.body);
  signal.throwIfAborted();
  const exchange = await invoke<number>("prepare_rest_request", {
    connection,
  }).catch((error: unknown) => {
    signal.throwIfAborted();
    throw failure(error);
  });
  const ids = { connection, exchange };
  let cancelling: Promise<void> | undefined;
  function cancelNative() {
    cancelling ??= invoke<void>("cancel_rest_request", ids).catch(
      (error: unknown) => {
        // EOF, a failed send or the owner can already have released the exchange.
        if (error !== "unknown_exchange" && error !== "unknown_connection")
          throw failure(error);
      },
    );
    return cancelling;
  }
  if (signal.aborted) {
    await cancelNative();
    throw signal.reason;
  }

  let finished = false;
  let interrupt: (reason: unknown) => void;
  function finish() {
    if (finished) return;
    finished = true;
    signal.removeEventListener("abort", onAbort);
  }
  function onAbort() {
    finish();
    void cancelNative().then(() => interrupt(signal.reason), interrupt);
  }
  async function failExchange(error: unknown): Promise<never> {
    finish();
    if (!known(error) || error === "invalid_exchange_state")
      await cancelNative();
    signal.throwIfAborted();
    throw failure(error);
  }

  try {
    const head = await new Promise<Head>((resolve, reject) => {
      interrupt = reject;
      signal.addEventListener("abort", onAbort);
      invoke<Head>("send_rest_request", {
        ...ids,
        method: request.method,
        url: request.url,
        headers: [...request.headers],
        ...(body === undefined ? {} : { body }),
      }).then(resolve, reject);
    });
    signal.throwIfAborted();
    if (!head.hasBody) {
      finish();
      return new Response(null, head);
    }
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>(
      {
        start(controller) {
          interrupt = (reason) => controller.error(reason);
        },
        async pull(controller) {
          try {
            const bytes = await invoke<ArrayBuffer>("read_rest_body", ids);
            if (finished) return;
            if (!(bytes instanceof ArrayBuffer)) throw new TypeError();
            if (bytes.byteLength > 0) {
              controller.enqueue(new Uint8Array(bytes));
            } else {
              finish();
              controller.close();
            }
          } catch (error) {
            if (finished) return;
            return failExchange(error);
          }
        },
        cancel() {
          finish();
          return cancelNative();
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(stream, head);
  } catch (error) {
    return failExchange(error);
  }
}
