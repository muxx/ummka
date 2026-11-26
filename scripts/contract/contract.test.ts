import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stringify } from "yaml";
import nativeAuth from "../../contracts/mattermost/native-auth.json" with {
  type: "json",
};
import catalog from "../../contracts/mattermost/operations.json" with {
  type: "json",
};
import { correctAuthentication } from "./authentication-corrections.ts";
import {
  correctChannelStats,
  correctChannelStatsQuery,
} from "./channel-audience-corrections.ts";
import { singleChannelMember } from "./channel-member-correction.ts";
import {
  autocompleteCommand,
  correctAutocomplete,
} from "./command-autocomplete.ts";
import {
  correctCommandResponse,
  correctExecuteCommand,
} from "./command-corrections.ts";
import { correctCustomEmoji } from "./custom-emoji-correction.ts";
import {
  correctFileModel,
  correctFileSearch,
} from "./file-search-corrections.ts";
import {
  correctAssociatedGroup,
  correctGroupAssociations,
} from "./group-association-corrections.ts";
import {
  correctGroupAudienceModel,
  correctGroupAudienceResponse,
} from "./group-audience-correction.ts";
import {
  checkEditHistoryOperation,
  correctFlaggedPosts,
  correctHistoryQuery,
  correctHistorySchema,
  correctRedactedFileCount,
} from "./history-corrections.ts";
import { correctMentionGroup } from "./mention-group-correction.ts";
import { correctNotificationProps } from "./notification-props.ts";
import { correctNullableList } from "./nullable-list-corrections.ts";
import { type Fields, object } from "./objects.ts";
import {
  checkPostInfoOperation,
  postInfoSchema,
} from "./post-info-correction.ts";
import {
  correctCreatePost,
  correctPatchPost,
} from "./post-mutation-corrections.ts";
import {
  correctProfileImage,
  correctProfileTimezone,
  correctUserProfile,
} from "./profile-corrections.ts";
import {
  correctReaction,
  correctSaveReaction,
} from "./reaction-corrections.ts";
import {
  correctBulkChannelView,
  correctChannelView,
  correctSetPostUnread,
  correctUnreadAt,
} from "./read-state-corrections.ts";
import { buildSpecification, readSource } from "./schema.ts";
import {
  correctDirectoryFlags,
  correctSidebarCategory,
  correctSidebarResponse,
  correctSidebarSchema,
  correctSidebarWrite,
  sidebarWriteCorrections,
} from "./sidebar-corrections.ts";
import { correctSinglePost } from "./single-post-correction.ts";
import { correctTeamMemberRequest } from "./team-member-correction.ts";
import {
  correctThreadListModel,
  correctThreadListQuery,
  threadListPath,
} from "./thread-list-corrections.ts";
import { correctThreadMutation } from "./thread-mutation-correction.ts";

const sources = process.env.UMMKA_CONTRACT_SOURCES;
const work = process.env.UMMKA_CONTRACT_WORK;
if (!sources || !work)
  throw new Error("Run make check-contract to prepare the test inputs");
const read = readSource.bind(null, sources);
const serialized = readFileSync(join(work, "openapi.json"), "utf8");
const contract = object(JSON.parse(serialized), "contract");
const nativeContract = JSON.parse(
  readFileSync(join(work, "native-auth.json"), "utf8"),
);
const definitions = read("definitions.yaml");
const ping = "/api/v4/system/ping";
const system = read("system.yaml");
const profileImage = "/api/v4/users/{user_id}/image";
const userRoute = "/api/v4/users/{user_id}";
const users = read("users.yaml");
const history = "/api/v4/channels/{channel_id}/posts";
const sidebar = "/api/v4/users/{user_id}/teams/{team_id}/channels/categories";
const threadFlags = [
  "skipFetchThreads",
  "collapsedThreads",
  "collapsedThreadsExtended",
];

function at(document: unknown, path: string[]) {
  let value = document;
  for (const key of path) {
    const parent = object(value, key);
    assert.ok(Object.hasOwn(parent, key), `Missing ${path.join(" > ")}`);
    value = parent[key];
  }
  return value;
}

test("keeps native authentication outside the WebView and describes the actual wire contract", () => {
  const auth = nativeContract;
  assert.deepEqual(
    auth,
    JSON.parse(JSON.stringify(buildSpecification(read, nativeAuth))),
  );
  assert.deepEqual(Object.keys(auth.paths).sort(), [
    "/api/v4/users/login",
    "/api/v4/users/logout",
  ]);
  for (const { path } of nativeAuth) {
    assert(!Object.hasOwn(object(contract.paths, "WebView paths"), path));
    const operation = auth.paths[path].post;
    assert.equal(operation.responses["201"], undefined);
    assert.ok(
      operation.responses["200"].content["application/json"].schema.$ref,
    );
  }
  const login = auth.paths["/api/v4/users/login"].post;
  assert.deepEqual(login.security, []);
  assert.deepEqual(login.responses["200"].headers.Token, {
    required: true,
    schema: { type: "string" },
  });
  const fields =
    login.requestBody.content["application/json"].schema.properties;
  assert.deepEqual(fields.ldap_only, { type: "string" });
  assert.equal(fields.password.format, "password");
  assert.equal(fields.token.format, "password");
});

test("rejects an upstream change to a corrected login response or input", () => {
  const login = object(at(users, ["/api/v4/users/login", "post"]), "Login");
  const withStatus = structuredClone(login);
  object(withStatus.responses, "responses")["200"] = {};
  assert.throws(() => correctAuthentication(withStatus), /success response/);
  for (const name of ["ldap_only", "token", "password"]) {
    const changed = structuredClone(login);
    const field = object(
      at(changed, [
        "requestBody",
        "content",
        "application/json",
        "schema",
        "properties",
        name,
      ]),
      name,
    );
    field.type = "integer";
    assert.throws(() => correctAuthentication(changed), /upstream/);
  }
});

const definitionPaths = [
  ["security"],
  ["components", "securitySchemes", "bearerAuth"],
  ["components", "schemas", "SystemStatusResponse"],
  ["components", "responses", "InternalServerError"],
  ["components", "responses", "BadRequest"],
  ["components", "responses", "NotImplemented"],
  ["components", "schemas", "AppError"],
  ["components", "schemas", "Team"],
  ["components", "schemas", "TeamMember"],
  ["components", "schemas", "Role"],
  ["components", "schemas", "CommandResponse"],
  ["components", "schemas", "AutocompleteSuggestion"],
  ["components", "schemas", "Channel"],
  ["components", "schemas", "ChannelMember"],
  ["components", "schemas", "ChannelNotifyProps"],
  ["components", "schemas", "ChannelStats"],
  ["components", "schemas", "ChannelMemberCountByGroup"],
  ...["Emoji", "FileInfo", "PostAcknowledgement", "Reaction"].map((name) => [
    "components",
    "schemas",
    name,
  ]),
  ["components", "responses", "Forbidden"],
  ["components", "schemas", "User"],
  ["components", "schemas", "UserNotifyProps"],
  ["components", "schemas", "Timezone"],
  ["components", "responses", "Unauthorized"],
  ["components", "responses", "NotFound"],
];

test("rechecks both tagged command contracts when the request or response definition changes", () => {
  const route = "/api/v4/commands/execute";
  const schemaPath = ["components", "schemas", "CommandResponse"];
  for (const tag of ["base", "newer"]) {
    const base = object(at(read("commands.yaml"), [route, "post"]), route);
    const newer = read("commands-12.1.0.yaml");
    const operation =
      tag === "base" ? base : object(at(newer, [route, "post"]), route);
    const fields = object(
      at(operation, [
        "requestBody",
        "content",
        "application/json",
        "schema",
        "properties",
      ]),
      "command inputs",
    );
    fields.root_id = { type: "string" };
    assert.throws(
      () => correctExecuteCommand(base, newer),
      /Review ExecuteCommand/,
    );
    const definitions = read("definitions.yaml");
    const next = read("definitions-12.1.0.yaml");
    const baseline = object(at(definitions, schemaPath), "CommandResponse");
    const target =
      tag === "base"
        ? baseline
        : object(at(next, schemaPath), "v12 CommandResponse");
    object(target.properties, "command response").trigger_id = {
      type: "string",
    };
    assert.throws(
      () => correctCommandResponse(baseline, next),
      /Review CommandResponse/,
    );
  }
});

test("detects suggestion field drift in either pinned definition before generating the client", () => {
  for (const file of ["definitions.yaml", "definitions-12.1.0.yaml"]) {
    for (const mutate of [
      (fields: Fields) => {
        delete fields.IconData;
      },
      (fields: Fields) => {
        fields.Complete = { type: "integer" };
      },
      (fields: Fields) => {
        fields.Additional = { type: "string" };
      },
    ]) {
      assert.throws(
        () =>
          buildSpecification((name) => {
            const spec = read(name);
            if (name === file)
              mutate(
                object(
                  at(spec, [
                    "components",
                    "schemas",
                    "AutocompleteSuggestion",
                    "properties",
                  ]),
                  file,
                ),
              );
            return spec;
          }),
        /Review AutocompleteSuggestion/,
      );
    }
  }
});

test("guards both tagged sources of command suggestions and exposes the picker fields", () => {
  const route = "/api/v4/teams/{team_id}/commands/autocomplete_suggestions";
  const keys = [
    "id",
    "trigger",
    "display_name",
    "auto_complete",
    "auto_complete_hint",
    "auto_complete_desc",
    "icon_url",
    "autocomplete_icon_data",
  ];
  assert.deepEqual(
    Object.keys(
      object(
        at(contract, [
          "components",
          "schemas",
          "AutocompleteCommand",
          "properties",
        ]),
        "command picker",
      ),
    ).sort(),
    keys.sort(),
  );
  for (const tag of ["original", "newer"]) {
    const base = read("commands.yaml");
    const newer = read("commands-12.1.0.yaml");
    const op = object(at(base, [route, "get"]), route);
    const changed = at(tag === "original" ? base : newer, [
      route,
      "get",
      "parameters",
    ]);
    assert.ok(Array.isArray(changed));
    changed.push({ name: "root_id", in: "query", schema: { type: "string" } });
    assert.throws(
      () => correctAutocomplete(op, newer, route),
      /Review autocomplete/,
    );
    const definitions = read("definitions.yaml");
    const next = read("definitions-12.1.0.yaml");
    object(
      at(tag === "original" ? definitions : next, [
        "components",
        "schemas",
        "Command",
        "properties",
      ]),
      "fields",
    ).autocomplete_icon_data = { type: "string" };
    assert.throws(
      () =>
        autocompleteCommand(
          object(at(definitions, ["components", "schemas"]), "v10 schemas"),
          next,
        ),
      /Review Command.autocomplete_icon_data/,
    );
  }
});

