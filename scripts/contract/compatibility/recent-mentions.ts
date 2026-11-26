import assert from "node:assert/strict";
import { accountSearch } from "../../../src/mattermost/account-search.ts";
import { openRecentMentions } from "../../../src/mattermost/recent-mentions.ts";
import { Configuration, PostsApi } from "../../../vendor/mattermost/index.js";

export async function checkRecentMentions(
  owner: Configuration,
  token: string,
  channel: string,
  privateChannel: string,
) {
  const basePath = owner.basePath;
  const config = new Configuration({ basePath, accessToken: token });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const me = basePath + "/api/v4/users/me";
  const response = await fetch(me, { headers });
  assert.equal(response.status, 200);
  const { id, username, notify_props: original } = await response.json();
  async function update(notifyProps: Record<string, string>) {
    const result = await fetch(me + "/patch", {
      method: "PUT",
      headers,
      body: JSON.stringify({ notify_props: notifyProps }),
    });
    assert.equal(result.status, 200);
  }
  const posts = new PostsApi(owner);
  async function write(channelId: string, message: string) {
    const post = await posts.createPost({
      createPostRequest: { channelId, message },
    });
    assert.ok(post.id);
    return post.id;
  }
  const keyword = "ummkaauroracall";
  const personal = await write(channel, `Please respond @${username}.`);
  const custom = await write(channel, keyword);
  const wide = await write(channel, "@channel check the date");
  const literal = await write(channel, "The channel opens here");
  const otherHandle = await write(channel, `Ping @${keyword}`);
  const chinese = await write(channel, "The channel serves 我爱吃番茄炒饭");
  const korean = await write(channel, "The channel accepts 이메일을");
  const hidden = await write(privateChannel, keyword);
  const search = accountSearch(config, (read) => read());
  try {
    for (const enabled of [false, true]) {
      await update({
        ...original,
        channel: String(enabled),
        mention_keys: [keyword, "番茄", "이메일"].join(","),
      });
      const mentions = await openRecentMentions(config, id, search, false);
      const page = await mentions.readPage(0);
      const ids = page.items.map((post) => post.id);
      assert.ok(ids.includes(personal), "Missing address to username");
      assert.ok(ids.includes(custom), "Missing personal keyword");
      assert.equal(ids.includes(wide), enabled, "Wrong broadcast inclusion");
      // Ordinary "channel" makes these candidates visible to PostgreSQL even when
      // its text-search configuration indexes the entire CJK word as one lexeme.
      if (enabled) {
        assert.ok(
          ids.includes(chinese),
          "Skipped Chinese mention in a server candidate",
        );
        assert.ok(
          ids.includes(korean),
          "Skipped Korean mention in a server candidate",
        );
      }
      assert.ok(!ids.includes(literal), "An ordinary word is not a broadcast");
      assert.ok(
        !ids.includes(otherHandle),
        "Bare keyword matched another handle",
      );
      assert.ok(!ids.includes(hidden), "A private mention reached a nonmember");
    }
    console.log(
      "Verified signed recent mentions, keywords, punctuation and private channel access.",
    );
  } finally {
    await update(original);
  }
}
