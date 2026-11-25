import { expect, test } from "vitest";
import { UserFromJSON } from "../../vendor/mattermost/index.js";
import {
  channelProfile,
  conversationName,
  directPartnerId,
  indexChannelProfiles,
  teammateName,
  teammateNameFormat,
} from "./channel-profiles.ts";

const me = "m".repeat(26);
const a = "a".repeat(26);
const b = "b".repeat(26);
const ordinary = channelProfile({ id: me, username: "myself" });
const anna = channelProfile({
  id: a,
  username: "anna",
  firstName: "Anna",
  lastName: "Vega",
  nickname: "Person 10",
});
const boris = channelProfile({
  id: b,
  username: "boris",
  lastName: "Rook",
  nickname: "Person 2",
});
const known = indexChannelProfiles([ordinary, anna, boris]);
const gm = {
  kind: "G",
  name: "server-hash",
  displayName: "anna, boris, myself",
};

test("projects only the public identity fields used by Channels", () => {
  const raw = UserFromJSON({
    id: a,
    username: "local-alias",
    remote_id: b,
    props: { RemoteUsername: "remote", unused: "omit" },
    first_name: "First",
    last_name: "Last",
    position: "Engineer",
    roles: "system_user system_guest",
    update_at: 456,
    delete_at: 789,
    last_picture_update: 123,
    is_bot: true,
    email: "private@example.test",
  });
  expect(channelProfile(raw)).toEqual({
    id: a,
    username: "local-alias",
    firstName: "First",
    lastName: "Last",
    nickname: "",
    position: "Engineer",
    isBot: true,
    isGuest: true,
    updateAt: 456,
    deleteAt: 789,
    lastPictureUpdate: 123,
    remoteUsername: "remote",
  });
  expect(
    channelProfile({ ...raw, remoteId: "", roles: "custom_system_guest" }),
  ).toMatchObject({ remoteUsername: "", isGuest: false });
  expect(ordinary).toMatchObject({
    updateAt: null,
    deleteAt: null,
    lastPictureUpdate: null,
    isBot: false,
  });
  for (const change of [
    { id: "invalid" },
    { username: " " },
    { remote_id: "bad" },
    { delete_at: -1 },
    { last_picture_update: 1.2 },
    { is_bot: "false" },
    { nickname: {} },
  ]) {
    expect(() =>
      channelProfile(UserFromJSON({ id: a, username: "anna", ...change })),
    ).toThrow(TypeError);
  }
});

test("applies the server lock only when the setting and license both enable it", () => {
  for (const locked of ["false", "true"]) {
    for (const licensed of ["false", "true"]) {
      expect(
        teammateNameFormat(
          { TeammateNameDisplay: "full_name", LockTeammateNameDisplay: locked },
          { LockTeammateNameDisplay: licensed },
          "nickname_full_name",
        ),
      ).toBe(
        locked === "true" && licensed === "true"
          ? "full_name"
          : "nickname_full_name",
      );
    }
  }
  expect(
    teammateNameFormat({ TeammateNameDisplay: "full_name" }, {}, undefined),
  ).toBe("full_name");
  expect(teammateNameFormat({ TeammateNameDisplay: "full_name" }, {}, "")).toBe(
    "username",
  );
  expect(teammateNameFormat({}, {}, undefined)).toBe("username");
});

test("uses the official display order for spaces, partial names and remote usernames", () => {
  expect(teammateName(anna, "full_name")).toBe("Anna Vega");
  expect(teammateName(anna, "nickname_full_name")).toBe("Person 10");
  expect(teammateName({ ...anna, nickname: "" }, "nickname_full_name")).toBe(
    "Anna Vega",
  );
  expect(teammateName({ ...anna, nickname: " " }, "nickname_full_name")).toBe(
    "anna",
  );
  expect(teammateName({ ...anna, lastName: "" }, "full_name")).toBe("Anna");
  expect(teammateName(boris, "full_name")).toBe("Rook");
  expect(teammateName(ordinary, "full_name")).toBe("myself");
  expect(teammateName({ ...anna, remoteUsername: "remote" }, "username")).toBe(
    "remote",
  );
  expect(teammateName({ ...anna, remoteUsername: " " }, "username")).toBe(
    "anna",
  );
});

test("addresses both positions in direct channel handles and self messages", () => {
  for (const [handle, id] of [
    [me + "__" + a, a],
    [b + "__" + me, b],
    [me + "__" + me, me],
    [a + "__" + b, null],
    [me + "__short", null],
    [me + "__" + a + "__" + b, null],
  ]) {
    expect(directPartnerId(String(handle), me)).toBe(id);
  }
  const dm = { kind: "D", name: a + "__" + me, displayName: "" };
  expect(conversationName(dm, me, known, "full_name", "en")).toBe("Anna Vega");
  expect(
    conversationName(
      { ...dm, name: me + "__" + me },
      me,
      known,
      "username",
      "en",
    ),
  ).toBe("myself");
  expect(
    conversationName(dm, me, indexChannelProfiles([]), "username", "en"),
  ).toBe("");
  expect(
    conversationName(
      { kind: "P", name: "engineering", displayName: "Разработка" },
      me,
      known,
      "username",
      "ru",
    ),
  ).toBe("Разработка");
});

test("keeps the server group label until every username resolves and respects known membership", () => {
  expect(conversationName(gm, me, known, "nickname_full_name", "en")).toBe(
    "Person 2, Person 10",
  );
  const partial = indexChannelProfiles([ordinary, anna]);
  expect(conversationName(gm, me, partial, "full_name", "en")).toBe(
    gm.displayName,
  );
  const ids = new Set([a, me, b]);
  expect(conversationName(gm, me, partial, "full_name", "ru", ids)).toBe(
    ["Anna Vega", "Кто-то"]
      .sort(new Intl.Collator("ru", { numeric: true }).compare)
      .join(", "),
  );
  expect(
    conversationName(gm, me, partial, "username", "en", new Set([b])),
  ).toBe("Someone");
  expect(conversationName(gm, me, known, "username", "ru", new Set([me]))).toBe(
    "",
  );
});
