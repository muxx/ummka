import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// An unmatched lookup leaves the slice nil, which the HTTP handler encodes as JSON null.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/store/localcachelayer/role_layer.go#L61-L96
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/store/localcachelayer/role_layer.go#L69-L104
export function correctRoleList(operation: Fields, reference: Fields): Fields {
  const path = "/api/v4/roles/names";
  const newer = object(object(reference[path], path).post, "v12 role list");
  const expected = {
    type: "array",
    items: { $ref: "#/components/schemas/Role" },
  };
  function schema(version: Fields) {
    const success = object(
      object(version.responses, "role responses")["200"],
      "role list success",
    );
    const media = object(
      object(success.content, "role media")["application/json"],
      "role JSON",
    );
    if (
      version.operationId !== "GetRolesByNames" ||
      !isDeepStrictEqual(media.schema, expected)
    )
      throw Error("Review the nullable role list against the pinned source");
    return object(media.schema, "role list");
  }
  schema(newer);
  const corrected = structuredClone(operation);
  schema(corrected).nullable = true;
  return corrected;
}
