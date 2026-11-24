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
  ["components", "schemas", "AppError"],
];

test("retains the selected operation, its security and its transitive models", () => {
  assert.deepEqual(
    at(contract, ["paths", ping, "get"]),
    at(system, [ping, "get"]),
  );
  for (const path of definitionPaths) {
    assert.deepEqual(at(contract, path), at(definitions, path));
  }
  assert.deepEqual(Object.keys(object(contract.paths, "paths")), [ping]);
  assert.deepEqual(
    Object.keys(
      object(at(contract, ["components", "schemas"]), "schemas"),
    ).sort(),
    ["AppError", "SystemStatusResponse"],
  );
});

test("builds identical JSON from the pinned sources", () => {
  assert.equal(
    `${JSON.stringify(buildSpecification(read), null, 2)}\n`,
    serialized,
  );
});

const removals = [
  {
    file: "system.yaml",
    path: [ping, "get"],
    error: `Expected OpenAPI object get ${ping}`,
  },
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
    for (const name of [
      "introduction.yaml",
      "system.yaml",
      "definitions.yaml",
    ]) {
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

test("rejects a route template before publishing an unsupported native route", () => {
  const operation = { ...catalog[0], path: "/api/v4/users/{user_id}" };
  assert.throws(() => buildSpecification(read, [operation]), {
    message:
      "Native routing requires a literal REST v4 path: /api/v4/users/{user_id}",
  });
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
