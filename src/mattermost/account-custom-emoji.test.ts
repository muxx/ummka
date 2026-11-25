import { expect, test, vi } from "vitest";
import { Configuration, ResponseError } from "../../vendor/mattermost/index.js";
import { readCustomEmoji } from "./account-custom-emoji.ts";

const name = "fixture+wave";
const image = {
  id: "e".repeat(26),
  creator_id: "u".repeat(26),
  name,
  create_at: 5,
  update_at: 10,
  delete_at: 0,
};
const missing = "app.emoji.get_by_name.no_result";
const disabled = "api.emoji.disabled.app_error";
function fixture(response: Response) {
  const fetchApi = vi.fn<typeof fetch>(async () => response);
  return {
    fetchApi,
    config: new Configuration({
      basePath: "https://chat.example/prefix",
      fetchApi,
    }),
  };
}

test.each([image.creator_id, "", "legacy"])(
  "reads the exact emoji and preserves its creator metadata",
  async (creator) => {
    const { config, fetchApi } = fixture(
      Response.json({ ...image, creator_id: creator }),
    );
    await expect(readCustomEmoji(config, name)).resolves.toEqual({
      kind: "found",
      emoji: {
        id: image.id,
        name,
        creatorId: creator,
        createAt: 5,
        updateAt: 10,
        deleteAt: 0,
      },
    });
    expect(fetchApi.mock.calls[0]?.[0]).toBe(
      "https://chat.example/prefix/api/v4/emoji/name/fixture%2Bwave",
    );
  },
);
test.each([
  [404, missing, "missing"],
  [501, disabled, "disabled"],
] as const)("recognizes the Mattermost %s result", async (status, id, kind) => {
  const { config } = fixture(
    Response.json({ status_code: status, id }, { status }),
  );
  await expect(readCustomEmoji(config, name)).resolves.toEqual({ kind });
});
test.each([
  [401, 401, missing],
  [500, 500, disabled],
  [404, 404, disabled],
  [501, 501, missing],
  [404, 404, "gateway.missing"],
  [404, 200, missing],
] as const)("keeps unmatched failures observable", async (status, code, id) => {
  const wire = { status_code: code, id };
  const { config } = fixture(Response.json(wire, { status }));
  const cause: unknown = await readCustomEmoji(config, name).catch((e) => e);
  expect(cause).toBeInstanceOf(ResponseError);
  if (!(cause instanceof ResponseError)) throw Error("Missing HTTP failure");
  expect(await cause.response.json()).toEqual(wire);
});
test("preserves a proxy's plain-text 404 response", async () => {
  const { config } = fixture(
    new Response("proxy unavailable", { status: 404 }),
  );
  const cause: unknown = await readCustomEmoji(config, name).catch((e) => e);
  if (!(cause instanceof ResponseError)) throw Error("Missing HTTP failure");
  expect(await cause.response.text()).toBe("proxy unavailable");
});
test.each([
  null,
  { ...image, name: "Fixture+Wave" },
  { ...image, id: "short" },
  { ...image, creator_id: null },
  { ...image, create_at: -1 },
  { ...image, update_at: 0 },
  { ...image, delete_at: 8 },
  { ...image, delete_at: undefined },
])("rejects a misdirected or invalid response", async (row) => {
  const { config } = fixture(Response.json(row));
  await expect(readCustomEmoji(config, name)).rejects.toThrow(TypeError);
});
test.each(["", "a".repeat(65), "wave/hand", "wave\n", "🙂"])(
  "rejects invalid names before sending a request",
  async (invalid) => {
    const { config, fetchApi } = fixture(Response.json(image));
    await expect(readCustomEmoji(config, invalid)).rejects.toThrow(TypeError);
    expect(fetchApi).not.toHaveBeenCalled();
  },
);
test("drops an aborted lookup, including when the network already completed", async () => {
  const controller = new AbortController();
  const fetchApi = vi.fn<typeof fetch>(async () => {
    controller.abort();
    return Response.json(image);
  });
  const config = new Configuration({
    basePath: "https://chat.example",
    fetchApi,
  });
  await expect(
    readCustomEmoji(config, name, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    readCustomEmoji(config, name, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchApi).toHaveBeenCalledTimes(1);
});
