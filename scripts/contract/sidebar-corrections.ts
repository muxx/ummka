import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both tagged API handlers marshal a single OrderedSidebarCategories.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/channel_category.go#L15-L40
export function correctSidebarResponse(source: Fields): Fields {
  const operation = structuredClone(source);
  const responses = object(operation.responses, "sidebar responses");
  const success = object(responses["200"], "sidebar success");
  const content = object(success.content, "sidebar response content");
  const json = object(content["application/json"], "sidebar JSON");
  const collection = { $ref: "#/components/schemas/OrderedSidebarCategories" };
  if (!isDeepStrictEqual(json.schema, { type: "array", items: collection }))
    throw Error(
      "Review the sidebar response correction against the pinned source",
    );
  json.schema = collection;
  return operation;
}

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/channel_sidebar.go#L14-L57
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel_sidebar.go#L14-L61
export function correctSidebarCategory(source: Fields): Fields {
  const properties = object(source.properties, "sidebar category properties");
  const knownTypes = ["channels", "custom", "direct_messages", "favorites"];
  const additional = {
    sort_order: { type: "integer", format: "int64" },
    sorting: { type: "string" },
    muted: { type: "boolean" },
    collapsed: { type: "boolean" },
  };
  if (
    source.type !== "object" ||
    !isDeepStrictEqual(properties.type, { type: "string", enum: knownTypes }) ||
    Object.keys(additional).some((key) => Object.hasOwn(properties, key))
  )
    throw Error(
      "Review the sidebar category correction against the pinned source",
    );
  return {
    ...source,
    properties: {
      ...properties,
      type: { type: "string", enum: [...knownTypes, "managed"] },
      ...additional,
    },
  };
}

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/team_member.go#L16-L30
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel_member.go#L41-L56
function correctMemberRoles(name: string, source: Fields): Fields {
  if (name !== "TeamMember" && name !== "ChannelMember") return source;
  const properties = object(source.properties, name);
  const additional: Fields = { scheme_guest: { type: "boolean" } };
  if (name === "ChannelMember") {
    additional.scheme_user = { type: "boolean" };
    additional.scheme_admin = { type: "boolean" };
    additional.explicit_roles = { type: "string" };
  }
  if (
    source.type !== "object" ||
    object(properties.roles, "roles").type !== "string" ||
    Object.keys(additional).some((key) => Object.hasOwn(properties, key))
  )
    throw Error(
      `Review the ${name} membership roles against the pinned source`,
    );
  return { ...source, properties: { ...properties, ...additional } };
}

// The channel and its member each carry ordinary and root-only counters.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/channel.go#L88-L101
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel_member.go#L41-L56
export function correctSidebarSchema(name: string, source: Fields): Fields {
  if (name === "SidebarCategoryWithChannels")
    return correctSidebarCategory(source);
  const model = correctMemberRoles(name, source);
  if (name !== "Channel" && name !== "ChannelMember") return model;
  const properties = object(model.properties, name);
  const missing =
    name === "Channel"
      ? ["total_msg_count_root", "last_root_post_at"]
      : ["msg_count_root", "mention_count_root", "urgent_mention_count"];
  const ordinary = name === "Channel" ? "total_msg_count" : "msg_count";
  if (
    source.type !== "object" ||
    object(properties[ordinary], ordinary).type !== "integer" ||
    missing.some((field) => Object.hasOwn(properties, field))
  )
    throw Error(
      `Review the ${name} sidebar counter correction against the pinned source`,
    );
  const next = { ...properties };
  for (const field of missing)
    next[field] = { type: "integer", format: "int64" };
  return { ...model, properties: next };
}

// Both tagged Go models always serialize Channel.Shared, including a nil pointer.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/channel.go#L97
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel.go#L104
export function correctChannelSharing(
  source: Fields,
  newerDefinitions: Fields,
): Fields {
  const components = object(newerDefinitions.components, "newer components");
  const schemas = object(components.schemas, "newer schemas");
  for (const model of [source, object(schemas.Channel, "newer Channel")]) {
    const properties = object(model.properties, "Channel properties");
    if (
      model.type !== "object" ||
      object(properties.type, "channel type").type !== "string" ||
      Object.hasOwn(properties, "shared")
    )
      throw Error(
        "Review the Channel.shared correction against the pinned sources",
      );
  }
  return {
    ...source,
    properties: {
      ...object(source.properties, "Channel properties"),
      shared: { type: "boolean", nullable: true },
    },
  };
}
