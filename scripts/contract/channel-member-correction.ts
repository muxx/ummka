import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Client4.addToChannel submits a single user. Both servers return a member for user_id,
// but an array for user_ids, which their published 201 schema cannot decode.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/channel.go#L1982-L1997
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/channel.go#L2730-L2748
export function singleChannelMember(source: Fields, newer: Fields): Fields {
  const id = "AddChannelMember";
  const path = "/api/v4/channels/{channel_id}/members";
  const result = structuredClone(source);
  for (const op of [object(object(newer[path], path).post, id), result]) {
    const body = object(op.requestBody, id);
    const json = object(object(body.content, id)["application/json"], id);
    const schema = object(json.schema, id);
    const props = object(schema.properties, id);
    const list = object(props.user_ids, id);
    const success = object(object(op.responses, id)["201"], id);
    const response = object(
      object(success.content, id)["application/json"],
      id,
    );
    if (
      op.operationId !== id ||
      body.required !== true ||
      schema.type !== "object" ||
      !isDeepStrictEqual(Object.keys(props).sort(), [
        "post_root_id",
        "user_id",
        "user_ids",
      ]) ||
      object(props.user_id, id).type !== "string" ||
      object(props.post_root_id, id).type !== "string" ||
      list.type !== "array" ||
      object(list.items, id).type !== "string" ||
      !isDeepStrictEqual(response.schema, {
        $ref: "#/components/schemas/ChannelMember",
      })
    )
      throw Error("Review the pinned AddChannelMember single-member contract");
    if (op === result)
      json.schema = {
        type: "object",
        required: ["user_id"],
        properties: {
          user_id: props.user_id,
          post_root_id: props.post_root_id,
        },
      };
  }
  return result;
}
