import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// UpdateChannelMemberNotifyProps accepts these fields as partial string overrides.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/app/channel.go#L1343-L1388
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/app/channel.go#L1573-L1618
export function correctChannelNotifyProps(
  source: Fields,
  newer: Fields,
): Fields {
  const name = "ChannelNotifyProps";
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  for (const model of [source, object(schemas[name], name)]) {
    const props = object(model.properties, name);
    if (
      model.type !== "object" ||
      Object.hasOwn(model, "required") ||
      !isDeepStrictEqual(Object.keys(props).sort(), [
        "desktop",
        "email",
        "mark_unread",
        "push",
      ]) ||
      Object.values(props).some((value) => {
        const { description: _description, ...wire } = object(value, name);
        return !isDeepStrictEqual(wire, { type: "string" });
      })
    )
      throw Error("Review ChannelNotifyProps against the pinned sources");
  }
  const properties = { ...object(source.properties, name) };
  for (const field of [
    "desktop_threads",
    "push_threads",
    "ignore_channel_mentions",
    "channel_auto_follow_threads",
    "desktop_sound",
    "desktop_notification_sound",
  ])
    properties[field] = { type: "string" };
  return { ...source, properties };
}
