type Fields = Record<string, unknown>;

function record(value: unknown): value is Fields {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveObject(
  value: unknown,
  components: Fields,
  kind: "parameters" | "schemas",
): Fields {
  const seen = new Set<string>();
  const group = components[kind];
  while (record(value) && typeof value.$ref === "string") {
    const ref = /^#\/components\/([\w.-]+)\/([\w.-]+)$/u.exec(value.$ref);
    if (
      !ref ||
      ref[1] !== kind ||
      seen.has(ref[2]) ||
      !record(group) ||
      !Object.hasOwn(group, ref[2])
    )
      throw Error(`Invalid OpenAPI ${kind} reference`);
    seen.add(ref[2]);
    value = group[ref[2]];
  }
  if (!record(value)) throw Error(`Expected an OpenAPI object in ${kind}`);
  return value;
}

export function checkPathParameters(
  path: string,
  pathItem: Fields,
  operation: Fields,
  components: Fields,
) {
  const names = new Set<string>();
  for (const segment of path.split("/")) {
    if (
      segment === "{user_id}" ||
      segment === "{team_id}" ||
      segment === "{channel_id}" ||
      segment === "{post_id}"
    )
      names.add(segment.slice(1, -1));
    else if (/[{}]/u.test(segment))
      throw Error(`Unsupported native route template: ${path}`);
  }

  const effective = new Map<string, Fields>();
  for (const parameters of [pathItem.parameters, operation.parameters]) {
    if (parameters === undefined) continue;
    if (!Array.isArray(parameters))
      throw Error(`Invalid OpenAPI parameters for ${path}`);
    const declared = new Set<string>();
    for (const entry of parameters) {
      const parameter = resolveObject(entry, components, "parameters");
      if (parameter.in !== "path") continue;
      if (typeof parameter.name !== "string")
        throw Error(`Unnamed path parameter in ${path}`);
      if (declared.has(parameter.name))
        throw Error(`Duplicate path parameter in ${path}: ${parameter.name}`);
      declared.add(parameter.name);
      effective.set(parameter.name, parameter);
    }
  }
  for (const [name, parameter] of effective) {
    if (
      !names.delete(name) ||
      parameter.required !== true ||
      resolveObject(parameter.schema, components, "schemas").type !== "string"
    )
      throw Error(
        `Expected a required string path parameter at ${path}: ${name}`,
      );
  }
  if (names.size)
    throw Error(`Missing path parameter at ${path}: ${[...names].join(", ")}`);
}