for (const [id, file, path, method] of [
  [
    "GetChannelMembersTimezones",
    "channels",
    "/api/v4/channels/{channel_id}/timezones",
    "get",
  ],
  ["GetFileInfosForPost", "posts", "/api/v4/posts/{post_id}/files/info", "get"],
  ["GetRolesByNames", "roles", "/api/v4/roles/names", "post"],
  [
    "GetPreferences",
    "preferences",
    "/api/v4/users/{user_id}/preferences",
    "get",
  ],
] as const) {
  test(`only the successful ${id} list is nullable, with matching schemas on both tags`, () => {
    const base = object(at(read(`${file}.yaml`), [path, method]), id);
    const newer = read(`${file}-12.1.0.yaml`);
    const response = [
      "responses",
      "200",
      "content",
      "application/json",
      "schema",
    ];
    const expected = structuredClone(base);
    object(at(expected, response), id).nullable = true;
    assert.deepEqual(correctNullableList(id, base, newer), expected);
    for (const target of ["baseline", "reference"]) {
      const first = structuredClone(base);
      const other = structuredClone(newer);
      const changed = target === "baseline" ? first : at(other, [path, method]);
      object(at(changed, response), id).nullable = true;
      assert.throws(
        () => correctNullableList(id, first, other),
        /Review the nullable/,
      );
    }
  });
}

test("rechecks the timezone field type against both pinned releases", () => {
  const path = ["components", "schemas", "Timezone"];
  for (const version of ["baseline", "newer"]) {
    const source = object(at(read("definitions.yaml"), path), "Timezone");
    const newer = read("definitions-12.1.0.yaml");
    const timezone =
      version === "baseline" ? source : object(at(newer, path), "Timezone");
    object(at(timezone, ["properties", "useAutomaticTimezone"]), "mode").type =
      version === "baseline" ? "string" : "boolean";
    assert.throws(
      () => correctProfileTimezone(source, newer),
      /Review the Timezone correction/,
    );
  }
});

for (const name of ["ChannelNotifyProps", "UserNotifyProps"] as const) {
  test(`rechecks ${name} when either pinned model changes`, () => {
    const path = ["components", "schemas", name];
    for (const reference of [false, true]) {
      for (const change of ["added", "required", "type"]) {
        const source = object(at(read("definitions.yaml"), path), "baseline");
        const next = read("definitions-12.1.0.yaml");
        const target = reference
          ? object(at(next, path), "comparison")
          : source;
        const props = object(target.properties, "properties");
        if (change === "added")
          props.desktop_notification_sound = { type: "string" };
        if (change === "required") target.required = ["push"];
        if (change === "type") props.email = { type: "boolean" };
        assert.throws(() => correctNotificationProps(name, source, next), {
          message: `Review ${name} against the pinned sources`,
        });
      }
    }
  });
}

test("channel stats corrections detect upstream fields on either pin", () => {
  const path = "/api/v4/channels/{channel_id}/stats";
  const modelPath = ["components", "schemas", "ChannelStats"];
  for (const reference of [false, true]) {
    const baseline = object(at(read("channels.yaml"), [path, "get"]), path);
    const newer = read("channels-12.1.0.yaml");
    const changed = reference
      ? object(at(newer, [path, "get"]), path)
      : baseline;
    assert.ok(Array.isArray(changed.parameters));
    changed.parameters.push({ name: "exclude_files_count", in: "query" });
    assert.throws(
      () => correctChannelStatsQuery(baseline, newer),
      /Review GetChannelStats/,
    );
    for (const name of ["guest_count", "pinnedpost_count", "files_count"]) {
      const source = object(
        at(read("definitions.yaml"), modelPath),
        "ChannelStats",
      );
      const next = read("definitions-12.1.0.yaml");
      const changedModel = reference
        ? object(at(next, modelPath), "ChannelStats")
        : source;
      object(changedModel.properties, "properties")[name] = { type: "integer" };
      assert.throws(
        () => correctChannelStats(source, next),
        /Review ChannelStats/,
      );
    }
  }
});

test("group association corrections reject newly documented response shapes in either version", () => {
  for (const [id, path] of [
    ["GetGroupsByTeam", "/api/v4/teams/{team_id}/groups"],
    [
      "GetGroupsAssociatedToChannelsByTeam",
      "/api/v4/teams/{team_id}/groups_by_channels",
    ],
  ] as const) {
    for (const version of ["10", "12"]) {
      const source = structuredClone(
        object(at(read("groups.yaml"), [path, "get"]), id),
      );
      const newer = structuredClone(read("groups-12.1.0.yaml"));
      const op =
        version === "10" ? source : object(at(newer, [path, "get"]), id);
      const body = object(
        at(op, ["responses", "200", "content", "application/json"]),
        id,
      );
      body.schema = {
        type: "object",
        properties: { new_result: { type: "object" } },
      };
      assert.throws(
        () => correctGroupAssociations(id, path, source, newer),
        /Review .* response/,
      );
    }
  }
});

test("the channel group map keeps its array item type in each pinned source", () => {
  const operations = catalog.filter(
    (op) => op.id === "GetGroupsAssociatedToChannelsByTeam",
  );
  assert.equal(operations.length, 1);
  for (const changed of [
    ["definitions.yaml"],
    ["definitions-12.1.0.yaml"],
    ["definitions.yaml", "definitions-12.1.0.yaml"],
  ]) {
    const build = () =>
      buildSpecification((file) => {
        const doc = read(file);
        if (changed.includes(file)) {
          object(
            at(doc, [
              "components",
              "schemas",
              "GroupsAssociatedToChannels",
              "additionalProperties",
            ]),
            "map value",
          ).items = { type: "string" };
        }
        return doc;
      }, operations);
    assert.throws(
      build,
      /Review GroupsAssociatedToChannels against the pinned sources/,
    );
  }
});

test("group associations reject changes to the location, requiredness, type or default of a parameter", () => {
  const baseline = read("groups.yaml");
  const reference = read("groups-12.1.0.yaml");
  for (const path of [
    "/api/v4/teams/{team_id}/groups",
    "/api/v4/teams/{team_id}/groups_by_channels",
  ]) {
    for (const version of ["baseline", "newer", "both"]) {
      for (const [name, change] of [
        ["team_id", { in: "query" }],
        ["team_id", { required: false }],
        ["page", { schema: { type: "string", default: 0 } }],
        ["per_page", { schema: { type: "integer", default: 30 } }],
      ] as const) {
        const source = structuredClone(
          object(at(baseline, [path, "get"]), path),
        );
        const newer = { [path]: structuredClone(reference[path]) };
        const next = object(at(newer, [path, "get"]), path);
        const id = source.operationId;
        assert.ok(
          id === "GetGroupsByTeam" ||
            id === "GetGroupsAssociatedToChannelsByTeam",
        );
        for (const op of version === "both"
          ? [source, next]
          : [version === "baseline" ? source : next]) {
          assert.ok(Array.isArray(op.parameters));
          const parameter = op.parameters.find(
            (item: Fields) => item.name === name,
          );
          assert.ok(parameter);
          Object.assign(parameter, change);
        }
        assert.throws(
          () => correctGroupAssociations(id, path, source, newer),
          /Review .* parameters/,
        );
      }
    }
  }
});

test("group search keeps the same public parameters and result model in both releases", () => {
  const opPath = ["/api/v4/groups", "get"];
  const baseline = object(at(read("groups.yaml"), opPath), "GetGroups");
  const newer = object(at(read("groups-12.1.0.yaml"), opPath), "GetGroups");
  assert.deepEqual(newer.parameters, baseline.parameters);
  for (const op of [baseline, newer]) {
    assert.equal(op.operationId, "GetGroups");
    assert.deepEqual(
      at(op, ["responses", "200", "content", "application/json", "schema"]),
      { type: "array", items: { $ref: "#/components/schemas/Group" } },
    );
  }
});

test("group projection stops on drift in either definition", () => {
  const path = ["components", "schemas", "Group"];
  for (const version of ["10", "12"]) {
    const baseline = structuredClone(object(at(definitions, path), "Group"));
    const newer = structuredClone(read("definitions-12.1.0.yaml"));
    const model =
      version === "10" ? baseline : object(at(newer, path), "Group");
    object(model.properties, "Group").allow_reference = { type: "boolean" };
    assert.throws(() => correctMentionGroup(baseline, newer), /Review Group/);
  }
});

test("group audience corrections stop if either source documents the missing contract", () => {
  const route = "/api/v4/channels/{channel_id}/member_counts_by_group";
  const modelPath = ["components", "schemas", "ChannelMemberCountByGroup"];
  for (const reference of [false, true]) {
    const baseline = object(at(read("channels.yaml"), [route, "get"]), route);
    const newer = read("channels-12.1.0.yaml");
    const changed = reference ? at(newer, [route, "get"]) : baseline;
    object(at(changed, ["responses", "200"]), "success").content = {};
    assert.throws(
      () => correctGroupAudienceResponse(baseline, newer),
      /Review GetChannelMemberCountsByGroup/,
    );
    const model = object(at(read("definitions.yaml"), modelPath), "group");
    const definitions = read("definitions-12.1.0.yaml");
    const changedModel = reference ? at(definitions, modelPath) : model;
    object(
      at(changedModel, ["properties", "channel_member_timezones_count"]),
      "count",
    ).type = "integer";
    assert.throws(
      () => correctGroupAudienceModel(model, definitions),
      /Review ChannelMemberCountByGroup/,
    );
  }
});

test("create-post correction detects changes in either tagged source", () => {
  const route = "/api/v4/posts";
  const old = at(read("posts.yaml"), [route, "post"]);
  const reference = read("posts-12.1.0.yaml");
  const props = [
    "requestBody",
    "content",
    "application/json",
    "schema",
    "properties",
  ];
  for (const changedVersion of ["baseline", "reference"]) {
    const before = structuredClone(object(old, route));
    const after = structuredClone(reference);
    const changed =
      changedVersion === "baseline" ? before : at(after, [route, "post"]);
    object(at(changed, props), "properties").pending_post_id = {
      type: "string",
    };
    assert.throws(() => correctCreatePost(before, after), /Review CreatePost/);
  }
});

