import assert from "node:assert/strict";
import {
  readSearchTimezone,
  searchTimezoneOffsetSeconds,
} from "../../../src/mattermost/search-timezone.ts";
import {
  Configuration,
  PostsApi,
  type Timezone,
  UsersApi,
} from "../../../vendor/mattermost/index.js";

export async function checkUserTimezone(
  base: string,
  token: string,
  userId: string,
  teamId: string,
  postAt: (text: string, createAt: number) => Promise<string>,
) {
  const config = new Configuration({ basePath: base, accessToken: token });
  const users = new UsersApi(config);
  const posts = new PostsApi(config);
  const marker = "ummkazoneboundary";
  const eastern = await postAt(
    marker + " evening",
    Date.parse("2026-01-12T21:00:00Z"),
  );
  const western = await postAt(
    marker + " morning",
    Date.parse("2026-01-14T02:00:00Z"),
  );
  const read = async () => (await users.getUser({ userId: "me" })).timezone;
  const original = await read();
  assert.ok(original);
  assert.equal(typeof original.useAutomaticTimezone, "string");
  async function write(timezone: Timezone) {
    const result = await fetch(`${base}/api/v4/users/me/patch`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ timezone }),
    });
    assert.equal(result.status, 200);
  }
  try {
    for (const useAutomaticTimezone of ["false", "true"]) {
      const timezone = {
        useAutomaticTimezone,
        automaticTimezone: "Asia/Kathmandu",
        manualTimezone: "America/St_Johns",
      };
      await write(timezone);
      assert.deepEqual(await read(), timezone);
      const selected = await readSearchTimezone(config, userId);
      const automatic = useAutomaticTimezone === "true";
      assert.equal(
        selected,
        automatic ? timezone.automaticTimezone : timezone.manualTimezone,
      );
      const timeZoneOffset = searchTimezoneOffsetSeconds(
        selected,
        new Date("2026-01-13T12:00:00Z"),
      );
      assert.equal(timeZoneOffset, automatic ? 20700 : -12600);
      const found = await posts.searchPosts({
        teamId,
        searchPostsRequest: {
          terms: marker + " on:2026-01-13",
          isOrSearch: false,
          includeDeletedChannels: false,
          page: 0,
          perPage: 20,
          timeZoneOffset,
        },
      });
      assert.deepEqual(found.order, [automatic ? eastern : western]);
    }
  } finally {
    await write(original);
  }
}
