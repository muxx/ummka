import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
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
  correctHistoryQuery,
  correctHistorySchema,
} from "./history-corrections.ts";
import { object } from "./objects.ts";
import {
  checkPostInfoOperation,
  postInfoSchema,
} from "./post-info-correction.ts";
import { correctUserProfile } from "./profile-corrections.ts";
import { buildSpecification, readSource } from "./schema.ts";
import {
  correctSidebarCategory,
  correctSidebarResponse,
  correctSidebarSchema,
} from "./sidebar-corrections.ts";

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
  ["components", "schemas", "Channel"],
  ["components", "schemas", "ChannelMember"],
  ["components", "schemas", "ChannelNotifyProps"],
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
    assert.deepEqual(
      actual,
      path === sidebar ? correctSidebarResponse(source) : source,
    );
  }
  for (const path of definitionPaths) {
    const source = at(definitions, path);
    const name = path[2];
    let expected = source;
    if (name === "User") expected = correctUserProfile(object(source, name));
    if (["Channel", "ChannelMember", "TeamMember"].includes(name))
      expected = correctSidebarSchema(name, object(source, name));
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
      "Channel",
      "ChannelMember",
      "ChannelNotifyProps",
      "Emoji",
      "FileInfo",
      "OrderedSidebarCategories",
      "Post",
      "PostAcknowledgement",
      "PostInfo",
      "PostList",
      "PostMetadata",
      "Preference",
      "Reaction",
      "SidebarCategoryWithChannels",
      "SystemStatusResponse",
      "Team",
      "TeamMember",
      "Timezone",
      "User",
      "UserNotifyProps",
    ],
  );
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
    PostMetadata: ["images"],
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
const sourceDirectory = resolve(sources);
const fixturePrefix = join(work, "incomplete-");
function copySources() {
  const fixture = mkdtempSync(fixturePrefix);
  for (const name of new Set([
    "introduction.yaml",
    "definitions.yaml",
    "definitions-12.1.0.yaml",
    "posts-12.1.0.yaml",
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
  PostListFromJSON,
  ChannelFromJSON,
  ChannelToJSON,
  ChannelMemberFromJSON,
  ChannelMemberToJSON,
  TeamMemberFromJSON,
  TeamMemberToJSON,
} = await import(pathToFileURL(resolve(work, "compiled/index.js")).href);
const channelRoleFields = {
  scheme_guest: { type: "boolean" },
  scheme_user: { type: "boolean" },
  scheme_admin: { type: "boolean" },
  explicit_roles: { type: "string" },
};
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
      ...(name === "ChannelMember" ? channelRoleFields : {}),
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