test("a corrected upstream patch-body type requires rechecking the local correction", () => {
  const route = "/api/v4/posts/{post_id}/patch";
  const source = object(at(read("posts.yaml"), [route, "put"]), route);
  const newer = read("posts-12.1.0.yaml");
  for (const version of ["baseline", "reference"]) {
    const baseline = structuredClone(source);
    const reference = structuredClone(newer);
    const changed =
      version === "baseline" ? baseline : at(reference, [route, "put"]);
    object(
      at(changed, [
        "requestBody",
        "content",
        "application/json",
        "schema",
        "properties",
        "props",
      ]),
      "props",
    ).type = "object";
    assert.throws(
      () => correctPatchPost(baseline, reference),
      /Review PatchPost/,
    );
  }
});

test("checks both upstream channel-view bodies and the bulk operation before correcting them", () => {
  const view = "/api/v4/channels/members/{user_id}/view";
  const bulk = "/api/v4/channels/members/{user_id}/mark_read";
  const base = read("channels.yaml"),
    next = read("channels-12.1.0.yaml");
  const bodyFields = [
    "post",
    "requestBody",
    "content",
    "application/json",
    "schema",
    "properties",
  ];
  const replyFields = [
    "post",
    "responses",
    "200",
    "content",
    "application/json",
    "schema",
    "properties",
    "last_viewed_at_times",
  ];
  assert.deepEqual(
    at(contract, ["paths", view, ...bodyFields, "collapsed_threads_supported"]),
    { type: "boolean" },
  );
  for (const path of [view, bulk])
    assert.deepEqual(
      at(contract, ["paths", path, ...replyFields, "additionalProperties"]),
      { type: "integer", format: "int64" },
    );
  for (const file of ["channels.yaml", "channels-12.1.0.yaml"]) {
    const source = structuredClone(file === "channels.yaml" ? base : next);
    const fields = object(at(source, [view, ...bodyFields]), "input");
    fields.collapsed_threads_supported = { type: "boolean" };
    const v10 = file === "channels.yaml" ? source : base,
      v12 = file === "channels-12.1.0.yaml" ? source : next;
    assert.throws(
      () =>
        correctChannelView(object(at(v10, [view, "post"]), "view"), v12, view),
      /Review ViewChannel/,
    );
  }
  const command = object(at(next, [bulk, "post"]), "bulk");
  assert.throws(
    () => correctBulkChannelView(command, { ...base, [bulk]: {} }, bulk),
    /Review MarkChannelsReadForUser/,
  );
  const changed = structuredClone(next);
  object(
    at(changed, [bulk, ...replyFields]),
    "timestamps",
  ).additionalProperties = { type: "string" };
  assert.throws(
    () =>
      correctBulkChannelView(
        object(at(changed, [bulk, "post"]), "bulk"),
        base,
        bulk,
      ),
    /Review MarkChannelsReadForUser/,
  );
});

test("requires explicit unread support and detects changed upstream schemas on both versions", () => {
  const path = "/api/v4/users/{user_id}/posts/{post_id}/set_unread";
  const base = read("posts.yaml");
  const next = read("posts-12.1.0.yaml");
  const props = ["components", "schemas", "ChannelUnreadAt", "properties"];
  assert.deepEqual(
    at(contract, [
      "paths",
      path,
      "post",
      "requestBody",
      "content",
      "application/json",
      "schema",
      "required",
    ]),
    ["collapsed_threads_supported"],
  );
  for (const key of [
    "msg_count_root",
    "mention_count_root",
    "urgent_mention_count",
  ])
    assert.deepEqual(at(contract, [...props, key]), {
      type: "integer",
      format: "int64",
    });
  assert.deepEqual(at(contract, [...props, "user_id"]), { type: "string" });
  for (const newer of [false, true]) {
    const modified = structuredClone(newer ? next : base);
    object(at(modified, [path, "post"]), "post").requestBody = {};
    assert.throws(
      () =>
        correctSetPostUnread(
          object(at(newer ? base : modified, [path, "post"]), "post"),
          newer ? modified : next,
          path,
        ),
      /Review SetPostUnread/,
    );
    const raw = read("definitions.yaml"),
      ref = read("definitions-12.1.0.yaml");
    object(at(newer ? ref : raw, props), "unread").msg_count_root = {
      type: "integer",
    };
    assert.throws(
      () => correctUnreadAt(object(at(raw, props.slice(0, -1)), "unread"), ref),
      /Review ChannelUnreadAt/,
    );
  }
});

test("flagged and pinned collections return a single PostList and changing either upstream flagged schema requires review", () => {
  const path = "/api/v4/users/{user_id}/posts/flagged";
  const output = ["responses", "200", "content", "application/json", "schema"];
  const list = { $ref: "#/components/schemas/PostList" };
  for (const route of [path, "/api/v4/channels/{channel_id}/pinned"])
    assert.deepEqual(at(contract, ["paths", route, "get", ...output]), list);
  for (const version of ["baseline", "reference"]) {
    const old = read("posts.yaml"),
      next = read("posts-12.1.0.yaml");
    const media = object(
      at(version === "baseline" ? old : next, [
        path,
        "get",
        ...output.slice(0, -1),
      ]),
      path,
    );
    media.schema = list;
    assert.throws(
      () => correctFlaggedPosts(object(at(old, [path, "get"]), path), next),
      /Review the GetFlaggedPostsForUser response/,
    );
  }
});

test("thread list corrections track the actual cursors, counters, null pages and user participants", () => {
  const original = object(
    at(read("users.yaml"), [threadListPath, "get"]),
    "operation",
  );
  const newer = object(
    at(read("users-12.1.0.yaml"), [threadListPath, "get"]),
    "operation",
  );
  const params = at(contract, ["paths", threadListPath, "get", "parameters"]);
  assert.ok(Array.isArray(params));
  assert.deepEqual(
    params.map((p) => p.name),
    [
      "user_id",
      "team_id",
      "since",
      "deleted",
      "extended",
      "per_page",
      "totalsOnly",
      "threadsOnly",
      "before",
      "after",
      "unread",
      "excludeDirect",
    ],
  );
  const changed = { ...original, parameters: [...params] };
  assert.throws(() => correctThreadListQuery(changed, newer), /Review both/);
  assert.throws(() => correctThreadListQuery(changed, changed), /Review both/);
  for (const name of ["UserThreads", "UserThread"] as const) {
    const path = ["components", "schemas", name];
    const source = object(at(definitions, path), name);
    const next = object(at(read("definitions-12.1.0.yaml"), path), name);
    const fields = object(at(contract, [...path, "properties"]), "properties");
    const unexpected = {
      ...source,
      properties: {
        ...object(source.properties, name),
        unexpected: { type: "string" },
      },
    };
    assert.throws(
      () => correctThreadListModel(name, unexpected, next),
      /Review both/,
    );
    assert.throws(
      () => correctThreadListModel(name, unexpected, unexpected),
      /Review both/,
    );
    if (name === "UserThreads") {
      assert.equal(at(fields, ["threads", "nullable"]), true);
      for (const key of [
        "total_unread_threads",
        "total_unread_mentions",
        "total_unread_urgent_mentions",
      ])
        assert.deepEqual(fields[key], { type: "integer", format: "int64" });
    } else {
      assert.equal(
        at(fields, ["participants", "items", "$ref"]),
        "#/components/schemas/User",
      );
      assert.deepEqual(fields.is_urgent, { type: "boolean" });
      for (const key of ["unread_replies", "unread_mentions", "delete_at"])
        assert.deepEqual(fields[key], { type: "integer", format: "int64" });
    }
  }
});

test("both thread follow verbs return StatusOK and stop on upstream response changes", () => {
  const path =
    "/api/v4/users/{user_id}/teams/{team_id}/threads/{thread_id}/following";
  for (const method of ["put", "delete"]) {
    const source = object(at(read("users.yaml"), [path, method]), method);
    const newer = object(at(read("users-12.1.0.yaml"), [path, method]), method);
    assert.equal(
      at(contract, [
        "paths",
        path,
        method,
        "responses",
        "200",
        "content",
        "application/json",
        "schema",
        "$ref",
      ]),
      "#/components/schemas/StatusOK",
    );
    const changed = {
      ...source,
      responses: { "200": { description: "changed" } },
    };
    assert.throws(() => correctThreadMutation(source, changed), /Review both/);
    assert.throws(() => correctThreadMutation(changed, newer), /Review both/);
    assert.throws(() => correctThreadMutation(changed, changed), /Review both/);
  }
});

test("both thread read operations expose their actual response and guard the timestamp on both pins", () => {
  for (const [suffix, model] of [
    ["/read", "StatusOK"],
    ["/{thread_id}/read/{timestamp}", "UserThread"],
  ]) {
    const path = threadListPath + suffix;
    const key = [path, "put"];
    assert.equal(
      at(contract, [
        "paths",
        ...key,
        "responses",
        "200",
        "content",
        "application/json",
        "schema",
        "$ref",
      ]),
      `#/components/schemas/${model}`,
    );
    const source = object(at(read("users.yaml"), key), path);
    const newer = object(at(read("users-12.1.0.yaml"), key), path);
    const changed = {
      ...source,
      responses: { "200": { description: "upstream changed" } },
    };
    assert.throws(() => correctThreadMutation(changed, newer), /Review both/);
    assert.throws(() => correctThreadMutation(source, changed), /Review both/);
    assert.throws(() => correctThreadMutation(changed, changed), /Review both/);
    if (model === "UserThread") {
      const params = at(contract, ["paths", ...key, "parameters"]);
      assert.ok(Array.isArray(params) && Array.isArray(source.parameters));
      assert.deepEqual(params.find((p) => p.name === "timestamp")?.schema, {
        type: "integer",
        format: "int64",
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      });
      const newTimestamp = {
        ...source,
        parameters: source.parameters.map((p) =>
          p.name === "timestamp" ? { ...p, schema: { type: "integer" } } : p,
        ),
      };
      assert.throws(
        () => correctThreadMutation(source, newTimestamp),
        /Review both/,
      );
      assert.throws(
        () => correctThreadMutation(newTimestamp, newer),
        /Review both/,
      );
      assert.throws(
        () => correctThreadMutation(newTimestamp, newTimestamp),
        /timestamp/,
      );
    }
  }
});

