import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both servers store these settings as optional strings. Only channel overrides use on/off for sound.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/app/channel.go#L1343-L1388
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/app/channel.go#L1573-L1618
// https://github.com/mattermost/mattermost/blob/v10.10.1/webapp/channels/src/components/channel_notifications_modal/channel_notifications_modal.tsx#L457-L495
// https://github.com/mattermost/mattermost/blob/v12.1.0/webapp/channels/src/components/channel_notifications_modal/channel_notifications_modal.tsx#L461-L499
const shapes = {
  ChannelNotifyProps: {
    newerFields: [],
    published: ["desktop", "email", "mark_unread", "push"],
    missing: [
      "desktop_threads",
      "push_threads",
      "ignore_channel_mentions",
      "channel_auto_follow_threads",
      "desktop_sound",
      "desktop_notification_sound",
    ],
  },
  UserNotifyProps: {
    newerFields: [
      "auto_responder_message",
      "comments",
      "desktop_threads",
      "email_threads",
      "push_threads",
    ],
    published: [
      "channel",
      "desktop",
      "desktop_sound",
      "email",
      "first_name",
      "mention_keys",
      "push",
    ],
    missing: ["desktop_threads", "push_threads", "desktop_notification_sound"],
  },
};

export function correctNotificationProps(
  name: keyof typeof shapes,
  source: Fields,
  newer: Fields,
): Fields {
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  const { published, newerFields, missing } = shapes[name];
  const comparison = object(schemas[name], name);
  for (const [model, keys] of [
    [source, published],
    [comparison, [...published, ...newerFields].sort()],
  ] as const) {
    const props = object(model.properties, name);
    if (
      model.type !== "object" ||
      Object.hasOwn(model, "required") ||
      !isDeepStrictEqual(Object.keys(props).sort(), keys) ||
      Object.values(props).some((value) => {
        const { description: _description, ...wire } = object(value, name);
        return !isDeepStrictEqual(wire, { type: "string" });
      })
    )
      throw Error(`Review ${name} against the pinned sources`);
  }
  const properties = { ...object(source.properties, name) };
  const newerProperties = object(comparison.properties, name);
  for (const field of missing)
    properties[field] = newerProperties[field] ?? { type: "string" };
  return { ...source, properties };
}
