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

// The channel and its member each carry ordinary and root-only counters.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/channel.go#L88-L101
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel_member.go#L41-L56
export function correctSidebarSchema(name: string, source: Fields): Fields {
  if (name === "SidebarCategoryWithChannels")
    return correctSidebarCategory(source);
  if (name !== "Channel" && name !== "ChannelMember") return source;
  const properties = object(source.properties, name);
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
  return { ...source, properties: next };
}