test("one channel uses the same path, parameter and Channel response in both versions", () => {
  const path = "/api/v4/channels/{channel_id}";
  for (const file of ["channels.yaml", "channels-12.1.0.yaml"]) {
    const operation = object(at(read(file), [path, "get"]), path);
    assert.equal(operation.operationId, "GetChannel");
    assert.ok(Array.isArray(operation.parameters));
    assert.deepEqual(
      operation.parameters.map((item) => {
        const parameter = object(item, "channel id");
        return [parameter.in, parameter.name, parameter.required];
      }),
      [["path", "channel_id", true]],
    );
    assert.equal(
      at(operation, [
        "responses",
        "200",
        "content",
        "application/json",
        "schema",
        "$ref",
      ]),
      "#/components/schemas/Channel",
    );
  }
});

test("retains the catalog operations, security and transitive models", () => {
  for (const { file, path, method } of catalog) {
    const key = [path, method.toLowerCase()];
    const actual = structuredClone(
      object(at(contract, ["paths", ...key]), path),
    );
    if (path === history) {
      const reference = at(read("posts-12.1.0.yaml"), [...key, "parameters"]);
      assert.ok(Array.isArray(reference) && Array.isArray(actual.parameters));
      const extra = actual.parameters.splice(-3);
      assert.deepEqual(
        extra.map((p) => p.name),
        threadFlags,
      );
      assert.deepEqual(
        extra,
        reference.filter((p) => threadFlags.includes(p.name)),
      );
    }
    const source = object(at(read(file), key), path);
    let expected = source;
    if (
      source.operationId === "UpdateThreadReadForUser" ||
      source.operationId === "UpdateThreadsReadForUser" ||
      source.operationId === "StartFollowingThread" ||
      source.operationId === "StopFollowingThread"
    )
      expected = correctThreadMutation(
        source,
        object(at(read("users-12.1.0.yaml"), key), path),
      );
    if (source.operationId === "GetUserThreads")
      expected = correctThreadListQuery(
        source,
        object(at(read("users-12.1.0.yaml"), key), path),
      );
    if (source.operationId === "GetFlaggedPostsForUser")
      expected = correctFlaggedPosts(source, read("posts-12.1.0.yaml"));
    if (source.operationId === "GetPost")
      expected = correctSinglePost(
        source,
        read("posts-12.1.0.yaml"),
        read("definitions.yaml"),
      );
    if (source.operationId === "SearchFiles")
      expected = correctFileSearch(path, source, read("files-12.1.0.yaml"));
    if (source.operationId === "AddTeamMember")
      expected = correctTeamMemberRequest(source, read("teams-12.1.0.yaml"));
    if (source.operationId === "AddChannelMember")
      expected = singleChannelMember(source, read("channels-12.1.0.yaml"));
    if (source.operationId === "SaveReaction")
      expected = correctSaveReaction(source, read("reactions-12.1.0.yaml"));
    if (path === "/api/v4/posts" && method === "POST")
      expected = correctCreatePost(source, read("posts-12.1.0.yaml"));
    if (path === "/api/v4/posts/{post_id}/patch")
      expected = correctPatchPost(source, read("posts-12.1.0.yaml"));
    if (
      source.operationId === "ListAutocompleteCommands" ||
      source.operationId === "ListCommandAutocompleteSuggestions"
    )
      expected = correctAutocomplete(
        source,
        read("commands-12.1.0.yaml"),
        path,
      );
    if (source.operationId === "ExecuteCommand")
      expected = correctExecuteCommand(source, read("commands-12.1.0.yaml"));
    if (
      source.operationId === "GetFileInfosForPost" ||
      source.operationId === "GetReactions" ||
      source.operationId === "GetRolesByNames" ||
      source.operationId === "GetPreferences" ||
      source.operationId === "GetChannelMembersTimezones"
    )
      expected = correctNullableList(
        source.operationId,
        source,
        read(file.replace(".yaml", "-12.1.0.yaml")),
      );
    if (source.operationId === "GetChannelMemberCountsByGroup")
      expected = correctGroupAudienceResponse(
        source,
        read("channels-12.1.0.yaml"),
      );
    if (source.operationId === "GetChannelStats")
      expected = correctChannelStatsQuery(source, read("channels-12.1.0.yaml"));
    if (source.operationId === "ViewChannel")
      expected = correctChannelView(source, read("channels-12.1.0.yaml"), path);
    if (source.operationId === "MarkChannelsReadForUser")
      expected = correctBulkChannelView(source, read("channels.yaml"), path);
    if (source.operationId === "SetPostUnread")
      expected = correctSetPostUnread(source, read("posts-12.1.0.yaml"), path);
    if (source.operationId === "GetSidebarCategoriesForTeamForUser")
      expected = correctSidebarResponse(source);
    const id = String(source.operationId);
    if (sidebarWriteCorrections.has(id))
      expected = correctSidebarWrite(
        id,
        source,
        object(at(read("channels-12.1.0.yaml"), key), id),
      );
    if (
      source.operationId === "GetGroupsByTeam" ||
      source.operationId === "GetGroupsAssociatedToChannelsByTeam"
    )
      expected = correctGroupAssociations(
        source.operationId,
        path,
        source,
        read("groups-12.1.0.yaml"),
      );
    if (path === profileImage) expected = correctProfileImage(source);
    assert.deepEqual(actual, expected);
  }
  for (const path of definitionPaths) {
    const source = at(definitions, path);
    const name = path[2];
    let expected = source;
    if (name === "FileInfo")
      expected = correctFileModel(
        name,
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "ChannelUnreadAt")
      expected = correctUnreadAt(
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "Timezone")
      expected = correctProfileTimezone(
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "ChannelNotifyProps" || name === "UserNotifyProps")
      expected = correctNotificationProps(
        name,
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "ChannelMemberCountByGroup")
      expected = correctGroupAudienceModel(
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "GroupWithSchemeAdmin")
      expected = correctAssociatedGroup(
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "Group")
      expected = correctMentionGroup(
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "Emoji")
      expected = correctCustomEmoji(
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "Reaction")
      expected = correctReaction(
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "ChannelStats")
      expected = correctChannelStats(
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "CommandResponse")
      expected = correctCommandResponse(
        object(source, name),
        read("definitions-12.1.0.yaml"),
      );
    if (name === "UserThread" || name === "UserThreads")
      expected = correctThreadListModel(
        name,
        object(source, name),
        object(at(read("definitions-12.1.0.yaml"), path), name),
      );
    if (name === "User") expected = correctUserProfile(object(source, name));
    if (["Channel", "ChannelMember", "TeamMember"].includes(name))
      expected = correctSidebarSchema(name, object(source, name));
    if (name === "Channel" || name === "Team")
      expected = correctDirectoryFlags(
        name,
        object(expected, name),
        read("definitions-12.1.0.yaml"),
      );
    assert.deepEqual(at(contract, path), expected);
  }
  assert.deepEqual(
    Object.keys(object(contract.paths, "paths")).sort(),
    [...new Set(catalog.map(({ path }) => path))].sort(),
  );
  assert.deepEqual(
    Object.keys(
      object(at(contract, ["components", "schemas"]), "schemas"),
    ).sort(),
    [
      "AppError",
      "AutocompleteCommand",
      "AutocompleteSuggestion",
      "Channel",
      "ChannelMember",
      "ChannelMemberCountByGroup",
      "ChannelNotifyProps",
      "ChannelStats",
      "ChannelUnreadAt",
      "CommandResponse",
      "Emoji",
      "FileInfo",
      "FileInfoList",
      "Group",
      "GroupWithSchemeAdmin",
      "GroupsAssociatedToChannels",
      "OrderedSidebarCategories",
      "Post",
      "PostAcknowledgement",
      "PostInfo",
      "PostList",
      "PostListWithSearchMatches",
      "PostMetadata",
      "Preference",
      "Reaction",
      "Role",
      "SidebarCategoryWithChannels",
      "StatusOK",
      "SystemStatusResponse",
      "Team",
      "TeamMember",
      "Timezone",
      "User",
      "UserNotifyProps",
      "UserThread",
      "UserThreads",
    ],
  );
});

test("both image operations carry an undocumented PNG body and preserve error responses", () => {
  for (const spec of [users, read("users-12.1.0.yaml")]) {
    const operation = object(at(spec, [profileImage, "get"]), profileImage);
    const original = structuredClone(operation);
    const corrected = correctProfileImage(operation);
    const responses = object(original.responses, "responses");
    assert.deepEqual(corrected, {
      ...original,
      responses: {
        ...responses,
        "200": {
          ...object(responses["200"], "success"),
          content: {
            "image/png": { schema: { type: "string", format: "binary" } },
          },
        },
      },
    });
    assert.deepEqual(operation, original);
    assert.throws(
      () => correctProfileImage(corrected),
      /Review the profile image/,
    );
  }
});

test("both pinned User definitions omit the same three fields returned by the server", () => {
  const missing = {
    position: { type: "string" },
    is_bot: { type: "boolean" },
    remote_id: { type: "string" },
  };
  for (const version of [definitions, read("definitions-12.1.0.yaml")]) {
    const model = object(
      at(version, ["components", "schemas", "User"]),
      "User",
    );
    const original = structuredClone(model);
    const properties = object(model.properties, "User.properties");
    assert.deepEqual(correctUserProfile(model), {
      ...model,
      properties: { ...properties, ...missing },
    });
    assert.deepEqual(model, original);
    for (const [name, field] of Object.entries(missing)) {
      assert.throws(
        () =>
          correctUserProfile({
            ...model,
            properties: { ...properties, [name]: field },
          }),
        /Review the User profile/,
      );
    }
  }
});

test("category writes detect changed request and response shapes in either pinned version", () => {
  for (const { id, file, path, method } of catalog.filter(({ id }) =>
    sidebarWriteCorrections.has(id),
  )) {
    const key = [path, method.toLowerCase()];
    for (const slot of [0, 1]) {
      for (const half of ["requestBody", "responses"]) {
        const operations = [read(file), read("channels-12.1.0.yaml")].map(
          (doc) => structuredClone(object(at(doc, key), id)),
        );
        const changed = operations[slot];
        const body = {
          content: { "application/json": { schema: { type: "string" } } },
          required: true,
        };
        changed[half] = half === "responses" ? { "200": body } : body;
        assert.throws(
          () => correctSidebarWrite(id, operations[0], operations[1]),
          /Review the pinned sidebar/,
        );
      }
    }
  }
});

