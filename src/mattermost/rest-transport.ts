import { canonicalServerUrl } from "./server-url.ts";

export function createRestTransport(serverUrl: string, send: typeof fetch) {
  const basePath = canonicalServerUrl(serverUrl);
  const fetchApi: typeof fetch = (input, init) =>
    send(input, { ...init, credentials: "omit", redirect: "error" });
  return { basePath, fetchApi };
}
