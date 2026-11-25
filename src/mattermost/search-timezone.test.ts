import { expect, test, vi } from "vitest";
import { Configuration } from "../../vendor/mattermost/index.js";
import {
  readSearchTimezone,
  searchTimezoneOffsetSeconds,
} from "./search-timezone.ts";

const id = "u".repeat(26);
const basePath = "https://example.test/team/chat";
test.each([
  [
    {
      useAutomaticTimezone: "false",
      manualTimezone: "America/St_Johns",
      automaticTimezone: "Europe/Berlin",
    },
    "America/St_Johns",
  ],
  [
    {
      useAutomaticTimezone: "true",
      manualTimezone: "America/St_Johns",
      automaticTimezone: "Asia/Kathmandu",
    },
    "Asia/Kathmandu",
  ],
  [
    {
      useAutomaticTimezone: "true",
      automaticTimezone: "",
      manualTimezone: "Europe/Berlin",
    },
    "UTC",
  ],
  [undefined, "UTC"],
])(
  "uses the selected zone of the signed profile",
  async (timezone, expected) => {
    const get = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id, timezone }));
    const zone = await readSearchTimezone(
      new Configuration({ basePath, fetchApi: get }),
      id,
    );
    expect(zone).toBe(expected);
    expect(get.mock.calls[0]?.[0]).toBe(basePath + "/api/v4/users/me");
    expect(get).toHaveBeenCalledOnce();
  },
);

test("rejects a different profile and discards an aborted response", async () => {
  const get = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id: "x".repeat(26) }));
  const config = new Configuration({ basePath, fetchApi: get });
  await expect(readSearchTimezone(config, id)).rejects.toThrow("owner");
  const abort = new AbortController();
  get.mockImplementationOnce(async () => {
    abort.abort("left");
    return Response.json({ id });
  });
  await expect(readSearchTimezone(config, id, abort.signal)).rejects.toBe(
    "left",
  );
  await expect(readSearchTimezone(config, id, abort.signal)).rejects.toBe(
    "left",
  );
  expect(get).toHaveBeenCalledTimes(2);
});

test.each([
  ["Europe/Berlin", "2026-01-13", 3600],
  ["Europe/Berlin", "2026-07-13", 7200],
  ["America/St_Johns", "2026-01-13", -12600],
  ["Asia/Kathmandu", "2026-07-13", 20700],
  ["Asia/Kathmandu", "1900-01-01", 20476],
  ["America/St_Johns", "1900-01-01", -12652],
  ["Africa/Monrovia", "1970-01-01", -2670],
  ["UTC", "2026-07-13", 0],
])("resolves the offset of %s at %s", (zone, instant, seconds) => {
  expect(
    searchTimezoneOffsetSeconds(zone, new Date(instant + "T12:00:00Z")),
  ).toBe(seconds);
});
test("rejects an unknown nonempty timezone", () => {
  expect(() => searchTimezoneOffsetSeconds("Europe/Unknown")).toThrow(
    RangeError,
  );
});