test("corrects the sidebar envelope and category fields without changing the upstream objects", () => {
  const operation = object(
    at(read("channels.yaml"), [sidebar, "get"]),
    sidebar,
  );
  const success = ["responses", "200", "content", "application/json"];
  const original = structuredClone(operation);
  const corrected = correctSidebarResponse(operation);
  assert.deepEqual(at(corrected, [...success, "schema"]), {
    $ref: "#/components/schemas/OrderedSidebarCategories",
  });
  assert.deepEqual(operation, original);
  assert.throws(
    () => correctSidebarResponse(corrected),
    /Review the sidebar response/,
  );

  const name = "SidebarCategoryWithChannels";
  const schema = object(at(definitions, ["components", "schemas", name]), name);
  const unchanged = structuredClone(schema);
  const properties = object(schema.properties, name);
  const output = object(
    at(contract, ["components", "schemas", name, "properties"]),
    name,
  );
  assert.deepEqual(output, {
    ...properties,
    type: {
      type: "string",
      enum: ["channels", "custom", "direct_messages", "favorites", "managed"],
    },
    sort_order: { type: "integer", format: "int64" },
    sorting: { type: "string" },
    muted: { type: "boolean" },
    collapsed: { type: "boolean" },
  });
  for (const key of ["sort_order", "sorting", "muted", "collapsed", "type"]) {
    const altered = {
      ...schema,
      properties: { ...properties, [key]: { type: "string" } },
    };
    assert.throws(
      () => correctSidebarCategory(altered),
      /Review the sidebar category/,
    );
  }
  assert.deepEqual(schema, unchanged);
});

