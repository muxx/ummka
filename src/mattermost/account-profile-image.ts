import { type Configuration, UsersApi } from "../../vendor/mattermost/index.js";
import { isMattermostId, isMattermostTime } from "./model-fields.ts";

export type ProfileImageIdentity = {
  id: string;
  lastPictureUpdate?: number | null;
};
const maxBytes = 1024 * 1024;
const maxSide = 512;

export async function readProfileImage(
  config: Configuration,
  { id, lastPictureUpdate }: ProfileImageIdentity,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  if (
    !isMattermostId(id) ||
    (lastPictureUpdate != null &&
      !isMattermostTime(lastPictureUpdate, Number.MIN_SAFE_INTEGER))
  )
    throw new TypeError("Invalid Mattermost profile image identity.");
  try {
    const { raw } = await new UsersApi(config).getProfileImageRaw(
      { userId: id, u: lastPictureUpdate || undefined },
      { signal },
    );
    const image = await profilePng(raw, signal);
    signal?.throwIfAborted();
    return image;
  } catch (error) {
    // WebViews can report a different stream error for the same cancelled request.
    signal?.throwIfAborted();
    throw error;
  }
}

async function profilePng(raw: Response, signal?: AbortSignal): Promise<Blob> {
  const mime = raw.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    raw.status !== 200 ||
    mime !== "image/png" ||
    !raw.body ||
    Number(raw.headers.get("content-length")) > maxBytes
  ) {
    // Releasing the response must not replace the validation error.
    void raw.body?.cancel().catch(() => {});
    throw new TypeError("Invalid Mattermost profile image response.");
  }
  // Response.blob() can replace the native stream error in Android WebView.
  const reader = raw.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  function cancel(reason: unknown) {
    void reader.cancel(reason).catch(() => {});
  }
  function onAbort() {
    cancel(signal?.reason);
  }
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        const error = new RangeError("Mattermost profile image is too large.");
        cancel(error);
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  const image = new Blob(chunks, { type: "image/png" });
  const header = new DataView(await image.slice(0, 33).arrayBuffer());
  if (
    header.byteLength < 33 ||
    header.getUint32(0) !== 0x89504e47 ||
    header.getUint32(4) !== 0x0d0a1a0a ||
    header.getUint32(8) !== 13 ||
    header.getUint32(12) !== 0x49484452 ||
    !isPictureSide(header.getUint32(16)) ||
    !isPictureSide(header.getUint32(20))
  )
    throw new TypeError("Invalid Mattermost profile image header.");
  return image;
}

function isPictureSide(side: number) {
  return side > 0 && side <= maxSide;
}
