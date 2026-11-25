import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// These stores return nil slices, encoded as JSON null when there are no results.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/store/localcachelayer/role_layer.go#L61-L96
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/store/localcachelayer/role_layer.go#L69-L104
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/store/sqlstore/preference_store.go#L166-L175
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/store/sqlstore/preference_store.go#L151-L160
const lists = {
  GetRolesByNames: {
    path: "/api/v4/roles/names",
    method: "post",
    model: "Role",
  },
  GetPreferences: {
    path: "/api/v4/users/{user_id}/preferences",
    method: "get",
    model: "Preference",
  },
} as const;

export function correctNullableList(
  id: keyof typeof lists,
  operation: Fields,
  reference: Fields,
): Fields {
  const { path, method, model } = lists[id];
  const expected = {
    type: "array",
    items: { $ref: `#/components/schemas/${model}` },
  };
  function schema(version: Fields) {
    const success = object(object(version.responses, id)["200"], id);
    const media = object(object(success.content, id)["application/json"], id);
    if (
      version.operationId !== id ||
      !isDeepStrictEqual(media.schema, expected)
    )
      throw Error(
        `Review the nullable ${model} list against the pinned source`,
      );
    return object(media.schema, id);
  }
  schema(object(object(reference[path], path)[method], id));
  const corrected = structuredClone(operation);
  schema(corrected).nullable = true;
  return corrected;
}
