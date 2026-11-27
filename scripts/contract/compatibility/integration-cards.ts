import assert from "node:assert/strict";
import { accountPostCollections } from "../../../src/mattermost/account-post-collections.ts";
import { accountSearch } from "../../../src/mattermost/account-search.ts";
import { receivedIntegrationCards } from "../../../src/mattermost/integration-cards.ts";
import { accountCollectionActions } from "../../../src/mattermost/post-collection-actions.ts";
import {
  Configuration,
  type Post,
  PostFromJSON,
  PostsApi,
} from "../../../vendor/mattermost/index.js";

export async function checkIntegrationCards(
  base: string,
  reader: { id: string; token: string; roles: string },
  teamId: string,
  channelId: string,
  version: string,
) {
  assert.equal(reader.roles, "system_user");
  const requests: string[] = [];
  const config = new Configuration({
    basePath: base,
    accessToken: reader.token,
    fetchApi: (input, init) => {
      requests.push(new URL(String(input)).pathname);
      return fetch(input, init);
    },
  });
  const posts = new PostsApi(config);
  const collections = accountPostCollections(config, reader.id, (read) =>
    read(),
  );
  const actions = accountCollectionActions(config, reader.id, (write) =>
    write(),
  );
  const title = "Проверка релиза";
  const titleLink = "https://example.test/releases/21";
  const text = "**macOS и Android** · все проверки прошли";
  const pretext = "**Сборка** №21";
  const imageUrl = "http://images.example.test:8099/sample.png";
  const imageMetadata = { width: 4, height: 3, format: "png", frameCount: 0 };
  const marker = "integrationcardfixturemarker";
  const first = {
    title,
    title_link: titleLink,
    text,
    pretext,
    color: "#31aa72",
    author_name: "Сборщик",
    author_link: "https://example.test/builds",
    author_icon: imageUrl,
    image_url: imageUrl,
    thumb_url: imageUrl,
    footer: "CI",
    footer_icon: imageUrl,
    fallback: "Короткий текст релиза",
    fields: [
      { title: "Платформа", value: "`Android`", short: true },
      { title: "Ошибки", value: 0, short: false },
      { title: "Ожидается", value: null },
    ],
    actions: [
      {
        id: "details",
        name: "Details",
        type: "button",
        integration: {
          url: "http://images.example.test:8099/callback",
          context: { marker: "private fixture value" },
        },
      },
    ],
  };
  const second = { title: "Второй отчёт", fallback: "Только выдержка" };
  const create = (message: string, attachments?: object[], rootId?: string) =>
    posts.createPost({
      createPostRequest: {
        channelId,
        message,
        rootId,
        props: attachments && { attachments },
      },
    });
  const plain = await create("Text-only integration fixture control");
  const root = await create(marker, [first, second]);
  assert.ok(root.id);
  const reply = await create("", [first], root.id);
  const cardOnly = await create("", [{ title, text }]);
  assert.ok(reply.id && cardOnly.id && plain.id);
  const checkCard = (post: Post) => {
    const [card, secondCard] = receivedIntegrationCards(post, "complete");
    assert.equal(card.title, title);
    assert.equal(card.titleLink, titleLink);
    assert.equal(card.text, text);
    assert.equal(card.pretext, pretext);
    assert.equal(card.color, first.color);
    assert.equal(card.authorName, first.author_name);
    assert.equal(card.authorLink, first.author_link);
    assert.equal(card.footer, first.footer);
    assert.equal(card.fallback, first.fallback);
    for (const image of [
      card.image,
      card.authorIcon,
      card.thumbnail,
      card.footerIcon,
    ])
      assert.deepEqual(image, { url: imageUrl, metadata: imageMetadata });
    assert.deepEqual(card.fields, [
      { title: "Платформа", value: "`Android`", short: true },
      { title: "Ошибки", value: "0", short: false },
      { title: "Ожидается", value: undefined, short: false },
    ]);
    assert.doesNotMatch(
      JSON.stringify(card),
      /actions|\/callback|private fixture value|cookie/u,
    );
    if (post.id === root.id) {
      assert.equal(secondCard.title, second.title);
      assert.equal(secondCard.fallback, second.fallback);
      assert.equal(secondCard.text, undefined);
    }
  };

  const history = await posts.getPostsForChannel({ channelId, perPage: 60 });
  const historyRoot = history.posts?.[root.id];
  const historyCardOnly = history.posts?.[cardOnly.id];
  const historyPlain = history.posts?.[plain.id];
  assert.ok(historyRoot && historyCardOnly && historyPlain);
  checkCard(historyRoot);
  assert.equal(historyCardOnly.message, "");
  assert.equal(
    receivedIntegrationCards(historyCardOnly, "complete")[0].text,
    text,
  );
  assert.deepEqual(receivedIntegrationCards(historyPlain, "complete"), []);
  const narrow = await posts.getPostsForChannel({
    channelId,
    before: cardOnly.id,
    perPage: 1,
    collapsedThreads: false,
  });
  assert.deepEqual(narrow.order, [reply.id]);
  const extraRoot = narrow.posts?.[root.id];
  assert.ok(extraRoot);
  checkCard(extraRoot);
  const thread = await posts.getPostThread({ postId: root.id });
  const threadReply = thread.posts?.[reply.id];
  assert.ok(threadReply);
  assert.equal(threadReply.message, "");
  checkCard(threadReply);
  const exact = await posts.getPost({ postId: root.id });
  assert.equal(exact.message, marker);
  checkCard(exact);
  const wireFields = (exact.props as { attachments: (typeof first)[] })
    .attachments[0].fields;
  console.log(
    `Mattermost ${version} integration field values ${JSON.stringify(wireFields.map(({ value }) => value))}.`,
  );

  const search = accountSearch(config, (read) => read());
  const hits = await search.readPostSearchPage({
    teamId,
    terms: marker,
    page: 0,
    isOrSearch: false,
    includeDeletedChannels: false,
    timeZoneOffsetSeconds: 0,
  });
  assert.deepEqual(
    hits.items.map(({ id }) => id),
    [root.id],
  );
  assert.deepEqual(
    hits.items[0].cards,
    receivedIntegrationCards(exact, "complete"),
  );

  await actions.setPostSaved(cardOnly.id, true);
  await actions.setPostPinned(cardOnly.id, true);
  requests.length = 0;
  const saved = await collections.readSavedPosts({ kind: "all" }, 0);
  const pins = await collections.readPinnedChannelPosts(channelId);
  assert.deepEqual(requests, [
    "/api/v4/users/me/posts/flagged",
    `/api/v4/channels/${channelId}/pinned`,
  ]);
  for (const page of [saved, pins]) {
    const row = page.items.find(({ id }) => id === cardOnly.id);
    assert.ok(row);
    assert.equal(row.message, "");
    assert.deepEqual(
      row.cards,
      receivedIntegrationCards(historyCardOnly, "complete"),
    );
  }
  await actions.setPostSaved(cardOnly.id, false);
  await actions.setPostPinned(cardOnly.id, false);

  // The generated scope lacks /posts/ids. Decode its existing wire response with Post.
  const response = await fetch(`${base}/api/v4/posts/ids`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${reader.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([root.id]),
  });
  assert.equal(response.status, 200);
  const [batch] = (await response.json()).map(PostFromJSON);
  assert.equal(batch.id, exact.id);
  assert.equal(batch.updateAt, exact.updateAt);
  assert.ok(batch.props.attachments.length === 2);
  assert.equal(receivedIntegrationCards(batch, "partial"), undefined);

  await posts.patchPost({
    postId: root.id,
    patchPostRequest: { props: { attachments: [] } },
  });
  const cleared = await posts.getPost({ postId: root.id });
  assert.equal(cleared.metadata?.embeds?.[0]?.type, "message_attachment");
  assert.deepEqual(receivedIntegrationCards(cleared, "complete"), []);
  console.log(
    `Mattermost ${version} verified ordered integration cards in history, thread, direct post, search, Saved and Pins as a normal user, including partial and cleared observations.`,
  );
}
