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
import catalog from "../../contracts/mattermost/operations.json" with {
  type: "json",
};
import { buildSpecification, object, readSource } from "./schema.ts";

const sources = process.env.UMMKA_CONTRACT_SOURCES;
const work = process.env.UMMKA_CONTRACT_WORK;
if (!sources || !work)
  throw new Error("Run make check-contract to prepare the test inputs");
const read = readSource.bind(null, sources);
const serialized = readFileSync(join(work, "openapi.json"), "utf8");
const contract = object(JSON.parse(serialized), "contract");
const definitions = read("definitions.yaml");
const ping = "/api/v4/system/ping";
const system = read("system.yaml");
const userRoute = "/api/v4/users/{user_id}";
const users = read("users.yaml");

function at(document: unknown, path: string[]) {
  let value = document;
  for (const key of path) {
    const parent = object(value, key);
    assert.ok(Object.hasOwn(parent, key), `Missing ${path.join(" > ")}`);
    value = parent[key];
  }
  return value;
}

const definitionPaths = [
  ["security"],
  ["components", "securitySchemes", "bearerAuth"],
  ["components", "schemas", "SystemStatusResponse"],
  ["components", "responses", "InternalServerError"],
  ["components", "responses", "BadRequest"],
  ["components", "responses", "NotImplemented"],
  ["components", "schemas", "AppError"],
  ["components", "schemas", "User"],
  ["components", "schemas", "UserNotifyProps"],
  ["components", "schemas", "Timezone"],
  ["components", "responses", "Unauthorized"],
  ["components", "responses", "NotFound"],
];

test("retains the catalog operations, security and transitive models", () => {
  for (const { file, path, method } of catalog) {
    const key = [path, method.toLowerCase()];
    assert.deepEqual(at(contract, ["paths", ...key]), at(read(file), key));
  }
  for (const path of definitionPaths) {
    assert.deepEqual(at(contract, path), at(definitions, path));
  }
  assert.deepEqual(
    Object.keys(object(contract.paths, "paths")).sort(),
    [...new Set(catalog.map(({ path }) => path))].sort(),
  );
  assert.deepEqual(
    Object.keys(
      object(at(contract, ["components", "schemas"]), "schemas"),
    ).sort(),
    ["AppError", "SystemStatusResponse", "Timezone", "User", "UserNotifyProps"],
  );
});

test("builds identical JSON from the pinned sources", () => {
  assert.equal(
    `${JSON.stringify(buildSpecification(read), null, 2)}\n`,
    serialized,
  );
});

const removals = [
  ...catalog.map(({ file, path, method }) => ({
    file,
    path: [path, method.toLowerCase()],
    error: `Expected OpenAPI object ${method.toLowerCase()} ${path}`,
  })),
  ...definitionPaths.map((path) => ({
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
for (const { file, path, error } of removals) {
  test(`the builder rejects ${file} without ${path.join(" > ")}`, () => {
    const fixture = mkdtempSync(fixturePrefix);
    for (const name of new Set([
      "introduction.yaml",
      "definitions.yaml",
      ...catalog.map(({ file }) => file),
    ])) {
      copyFileSync(join(sourceDirectory, name), join(fixture, name));
    }
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
const { Configuration, SystemApi } = await import(
  pathToFileURL(resolve(work, "compiled/index.js")).href
);
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
