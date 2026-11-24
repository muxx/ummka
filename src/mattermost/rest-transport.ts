const invalidAddress = "Invalid Mattermost server URL";

export function canonicalServerUrl(input: string): string {
  const address = input.trim();
  const authority = /^https?:\/\/([^/]+)/iu.exec(address)?.[1];
  if (
    !authority ||
    authority.includes("@") ||
    /[\s\p{Cc}\\?#]|%00/iu.test(address)
  ) {
    throw new TypeError(invalidAddress);
  }

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new TypeError(invalidAddress);
  }
  return url.origin + url.pathname.replace(/\/+$/u, "");
}

export function createRestTransport(serverUrl: string, send: typeof fetch) {
  const basePath = canonicalServerUrl(serverUrl);
  const fetchApi: typeof fetch = (input, init) =>
    send(input, { ...init, credentials: "omit", redirect: "error" });
  return { basePath, fetchApi };
}
