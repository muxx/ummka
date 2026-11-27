// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import {
  Configuration,
  FetchError,
  ResponseError,
} from "../../vendor/mattermost/index.js";
import { readProfileImage } from "./account-profile-image.ts";

const fixture = await readFile(
  new URL(
    "../../src-tauri/icons/linux/hicolor/48x48/apps/ummka.png",
    import.meta.url,
  ),
);
const pic = { id: "a".repeat(26), lastPictureUpdate: 123 };
const headers = { "Content-Type": "image/png" };
function setup() {
  const fetchApi = vi.fn<typeof fetch>();
  return {
    fetchApi,
    config: new Configuration({ basePath: "https://chat.test/sub", fetchApi }),
  };
}

test("addresses only the selected user's current PNG with the optional profile revision", async () => {
  const { fetchApi, config } = setup();
  for (const [identity, query] of [
    [pic, "?_=123"],
    [{ ...pic, lastPictureUpdate: -321 }, "?_=-321"],
    [{ ...pic, lastPictureUpdate: 0 }, ""],
    [{ id: "b".repeat(26), lastPictureUpdate: null }, ""],
    [{ id: pic.id }, ""],
  ] as const) {
    fetchApi.mockResolvedValueOnce(new Response(fixture, { headers }));
    const image = await readProfileImage(config, identity);
    expect(image.type).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(fixture);
    expect(fetchApi).toHaveBeenLastCalledWith(
      `https://chat.test/sub/api/v4/users/${identity.id}/image${query}`,
      expect.objectContaining({ method: "GET" }),
    );
  }
  for (const invalid of [
    { ...pic, id: "me" },
    { ...pic, lastPictureUpdate: Number.MIN_SAFE_INTEGER - 1 },
    { ...pic, lastPictureUpdate: Number.MAX_SAFE_INTEGER + 1 },
    { ...pic, lastPictureUpdate: 1.5 },
  ]) {
    await expect(readProfileImage(config, invalid)).rejects.toThrow("identity");
  }
  await expect(
    readProfileImage(config, pic, AbortSignal.abort("left")),
  ).rejects.toBe("left");
  expect(fetchApi).toHaveBeenCalledTimes(5);
});

test("does not reuse the picture across permission failure, account or login", async () => {
  const { fetchApi, config } = setup();
  fetchApi.mockResolvedValueOnce(new Response(fixture, { headers }));
  await readProfileImage(config, pic);
  for (const status of [401, 403, 404]) {
    fetchApi.mockResolvedValueOnce(
      Response.json({ message: "refused" }, { status }),
    );
    await expect(readProfileImage(config, pic)).rejects.toMatchObject({
      name: ResponseError.name,
      response: { status },
    });
  }
  const networkError = new TypeError("Native REST request failed", {
    cause: "network",
  });
  fetchApi.mockRejectedValueOnce(networkError);
  await expect(readProfileImage(config, pic)).rejects.toMatchObject({
    name: FetchError.name,
    cause: networkError,
  });
  const next = setup();
  next.fetchApi.mockResolvedValueOnce(Response.json({}, { status: 403 }));
  await expect(readProfileImage(next.config, pic)).rejects.toMatchObject({
    response: { status: 403 },
  });
  expect(next.fetchApi).toHaveBeenCalledOnce();
});

test("checks MIME, complete response, header, dimensions, and encoded size", async () => {
  const { fetchApi, config } = setup();
  const wide = Buffer.from(fixture);
  wide.writeUInt32BE(513, 16);
  const emptyHeight = Buffer.from(fixture);
  emptyHeight.writeUInt32BE(0, 20);
  const notIHDR = Buffer.from(fixture);
  notIHDR.writeUInt32BE(0, 12);
  const badMagic = Buffer.from(fixture);
  badMagic[7] = 0;
  for (const response of [
    new Response(fixture, { headers: { "Content-Type": "image/svg+xml" } }),
    new Response(fixture, { status: 206, headers }),
    new Response(null, { status: 204 }),
    new Response(null, { headers }),
    new Response(fixture.subarray(0, 30), { headers }),
    ...[wide, emptyHeight, notIHDR, badMagic].map(
      (data) => new Response(data, { headers }),
    ),
    new Response(fixture, {
      headers: { ...headers, "Content-Length": "1048577" },
    }),
  ]) {
    fetchApi.mockResolvedValueOnce(response);
    await expect(readProfileImage(config, pic)).rejects.toThrow(
      "Invalid Mattermost profile image",
    );
  }
  const cancel = vi.fn();
  fetchApi.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        pull(c) {
          c.enqueue(new Uint8Array(131072));
        },
        cancel,
      }),
      { headers },
    ),
  );
  await expect(readProfileImage(config, pic)).rejects.toThrow("too large");
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});

test("cancels a live body when the owner stops waiting for the old user or revision", async () => {
  const { fetchApi, config } = setup();
  const cancel = vi.fn();
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  fetchApi.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        pull(c) {
          c.enqueue(fixture);
          started();
          return new Promise<void>(() => {});
        },
        cancel,
      }),
      { headers },
    ),
  );
  const controller = new AbortController();
  const result = readProfileImage(config, pic, controller.signal);
  await reading;
  controller.abort("selection changed");
  await expect(result).rejects.toBe("selection changed");
  await vi.waitFor(() =>
    expect(cancel).toHaveBeenCalledExactlyOnceWith("selection changed"),
  );
});

test("preserves the caller's reason when the platform's pending body read rejects differently", async () => {
  const { fetchApi, config } = setup();
  const controller = new AbortController();
  let notify!: () => void;
  const reading = new Promise<void>((resolve) => {
    notify = resolve;
  });
  fetchApi.mockResolvedValueOnce(
    new Response(
      new ReadableStream(
        {
          pull() {
            notify();
          },
          cancel() {
            throw new TypeError("stream closed by platform");
          },
        },
        { highWaterMark: 0 },
      ),
      { headers },
    ),
  );
  const request = readProfileImage(config, pic, controller.signal);
  await reading;
  const reason = new Error("another profile was selected");
  controller.abort(reason);
  await expect(request).rejects.toBe(reason);
});

test("preserves a network failure after the server has answered and sent part of the image", async () => {
  const { fetchApi, config } = setup();
  const failure = new TypeError("Native REST request failed", {
    cause: "network",
  });
  fetchApi.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(fixture.subarray(0, 33));
        },
        pull(stream) {
          stream.error(failure);
        },
      }),
      { headers },
    ),
  );
  await expect(readProfileImage(config, pic)).rejects.toBe(failure);
});
