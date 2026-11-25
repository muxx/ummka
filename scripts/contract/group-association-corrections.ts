import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

const group = { $ref: "#/components/schemas/Group" };
const associationList = {
  type: "array",
  items: { $ref: "#/components/schemas/GroupWithSchemeAdmin" },
};
const channelMap = { $ref: "#/components/schemas/GroupsAssociatedToChannels" };

// The embedded Go Group marshals its own fields at the top level of each association.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/group.go#L96-L99
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/group.go
export function correctAssociatedGroup(original: Fields, definitions: Fields) {
  const schemas = object(
    object(definitions.components, "components").schemas,
    "schemas",
  );
  const properties = { group, scheme_admin: { type: "boolean" } };
  for (const model of [
    original,
    object(schemas.GroupWithSchemeAdmin, "GroupWithSchemeAdmin"),
  ]) {
    if (
      model.type !== "object" ||
      !isDeepStrictEqual(model.properties, properties) ||
      Object.hasOwn(model, "allOf") ||
      Object.hasOwn(model, "required")
    )
      throw Error("Review GroupWithSchemeAdmin against the pinned sources");
  }
  return {
    description: original.description,
    allOf: [
      group,
      { type: "object", properties: { scheme_admin: properties.scheme_admin } },
    ],
  };
}

// Both pins describe the map entries as arrays of the same embedded group model.
export function checkChannelGroupMap(original: Fields, definitions: Fields) {
  const schemas = object(
    object(definitions.components, "components").schemas,
    "schemas",
  );
  for (const model of [
    original,
    object(schemas.GroupsAssociatedToChannels, "GroupsAssociatedToChannels"),
  ]) {
    const { description: _description, ...shape } = model;
    if (
      !isDeepStrictEqual(shape, {
        type: "object",
        additionalProperties: associationList,
      })
    )
      throw Error(
        "Review GroupsAssociatedToChannels against the pinned sources",
      );
  }
  return original;
}

type Operation = "GetGroupsByTeam" | "GetGroupsAssociatedToChannelsByTeam";

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/group.go#L885-L922
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/group.go#L1070-L1119
export function correctGroupAssociations(
  id: Operation,
  path: string,
  original: Fields,
  newer: Fields,
): Fields {
  const byTeam = id === "GetGroupsByTeam";
  const allowed = [
    "team_id",
    "page",
    "per_page",
    "filter_allow_reference",
    "include_member_count",
  ];
  const flag = (name: string) => ({
    name,
    in: "query",
    schema: { type: "boolean", default: false },
  });
  const common = [
    { name: "team_id", in: "path", required: true, schema: { type: "string" } },
    { name: "page", in: "query", schema: { type: "integer", default: 0 } },
    { name: "per_page", in: "query", schema: { type: "integer", default: 60 } },
    flag("filter_allow_reference"),
  ];
  const expected = byTeam
    ? [
        ...common,
        flag("include_member_count"),
        flag("include_timezones"),
        flag("include_total_count"),
        flag("include_archived"),
        flag("filter_archived"),
        flag("filter_parent_team_permitted"),
        { name: "filter_has_member", in: "query", schema: { type: "string" } },
        flag("include_member_ids"),
        flag("only_syncable_sources"),
      ]
    : [...common, flag("paginate")];
  const next = object(object(newer[path], path).get, id);
  const documentedTeam = { type: "array", items: group };
  const baselineShape = byTeam
    ? documentedTeam
    : { type: "object", items: channelMap };
  const newerShape = byTeam
    ? documentedTeam
    : { type: "object", properties: { groups: channelMap } };
  const result = structuredClone(original);
  function responseBody(operation: Fields) {
    const success = object(object(operation.responses, id)["200"], "200");
    return object(
      object(success.content, "content")["application/json"],
      "JSON",
    );
  }
  for (const [operation, shape] of [
    [result, baselineShape],
    [next, newerShape],
  ] as const) {
    const parameters = operation.parameters;
    if (
      operation.operationId !== id ||
      !Array.isArray(parameters) ||
      !isDeepStrictEqual(
        parameters.map((param) => {
          const { description: _description, ...wire } = object(param, id);
          return wire;
        }),
        expected,
      )
    )
      throw Error("Review " + id + " parameters against the pinned sources");
    if (!isDeepStrictEqual(responseBody(operation).schema, shape))
      throw Error("Review " + id + " response against the pinned sources");
  }

  responseBody(result).schema = byTeam
    ? {
        type: "object",
        required: ["groups", "total_group_count"],
        properties: {
          groups: associationList,
          total_group_count: { type: "integer" },
        },
      }
    : {
        type: "object",
        required: ["groups"],
        properties: { groups: channelMap },
      };
  const parameters = (result.parameters as Fields[]).filter((param) =>
    allowed.includes(String(param.name)),
  );
  if (!byTeam) parameters.push(flag("include_member_count"));
  parameters.push(
    {
      name: "paginate",
      in: "query",
      schema: { type: "boolean", default: true },
    },
    { name: "q", in: "query", schema: { type: "string" } },
  );
  result.parameters = parameters;
  result.description = byTeam
    ? "Read groups associated with this team. Requires LDAP groups and the list_team_channels permission in the team."
    : "Read group associations by channel within this team. Requires LDAP groups and the list_team_channels permission in the team.";
  return result;
}