test("imports only the reviewed edit history operation and detects drift on either release", () => {
  const path = "/api/v4/posts/{post_id}/edit_history";
  const source = object(read("posts-12.1.0.yaml")[path], path);
  const operation = object(source.get, path);
  const baseline = read("posts.yaml");
  checkEditHistoryOperation(baseline, path, source);
  assert.deepEqual(at(contract, ["paths", path, "get"]), operation);
  assert.throws(
    () =>
      checkEditHistoryOperation({ ...baseline, [path]: source }, path, source),
    /Review/,
  );
  for (const schema of [
    { $ref: "#/components/schemas/PostList" },
    { type: "array", items: { $ref: "#/components/schemas/PostList" } },
  ]) {
    const changed = structuredClone(source);
    object(
      at(changed, ["get", "responses", "200", "content", "application/json"]),
      "media",
    ).schema = schema;
    assert.throws(
      () => checkEditHistoryOperation(baseline, path, changed),
      /Review/,
    );
  }
  for (const changed of [
    { ...source, get: { ...operation, security: [] } },
    { ...source, parameters: [{ name: "page", in: "query" }] },
    {
      ...source,
      get: {
        ...operation,
        parameters: [
          {
            name: "post_id",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
      },
    },
  ])
    assert.throws(
      () => checkEditHistoryOperation(baseline, path, changed),
      /Review/,
    );
});

test("imports precisely the missing post info contract and stops on drift", () => {
  const path = "/api/v4/posts/{post_id}/info";
  const op = object(at(read("posts-12.1.0.yaml"), [path, "get"]), path);
  const reference = read("definitions-12.1.0.yaml");
  const modelPath = ["components", "schemas", "PostInfo"];
  assert.deepEqual(at(contract, modelPath), at(reference, modelPath));
  assert.throws(
    () => checkPostInfoOperation({ [path]: {} }, path, op),
    /Review/,
  );
  const wrong = structuredClone(op);
  object(
    at(wrong, ["responses", "200", "content", "application/json"]),
    "JSON",
  ).schema = { type: "string" };
  assert.throws(() => checkPostInfoOperation({}, path, wrong), /Review/);
  assert.throws(() => postInfoSchema({ PostInfo: {} }, reference), /Review/);
  const changed = structuredClone(reference);
  object(
    at(changed, [...modelPath, "properties", "has_joined_channel"]),
    "field",
  ).type = "string";
  assert.throws(() => postInfoSchema({}, changed), /Review/);
});

test("builds identical JSON from the pinned sources", () => {
  assert.equal(
    `${JSON.stringify(buildSpecification(read), null, 2)}\n`,
    serialized,
  );
});

test("changes only the confirmed history fields in the selected models", () => {
  const additions = {
    Post: [
      "is_pinned",
      "message_source",
      "reply_count",
      "last_reply_at",
      "participants",
      "is_following",
    ],
    PostList: ["first_inaccessible_post_time"],
    PostMetadata: ["images", "redacted_file_count"],
  };
  for (const [name, fields] of Object.entries(additions)) {
    const path = ["components", "schemas", name];
    const original = at(definitions, path);
    const baseline = object(at(original, ["properties"]), name);
    const selected = structuredClone(at(contract, path));
    const properties = object(at(selected, ["properties"]), name);
    if (name === "Post") {
      assert.equal(Object.hasOwn(properties, "hashtag"), false);
      assert.deepEqual(properties.hashtags, baseline.hashtag);
      properties.hashtag = properties.hashtags;
      delete properties.hashtags;
    }
    for (const field of fields) {
      assert.ok(Object.hasOwn(properties, field), field);
      if (Object.hasOwn(baseline, field)) {
        assert.notDeepEqual(properties[field], baseline[field]);
        properties[field] = baseline[field];
      } else delete properties[field];
    }
    assert.deepEqual(selected, original);
  }
});

test("history alone includes participant models and preserves reusable source objects", () => {
  const sources = new Map<string, Record<string, unknown>>();
  const cached = (file: string) => {
    const value = sources.get(file) ?? read(file);
    sources.set(file, value);
    return value;
  };
  const untouched = ["definitions.yaml", "posts.yaml", "posts-12.1.0.yaml"].map(
    (file) => [file, structuredClone(cached(file))] as const,
  );
  const ops = catalog.filter((op) => op.id === "GetPostsForChannel");
  const result = buildSpecification(cached, ops);
  assert.ok(Object.hasOwn(result.components.schemas, "User"));
  assert.deepEqual(buildSpecification(cached, ops), result);
  for (const [file, original] of untouched)
    assert.deepEqual(cached(file), original);
});

test("a correction stops when either pinned history contract changes", () => {
  const baseline = object(at(read("posts.yaml"), [history, "get"]), history);
  const reference = read("posts-12.1.0.yaml");
  const baseParams = baseline.parameters;
  assert.ok(Array.isArray(baseParams));
  for (const flag of threadFlags) {
    assert.throws(
      () =>
        correctHistoryQuery(
          {
            ...baseline,
            parameters: [...baseParams, { name: flag, in: "query" }],
          },
          reference,
          history,
        ),
      /Review/,
    );
    const altered = structuredClone(reference);
    const operation = object(at(altered, [history, "get"]), history);
    assert.ok(Array.isArray(operation.parameters));
    const param = operation.parameters.find((p) => p.name === flag);
    param.schema.type = "string";
    assert.throws(
      () => correctHistoryQuery(baseline, altered, history),
      /Review/,
    );
    operation.parameters = operation.parameters.filter((p) => p.name !== flag);
    assert.throws(
      () => correctHistoryQuery(baseline, altered, history),
      /Review/,
    );
  }
  for (const [name, field] of [
    ["Post", "is_following"],
    ["PostList", "first_inaccessible_post_time"],
  ]) {
    const schema = structuredClone(
      object(at(definitions, ["components", "schemas", name]), name),
    );
    object(schema.properties, name)[field] = { type: "string" };
    assert.throws(() => correctHistorySchema(name, schema), /Review/);
  }
  const metadata = structuredClone(
    object(
      at(definitions, ["components", "schemas", "PostMetadata"]),
      "metadata",
    ),
  );
  const images = object(at(metadata, ["properties", "images"]), "images");
  images.additionalProperties = images.items;
  assert.throws(() => correctHistorySchema("PostMetadata", metadata), /Review/);
});

test("applies the optional attachment count only while both pinned definitions omit it", () => {
  const newer = read("definitions-12.1.0.yaml");
  const baseline = object(
    at(definitions, ["components", "schemas", "PostMetadata"]),
    "PostMetadata",
  );
  const latest = object(
    at(newer, ["components", "schemas", "PostMetadata"]),
    "PostMetadata",
  );
  const added = { type: "integer", format: "int64", minimum: 0 };
  const original = structuredClone(baseline);
  assert.deepEqual(correctRedactedFileCount(baseline, newer), {
    ...baseline,
    properties: {
      ...object(baseline.properties, "properties"),
      redacted_file_count: added,
    },
  });
  assert.deepEqual(baseline, original);
  for (const replacement of [
    { redacted_file_count: added },
    { files: { type: "array", items: { type: "string" } } },
  ]) {
    const changed = (schema: Fields) => ({
      ...schema,
      properties: {
        ...object(schema.properties, "properties"),
        ...replacement,
      },
    });
    assert.throws(
      () => correctRedactedFileCount(changed(baseline), newer),
      /Review the PostMetadata attachment count/,
    );
    assert.throws(
      () =>
        correctRedactedFileCount(baseline, {
          components: { schemas: { PostMetadata: changed(latest) } },
        }),
      /Review the PostMetadata attachment count/,
    );
  }
});

const removals = [
  ...catalog.map(({ file, path, method }) => ({
    file,
    path: [path, method.toLowerCase()],
    error: `Expected OpenAPI object ${method.toLowerCase()} ${path}`,
  })),
  ...[
    ...definitionPaths,
    ...["Post", "PostList", "PostMetadata"].map((name) => [
      "components",
      "schemas",
      name,
    ]),
  ].map((path) => ({
    file: "definitions.yaml",
    path,
    error:
      path[0] === "security"
        ? "Expected OpenAPI security requirements"
        : `Missing component ${path.slice(1).join("/")}`,
  })),
];
const builder = fileURLToPath(new URL("./schema.ts", import.meta.url));
test("rejects reaction write contract drift in either upstream release", () => {
  for (const file of ["reactions.yaml", "reactions-12.1.0.yaml"]) {
    function change(
      path: string[],
      key: string,
      value: unknown,
      error: RegExp,
    ) {
      const altered = structuredClone(read(file));
      object(at(altered, path), key)[key] = value;
      assert.throws(
        () =>
          buildSpecification((name) => (name === file ? altered : read(name))),
        error,
      );
    }
    change(
      [
        "/api/v4/reactions",
        "post",
        "requestBody",
        "content",
        "application/json",
      ],
      "schema",
      { type: "object" },
      /Review SaveReaction/,
    );
    change(
      ["/api/v4/reactions", "post", "responses"],
      "200",
      { description: "Added upstream" },
      /Review SaveReaction/,
    );
    change(
      [
        "/api/v4/users/{user_id}/posts/{post_id}/reactions/{emoji_name}",
        "delete",
      ],
      "parameters",
      [],
      /Missing path parameter/,
    );
  }
});
test("detects reaction model and list changes in either pinned source", () => {
  for (const file of ["definitions.yaml", "definitions-12.1.0.yaml"]) {
    const altered = structuredClone(read(file));
    object(
      at(altered, ["components", "schemas", "Reaction", "properties"]),
      "Reaction",
    ).update_at = { type: "integer", format: "int64" };
    assert.throws(
      () =>
        buildSpecification((name) => (name === file ? altered : read(name))),
      /Review Reaction/,
    );
  }
  for (const file of ["reactions.yaml", "reactions-12.1.0.yaml"]) {
    const changedPath = structuredClone(read(file));
    object(
      at(changedPath, ["/api/v4/posts/{post_id}/reactions", "get"]),
      "get",
    ).parameters = [];
    assert.throws(
      () =>
        buildSpecification((name) =>
          name === file ? changedPath : read(name),
        ),
      /Missing path parameter/,
    );
    const altered = structuredClone(read(file));
    object(
      at(altered, [
        "/api/v4/posts/{post_id}/reactions",
        "get",
        "responses",
        "200",
        "content",
        "application/json",
        "schema",
      ]),
      "reaction list",
    ).items = { type: "string" };
    assert.throws(
      () =>
        buildSpecification((name) => (name === file ? altered : read(name))),
      /Review the nullable GetReactions/,
    );
  }
});
const sourceDirectory = resolve(sources);
const fixturePrefix = join(work, "incomplete-");
function copySources() {
  const fixture = mkdtempSync(fixturePrefix);
  for (const name of new Set([
    "introduction.yaml",
    "definitions.yaml",
    "definitions-12.1.0.yaml",
    "roles-12.1.0.yaml",
    "teams-12.1.0.yaml",
    "users-12.1.0.yaml",
    "files-12.1.0.yaml",
    "groups-12.1.0.yaml",
    "preferences-12.1.0.yaml",
    "commands-12.1.0.yaml",
    "posts-12.1.0.yaml",
    "reactions-12.1.0.yaml",
    ...catalog.map(({ file }) => file),
  ])) {
    copyFileSync(join(sourceDirectory, name), join(fixture, name));
  }
  return fixture;
}

test("preserves the verified artifact if a corrected Post field drifts", () => {
  for (const change of [
    "missing hashtag",
    "new type",
    "hashtags exists",
    "is_pinned exists",
    "message_source exists",
    "hashtag required",
  ]) {
    const fixture = copySources();
    const altered = readSource(fixture, "definitions.yaml");
    const schema = object(
      at(altered, ["components", "schemas", "Post"]),
      "Post",
    );
    const fields = object(schema.properties, "Post properties");
    switch (change) {
      case "missing hashtag":
        delete fields.hashtag;
        break;
      case "new type":
        fields.hashtag = { type: "integer" };
        break;
      case "hashtags exists":
        fields.hashtags = { type: "string" };
        break;
      case "is_pinned exists":
        fields.is_pinned = { type: "boolean" };
        break;
      case "message_source exists":
        fields.message_source = { type: "string" };
        break;
      case "hashtag required":
        schema.required = ["hashtag"];
        break;
    }
    writeFileSync(join(fixture, "definitions.yaml"), stringify(altered));
    const output = join(fixture, "openapi.json");
    writeFileSync(output, serialized);
    const result = spawnSync(process.execPath, [builder, fixture, output], {
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, change);
    assert.match(result.stderr, /Review the Post/);
    assert.equal(readFileSync(output, "utf8"), serialized);
  }
});

for (const { file, path, error } of removals) {
  test(`the builder rejects ${file} without ${path.join(" > ")}`, () => {
    const fixture = copySources();
    const altered = readSource(fixture, file);
    const parent = object(at(altered, path.slice(0, -1)), "parent");
    delete parent[path[path.length - 1]];
    writeFileSync(join(fixture, file), stringify(altered));

    const output = join(fixture, "openapi.json");
    const result = spawnSync(process.execPath, [builder, fixture, output], {
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(error), result.stderr);
    assert.equal(existsSync(output), false);
  });
}

test("rejects a changed operation ID", () => {
  const altered = structuredClone(system);
  object(at(altered, [ping, "get"]), "operation").operationId = "OtherPing";
  assert.throws(
    () =>
      buildSpecification((file) =>
        file === "system.yaml" ? altered : read(file),
      ),
    /Expected operation GetPing/,
  );
});

const bulkPath = "/api/v4/users/ids";
const bulkOperation = object(at(users, [bulkPath, "post"]), "GetUsersByIds");
const bulkBody = object(bulkOperation.requestBody, "requestBody");
test("keeps the required string-array input and optional since filter", () => {
  const operation = at(contract, ["paths", bulkPath, "post"]);
  assert.deepEqual(
    at(operation, ["requestBody", "content", "application/json", "schema"]),
    {
      type: "array",
      items: { type: "string" },
    },
  );
  const parameters = at(operation, ["parameters"]);
  assert.ok(Array.isArray(parameters));
  assert.equal(parameters.length, 1);
  const since = object(parameters[0], "since");
  assert.equal(since.name, "since");
  assert.equal(since.in, "query");
  assert.notEqual(since.required, true);
  assert.equal(at(since, ["schema", "type"]), "integer");
});

test("requires the catalog body and its single JSON media type", () => {
  for (const body of [
    undefined,
    { ...bulkBody, required: false },
    { ...bulkBody, content: { "text/plain": {} } },
    {
      ...bulkBody,
      content: { ...object(bulkBody.content, "content"), "text/plain": {} },
    },
    { ...bulkBody, content: { "application/json": {} } },
  ]) {
    const source = {
      ...users,
      [bulkPath]: { post: { ...bulkOperation, requestBody: body } },
    };
    assert.throws(
      () =>
        buildSpecification((file) =>
          file === "users.yaml" ? source : read(file),
        ),
      /body/i,
    );
  }
  const changed = catalog.map((op) =>
    op.id === "GetUsersByIds" ? { ...op, body: undefined } : op,
  );
  assert.throws(
    () => buildSpecification(read, changed),
    /Unexpected request body/,
  );
  assert.throws(
    () => buildSpecification(read, [{ ...catalog[0], body: "file" }]),
    /Unsupported catalog body/,
  );
});

function buildUserRoute(pathItem: Record<string, unknown>, path = userRoute) {
  const source = { ...users, [path]: pathItem };
  return buildSpecification(
    (file) => (file === "users.yaml" ? source : read(file)),
    [{ file: "users.yaml", path, method: "GET", id: "GetUser" }],
  );
}

const getUser = object(at(users, [userRoute, "get"]), "GetUser");
const parameter = {
  in: "path",
  name: "user_id",
  required: true,
  schema: { type: "string" },
};
test("requires the declared user ID parameter and its supported whole-segment template", () => {
  for (const candidate of [
    [],
    [{ ...parameter, in: "query" }],
    [{ ...parameter, name: "other" }],
    [{ ...parameter, required: false }],
    [{ ...parameter, schema: { type: "integer" } }],
    [parameter, { ...parameter, name: "other" }],
    [parameter, parameter],
  ]) {
    assert.throws(
      () => buildUserRoute({ get: { ...getUser, parameters: candidate } }),
      /path parameter/,
    );
  }
  for (const path of [
    "/api/v4/users/u{user_id}",
    "/api/v4/users/{unknown}",
    "/api/v4/users/{user_id",
  ]) {
    assert.throws(
      () => buildUserRoute({ get: getUser }, path),
      /Unsupported native route template/,
    );
  }
});

test("matches both parameter names on team channel reads", () => {
  const path = "/api/v4/users/{user_id}/teams/{team_id}/channels";
  const channels = read("channels.yaml");
  const operation = object(
    at(channels, [path, "get"]),
    "GetChannelsForTeamForUser",
  );
  const teamId = { ...parameter, name: "team_id" };
  for (const parameters of [
    [parameter],
    [teamId],
    [parameter, { ...teamId, in: "query" }],
    [parameter, { ...teamId, name: "channel_id" }],
  ]) {
    const altered = {
      ...channels,
      [path]: { get: { ...operation, parameters } },
    };
    assert.throws(
      () =>
        buildSpecification((file) =>
          file === "channels.yaml" ? altered : read(file),
        ),
      /path parameter/,
    );
  }
});

test("an operation overrides only a matching parameter from its path", () => {
  const wrong = { ...parameter, required: false };
  assert.doesNotThrow(() =>
    buildUserRoute({
      parameters: [parameter],
      get: { ...getUser, parameters: [] },
    }),
  );
  assert.doesNotThrow(() =>
    buildUserRoute({ parameters: [wrong], get: getUser }),
  );
  assert.throws(
    () =>
      buildUserRoute({
        parameters: [parameter],
        get: { ...getUser, parameters: [wrong] },
      }),
    /required string path parameter/,
  );
  assert.throws(
    () =>
      buildUserRoute({
        parameters: [wrong],
        get: { ...getUser, parameters: [{ ...parameter, in: "query" }] },
      }),
    /required string path parameter/,
  );
});

test("uses referenced parameters and schemas without broadening the path", () => {
  const defs = structuredClone(definitions);
  const groups = object(defs.components, "components");
  groups.parameters = {
    userId: { ...parameter, schema: { $ref: "#/components/schemas/RouteId" } },
  };
  object(groups.schemas, "schemas").RouteId = { type: "string" };
  const reference = { $ref: "#/components/parameters/userId" };
  const source = {
    ...users,
    [userRoute]: {
      parameters: [reference],
      get: { ...getUser, parameters: [] },
    },
  };
  const build = () =>
    buildSpecification((file) =>
      file === "definitions.yaml"
        ? defs
        : file === "users.yaml"
          ? source
          : read(file),
    );
  assert.doesNotThrow(build);
  object(groups.schemas, "schemas").RouteId = { type: "integer" };
  assert.throws(build, /required string path parameter/);
  groups.parameters = { userId: reference };
  assert.throws(build, /Invalid OpenAPI parameters reference/);
});

test("rejects a changed GetUser operation ID", () => {
  assert.throws(
    () => buildUserRoute({ get: { ...getUser, operationId: "DifferentUser" } }),
    /Expected operation GetUser/,
  );
});

test("requires the HTTP verb in its wire spelling", () => {
  assert.throws(
    () => buildSpecification(read, [{ ...catalog[0], method: "get" }]),
    {
      message: "Invalid HTTP method in the operation catalog: get",
    },
  );
});

// Load the emitted ESM from this build, after the generated client has passed strict tsc.
const {
  Configuration,
  SystemApi,
  FilesApi,
  FileInfoListToJSON,
  PostsApi,
  PostFromJSON,
  PostToJSON,
  PostListWithSearchMatchesFromJSON,
  PostListWithSearchMatchesToJSON,
  PostListFromJSON,
  GetGroupsAssociatedToChannelsByTeam200ResponseFromJSON,
  GetGroupsAssociatedToChannelsByTeam200ResponseToJSON,
  ChannelFromJSON,
  ChannelToJSON,
  ChannelMemberFromJSON,
  ChannelMemberToJSON,
  TeamFromJSON,
  TeamToJSON,
  TeamMemberFromJSON,
  TeamMemberToJSON,
} = await import(pathToFileURL(resolve(work, "compiled/index.js")).href);
test("channel group maps convert every group in both directions", () => {
  const one = {
    id: "g".repeat(26),
    name: "release",
    display_name: "Release",
    remote_id: null,
    allow_reference: true,
  };
  const wire = {
    groups: {
      first: [{ ...one, scheme_admin: false }],
      second: [{ ...one, scheme_admin: true }, one],
      empty: [],
    },
  };
  const result = GetGroupsAssociatedToChannelsByTeam200ResponseFromJSON(wire);
  assert.equal(result.groups.first[0].allowReference, true);
  assert.equal(result.groups.first[0].schemeAdmin, false);
  assert.equal(result.groups.second[0].schemeAdmin, true);
  assert.equal(result.groups.second[1].schemeAdmin, undefined);
  assert.equal(result.groups.second[1].remoteId, null);
  assert.deepEqual(result.groups.empty, []);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        GetGroupsAssociatedToChannelsByTeam200ResponseToJSON(result),
      ),
    ),
    wire,
  );
});
const channelRoleFields = {
  scheme_guest: { type: "boolean" },
  scheme_user: { type: "boolean" },
  scheme_admin: { type: "boolean" },
  explicit_roles: { type: "string" },
};
test("both group-constraint flags preserve all wire states and stop on upstream drift", () => {
  for (const [name, from, to] of [
    ["Team", TeamFromJSON, TeamToJSON],
    ["Channel", ChannelFromJSON, ChannelToJSON],
  ] as const) {
    const path = ["components", "schemas", name];
    assert.deepEqual(
      at(contract, [...path, "properties", "group_constrained"]),
      { type: "boolean", nullable: true },
    );
    for (const flag of [true, false, null, undefined]) {
      const wire =
        flag === undefined
          ? { id: "sample" }
          : { id: "sample", group_constrained: flag };
      const dto = from(wire);
      assert.equal(dto.groupConstrained, flag);
      assert.deepEqual(JSON.parse(JSON.stringify(to(dto))), wire);
    }
    for (const version of ["10", "12"]) {
      const original = structuredClone(object(at(definitions, path), name));
      const newer = structuredClone(read("definitions-12.1.0.yaml"));
      const altered =
        version === "10" ? original : object(at(newer, path), name);
      object(altered.properties, name).group_constrained = { type: "boolean" };
      assert.throws(
        () => correctDirectoryFlags(name, original, newer),
        /group_constrained/,
      );
    }
  }
});

test("models the shared channel flag and detects its addition to either pinned source", () => {
  const path = ["components", "schemas", "Channel"];
  assert.deepEqual(at(contract, [...path, "properties", "shared"]), {
    type: "boolean",
    nullable: true,
  });
  const model = object(at(definitions, path), "Channel");
  const newer = read("definitions-12.1.0.yaml");
  const changed = (schema: Record<string, unknown>) => ({
    ...schema,
    properties: {
      ...object(schema.properties, "channel properties"),
      shared: { type: "boolean" },
    },
  });
  assert.throws(
    () => correctDirectoryFlags("Channel", changed(model), newer),
    /Review the Channel.shared correction/,
  );
  assert.throws(
    () =>
      correctDirectoryFlags("Channel", model, {
        components: {
          schemas: {
            Channel: changed(object(at(newer, path), "newer Channel")),
          },
        },
      }),
    /Review the Channel.shared correction/,
  );
  for (const flag of [true, false]) {
    const channel = ChannelFromJSON({ id: "sample", shared: flag });
    assert.equal(channel.shared, flag);
    assert.equal(ChannelToJSON(channel).shared, flag);
  }
  for (const wire of [{ shared: null }, {}])
    assert.ok(ChannelFromJSON(wire).shared == null);
});

test("root-only and urgent counts survive generation, including zero and absent values", () => {
  for (const { name, keys, decode, encode } of [
    {
      name: "Channel",
      keys: ["last_root_post_at", "total_msg_count_root"],
      decode: ChannelFromJSON,
      encode: ChannelToJSON,
    },
    {
      name: "ChannelMember",
      keys: ["mention_count_root", "msg_count_root", "urgent_mention_count"],
      decode: ChannelMemberFromJSON,
      encode: ChannelMemberToJSON,
    },
  ]) {
    const schema = object(
      at(definitions, ["components", "schemas", name]),
      name,
    );
    const original = structuredClone(schema);
    const properties = object(schema.properties, name);
    const published = object(
      at(contract, ["components", "schemas", name, "properties"]),
      name,
    );
    const additions = Object.fromEntries(
      keys.map((key) => [key, { type: "integer", format: "int64" }]),
    );
    assert.deepEqual(published, {
      ...properties,
      ...additions,
      ...(name === "Channel"
        ? {
            shared: { type: "boolean", nullable: true },
            group_constrained: { type: "boolean", nullable: true },
          }
        : channelRoleFields),
    });
    for (const key of keys) {
      assert.throws(
        () =>
          correctSidebarSchema(name, {
            ...schema,
            properties: { ...properties, [key]: additions[key] },
          }),
        /Review the .* sidebar counter/,
      );
    }
    for (const value of [undefined, 0, 27]) {
      const wire =
        value === undefined
          ? {}
          : Object.fromEntries(
              keys.map((key, index) => [key, value && value + index]),
            );
      assert.deepEqual(JSON.parse(JSON.stringify(encode(decode(wire)))), wire);
    }
    assert.deepEqual(schema, original);
  }
});
test("keeps scheme roles separate from explicit membership roles and detects upstream additions", () => {
  for (const [name, decode, encode] of [
    ["TeamMember", TeamMemberFromJSON, TeamMemberToJSON],
    ["ChannelMember", ChannelMemberFromJSON, ChannelMemberToJSON],
  ] as const) {
    const base = object(at(definitions, ["components", "schemas", name]), name);
    const properties = object(base.properties, name);
    const extra =
      name === "TeamMember"
        ? { scheme_guest: channelRoleFields.scheme_guest }
        : channelRoleFields;
    for (const [key, value] of Object.entries(extra)) {
      assert.throws(
        () =>
          correctSidebarSchema(name, {
            ...base,
            properties: { ...properties, [key]: value },
          }),
        /Review the .* membership roles/,
      );
    }
    for (const wire of [
      {},
      {
        roles: "member_guest custom_role",
        scheme_guest: true,
        scheme_user: false,
        scheme_admin: false,
        explicit_roles: "custom_role",
      },
      {
        roles: "member_user member_admin",
        scheme_guest: false,
        scheme_user: true,
        scheme_admin: true,
        explicit_roles: "",
      },
    ])
      assert.deepEqual(JSON.parse(JSON.stringify(encode(decode(wire)))), wire);
  }
});
test("round trips the attachment count independently of available files", () => {
  for (const count of [undefined, 0, 2]) {
    const metadata = count === undefined ? {} : { redacted_file_count: count };
    const wire = { id: "p".repeat(26), file_ids: [], metadata };
    const parsed = PostFromJSON(wire);
    assert.equal(parsed.metadata.redactedFileCount, count);
    assert.deepEqual(JSON.parse(JSON.stringify(PostToJSON(parsed))), wire);
  }
  const file = "f".repeat(26);
  const visible = {
    file_ids: [file],
    metadata: { files: [{ id: file, name: "notes.txt" }] },
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(PostToJSON(PostFromJSON(visible)))),
    visible,
  );
});

