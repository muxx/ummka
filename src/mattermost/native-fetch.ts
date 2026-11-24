import { invoke } from "@tauri-apps/api/core";

type Head = { status: number; headers: [string, string][]; hasBody: boolean };
const errors = new Set([
  "unknown_connection",
  "unknown_exchange",
  "invalid_exchange_state",
  "cancelled",
  "outside_installation",
  "operation_denied",
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
  if (request.body !== null) throw failure("operation_denied");
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
