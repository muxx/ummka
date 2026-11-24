/** Parse an absolute HTTP(S) address containing only an authority and a path. */
export function parseHttpPathUrl(input: string): URL | null {
  const address = input.trim();
  const authority = /^https?:\/\/([^/]+)/iu.exec(address)?.[1];
  if (
    !authority ||
    authority.includes("@") ||
    /[\s\p{Cc}\\?#]|%00/iu.test(address)
  ) {
    return null;
  }
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

export function canonicalServerUrl(input: string): string {
  const url = parseHttpPathUrl(input);
  if (!url) {
    throw new TypeError("Invalid Mattermost server URL");
  }
  return url.origin + url.pathname.replace(/\/+$/u, "");
}