test("the generated reader preserves a nonzero history boundary and thread values", () => {
  const page = PostListFromJSON({
    order: ["root"],
    posts: {
      root: {
        reply_count: 0,
        last_reply_at: 0,
        participants: null,
        is_following: false,
      },
    },
    first_inaccessible_post_time: 1700000000123,
  });
  assert.equal(page.firstInaccessiblePostTime, 1700000000123);
  assert.equal(page.posts.root.replyCount, 0);
  assert.equal(page.posts.root.lastReplyAt, 0);
  assert.equal(page.posts.root.isFollowing, false);
  assert.ok(page.posts.root.participants == null);
  assert.equal(
    PostListFromJSON({ order: [], posts: {} }).firstInaccessiblePostTime,
    undefined,
  );
});
for (const base of [
  "https://chat.example.test",
  "https://chat.example.test/departments/chat",
]) {
  for (const status of ["OK", "UNHEALTHY"]) {
    test(`GetPing reads ${status} from ${base} without credentials`, async () => {
      const requests: Request[] = [];
      const fetchApi: typeof fetch = async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(
          status === "OK"
            ? { status }
            : { status, ActiveSearchBackend: "database" },
        );
      };
      const api = new SystemApi(
        new Configuration({ basePath: base, fetchApi }),
      );
      const response = await api.getPing({ useRestSemantics: true });
      assert.equal(response.status, status);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, "GET");
      assert.equal(requests[0].url, `${base}${ping}?use_rest_semantics=true`);
      assert.equal(requests[0].headers.has("Authorization"), false);
    });
  }
}

