import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// These stores return nil slices, encoded as JSON null when there are no results.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/store/localcachelayer/role_layer.go#L61-L96
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/store/localcachelayer/role_layer.go#L69-L104
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/store/sqlstore/preference_store.go#L166-L175
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/store/sqlstore/preference_store.go#L151-L160
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/channel.go#L1516-L1536
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/channel.go#L2066-L2086
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/reaction.go#L54-L80
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/reaction.go#L56-L82
const lists = {
  GetReactions: {
    path: "/api/v4/posts/{post_id}/reactions",
    method: "get",
    items: { $ref: "#/components/schemas/Reaction" },
  },
  GetRolesByNames: {
    path: "/api/v4/roles/names",
    method: "post",
    items: { $ref: "#/components/schemas/Role" },
  },
  GetPreferences: {
    path: "/api/v4/users/{user_id}/preferences",
    method: "get",
    items: { $ref: "#/components/schemas/Preference" },
  },
  GetChannelMembersTimezones: {
    path: "/api/v4/channels/{channel_id}/timezones",
    method: "get",
    items: { type: "string" },
  },
} as const;

export function correctNullableList(
  id: keyof typeof lists,
  operation: Fields,
  reference: Fields,
): Fields {
  const { path, method, items } = lists[id];
  const expected = {
    type: "array",
    items,
  };
  function schema(version: Fields) {
    const success = object(object(version.responses, id)["200"], id);
    const media = object(object(success.content, id)["application/json"], id);
    if (
      version.operationId !== id ||
      !isDeepStrictEqual(media.schema, expected)
    )
      throw Error(`Review the nullable ${id} list against the pinned source`);
    return object(media.schema, id);
  }
  schema(object(object(reference[path], path)[method], id));
  const corrected = structuredClone(operation);
  schema(corrected).nullable = true;
  return corrected;
}