test("pins exact custom emoji lookup and all six serialized fields on both versions", () => {
  const path = "/api/v4/emoji/name/{emoji_name}";
  const baseline = read("emoji.yaml");
  assert.deepEqual(baseline[path], read("emoji-12.1.0.yaml")[path]);
  const operation = object(at(contract, ["paths", path, "get"]), path);
  assert.deepEqual(Object.keys(object(operation.responses, path)).sort(), [
    "200",
    "400",
    "401",
    "404",
    "501",
  ]);
  assert.deepEqual(
    at(operation, [
      "responses",
      "200",
      "content",
      "application/json",
      "schema",
    ]),
    { $ref: "#/components/schemas/Emoji" },
  );
  const model = ["components", "schemas", "Emoji"];
  assert.deepEqual(at(contract, [...model, "required"]), [
    "id",
    "creator_id",
    "name",
    "create_at",
    "update_at",
    "delete_at",
  ]);
  for (const newer of [false, true]) {
    const old = read("definitions.yaml");
    const next = read("definitions-12.1.0.yaml");
    const props = object(
      at(newer ? next : old, [...model, "properties"]),
      "Emoji",
    );
    delete props.creator_id;
    assert.throws(
      () => correctCustomEmoji(object(at(old, model), "Emoji"), next),
      /Review Emoji/,
    );
  }
});

test("restored contract inputs must match their pins before generation", () => {
  assert.ok(work);
  const directory = mkdtempSync(join(work, "cache-test-"));
  const target = join(directory, "schema.yaml");
  const origin = join(directory, "upstream.yaml");
  const digest = (content: string) =>
    createHash("sha256").update(content).digest("hex");
  const fetchPin = (content: string) =>
    spawnSync(
      "sh",
      [
        fileURLToPath(new URL("./download-verified.sh", import.meta.url)),
        target,
        pathToFileURL(origin).href,
        digest(content),
      ],
      { encoding: "utf8" },
    );
  writeFileSync(target, "first pin");
  assert.equal(fetchPin("first pin").status, 0); // Source is deliberately absent on a cache hit.
  writeFileSync(origin, "new pin");
  assert.equal(fetchPin("new pin").status, 0);
  assert.equal(readFileSync(target, "utf8"), "new pin");
  writeFileSync(origin, "wrong bytes");
  const refused = fetchPin("unavailable pin");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /SHA-256 mismatch/);
  assert.equal(readFileSync(target, "utf8"), "new pin");
  assert.deepEqual(readdirSync(directory).sort(), [
    "schema.yaml",
    "upstream.yaml",
  ]);
});

test("emoji compatibility checks reject changed aliases and duplicate names before replacing the directory", () => {
  assert.ok(work);
  const directory = mkdtempSync(join(work, "emoji-test-"));
  const baseline = join(directory, "baseline.json");
  const other = join(directory, "other.json");
  const target = join(directory, "result.json");
  const standard = {
    short_name: "wave",
    short_names: ["wave"],
    unified: "1F44B",
  };
  const run = () =>
    spawnSync(
      process.execPath,
      ["scripts/contract/standard-emoji.ts", baseline, other, target],
      { encoding: "utf8" },
    );
  writeFileSync(baseline, JSON.stringify([standard]));
  writeFileSync(
    other,
    JSON.stringify([{ ...standard, category: "extra upstream metadata" }]),
  );
  assert.equal(run().status, 0);
  const original = readFileSync(target, "utf8");
  assert.deepEqual(JSON.parse(original).rows, [["👋", "wave"]]);
  for (const changed of [
    [{ ...standard, short_names: ["wave", "greeting"] }],
    [{ ...standard, unified: "ZZZZ" }],
    [standard, standard],
  ]) {
    writeFileSync(other, JSON.stringify(changed));
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(target, "utf8"), original);
  }
});

test("post search preserves filters, scope, server ordering, matches and history boundaries", async () => {
  const postId = "p".repeat(26),
    teamId = "t".repeat(26),
    channelId = "c".repeat(26);
  const params = {
    terms: "from:fixture in:town-square polar",
    isOrSearch: false,
    timeZoneOffset: 10800,
    includeDeletedChannels: true,
    page: 1,
    perPage: 40,
  };
  const raw = {
    order: [postId],
    posts: {
      [postId]: { id: postId, channel_id: channelId, message: "polar sample" },
    },
    matches: { [postId]: ["polar", "sample"] },
    next_post_id: "next",
    prev_post_id: "prev",
    has_next: false,
    first_inaccessible_post_time: 42,
  };
  const paths: string[] = [];
  const api = new PostsApi(
    new Configuration({
      basePath: "https://example.test/mattermost",
      fetchApi: async (url: string, init: RequestInit) => {
        paths.push(new URL(url).pathname);
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(String(init.body)), {
          terms: params.terms,
          is_or_search: false,
          time_zone_offset: 10800,
          include_deleted_channels: true,
          page: 1,
          per_page: 40,
        });
        return Response.json(raw);
      },
    }),
  );
  for (const result of [
    await api.searchPosts({ teamId, searchPostsRequest: params }),
    await api.searchPostsInAllTeams({ searchPostsInAllTeamsRequest: params }),
  ]) {
    assert.deepEqual(result.order, [postId]);
    assert.deepEqual(result.matches[postId], ["polar", "sample"]);
    assert.equal(result.posts[postId].channelId, channelId);
    assert.equal(result.firstInaccessiblePostTime, 42);
    assert.equal(result.hasNext, false);
    assert.equal(result.prevPostId, "prev");
    assert.equal(result.nextPostId, "next");
    assert.deepEqual(
      JSON.parse(JSON.stringify(PostListWithSearchMatchesToJSON(result))),
      raw,
    );
  }
  assert.deepEqual(paths, [
    `/mattermost/api/v4/teams/${teamId}/posts/search`,
    "/mattermost/api/v4/posts/search",
  ]);
  const empty = PostListWithSearchMatchesFromJSON({ ...raw, matches: null });
  assert.equal(empty.matches, null);
  assert.equal(PostListWithSearchMatchesToJSON(empty).matches, null);
});

test("file search uses JSON in both scopes and retains the attachment and its navigation fields", async () => {
  const team = "t".repeat(26),
    channel = "c".repeat(26),
    id = "f".repeat(26);
  const params = {
    terms: "in:town-square ext:pdf polar",
    isOrSearch: true,
    timeZoneOffset: -10800,
    includeDeletedChannels: true,
    page: 2,
    perPage: 20,
  };
  const raw = {
    order: [id],
    file_infos: {
      [id]: {
        id,
        channel_id: channel,
        post_id: "p".repeat(26),
        name: "polar.pdf",
        archived: true,
      },
    },
    next_file_info_id: "next",
    prev_file_info_id: "prev",
    first_inaccessible_file_time: 17,
  };
  const paths: string[] = [];
  const api = new FilesApi(
    new Configuration({
      basePath: "https://example.org/mattermost",
      fetchApi: async (url: string, init: RequestInit) => {
        paths.push(new URL(url).pathname);
        assert.equal(init.method, "POST");
        assert.equal(
          new Headers(init.headers).get("content-type"),
          "application/json",
        );
        assert.deepEqual(JSON.parse(String(init.body)), {
          terms: params.terms,
          is_or_search: true,
          time_zone_offset: -10800,
          include_deleted_channels: true,
          page: 2,
          per_page: 20,
        });
        return Response.json(raw);
      },
    }),
  );
  for (const result of [
    await api.searchFiles({ teamId: team, searchFilesRequest: params }),
    await api.searchFilesInAllTeams({ searchFilesInAllTeamsRequest: params }),
  ]) {
    assert.deepEqual(result.order, [id]);
    assert.equal(result.fileInfos[id].channelId, channel);
    assert.equal(result.fileInfos[id].archived, true);
    assert.equal(result.nextFileInfoId, "next");
    assert.equal(result.prevFileInfoId, "prev");
    assert.equal(result.firstInaccessibleFileTime, 17);
    assert.deepEqual(
      JSON.parse(JSON.stringify(FileInfoListToJSON(result))),
      raw,
    );
  }
  assert.deepEqual(paths, [
    `/mattermost/api/v4/teams/${team}/files/search`,
    "/mattermost/api/v4/files/search",
  ]);
});

test("documents retention on a forbidden post and rejects drift in either pinned source", () => {
  const path = "/api/v4/posts/{post_id}";
  const input = object(at(read("posts.yaml"), [path, "get"]), path);
  const next = read("posts-12.1.0.yaml");
  const defs = read("definitions.yaml");
  const fixed = correctSinglePost(input, next, defs);
  assert.deepEqual(at(fixed, ["responses", "404"]), {
    $ref: "#/components/responses/NotFound",
  });
  assert.deepEqual(
    at(fixed, [
      "responses",
      "403",
      "headers",
      "First-Inaccessible-Post-Time",
      "schema",
    ]),
    { type: "string", enum: ["1"] },
  );
  assert.ok(
    !Object.hasOwn(object(at(fixed, ["responses", "200"]), path), "headers"),
  );
  for (const version of ["baseline", "newer"]) {
    const source = structuredClone(input);
    const newer = structuredClone(next);
    const operation =
      version === "baseline" ? source : object(at(newer, [path, "get"]), path);
    const success = object(at(operation, ["responses", "200"]), path);
    success.headers = {
      "Has-Inaccessible-Posts": { schema: { type: "integer" } },
    };
    assert.throws(
      () => correctSinglePost(source, newer, defs),
      /Review the single-post/,
    );
  }
});

test("requires the team and user IDs and detects drift in either AddTeamMember input", () => {
  const path = "/api/v4/teams/{team_id}/members";
  const source = object(at(read("teams.yaml"), [path, "post"]), path);
  const newer = read("teams-12.1.0.yaml");
  const required = [
    "requestBody",
    "content",
    "application/json",
    "schema",
    "required",
  ];
  assert.deepEqual(at(correctTeamMemberRequest(source, newer), required), [
    "team_id",
    "user_id",
  ]);
  for (const target of ["baseline", "reference"]) {
    const baseline = structuredClone(source);
    const reference = structuredClone(newer);
    const op =
      target === "baseline"
        ? baseline
        : object(at(reference, [path, "post"]), path);
    const schema = object(at(op, required.slice(0, -1)), path);
    schema.required = ["user_id"];
    assert.throws(
      () => correctTeamMemberRequest(baseline, reference),
      /Review the pinned AddTeamMember/,
    );
  }
});

test("takes managed category assignments from the server version that exposes them", () => {
  const path = "/api/v4/teams/{team_id}/channels/managed_categories";
  assert.equal(Object.hasOwn(read("channels.yaml"), path), false);
  const current = at(read("channels-12.1.0.yaml"), [path, "get"]);
  assert.deepEqual(at(contract, ["paths", path, "get"]), current);
  const schema = at(current, [
    "responses",
    "200",
    "content",
    "application/json",
    "schema",
  ]);
  assert.equal(at(schema, ["type"]), "object");
  assert.deepEqual(at(schema, ["additionalProperties"]), { type: "string" });
});
