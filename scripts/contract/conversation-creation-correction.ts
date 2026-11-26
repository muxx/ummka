import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// The handlers count distinct users after filling in the requester for a group.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/channel.go#L458-L633
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/channel.go#L795-L1009
export function correctConversationCreation(
  id: "CreateDirectChannel" | "CreateGroupChannel",
  source: Fields,
  newer: Fields,
): Fields {
  const direct = id === "CreateDirectChannel";
  const result = structuredClone(source);
  const body = object(result.requestBody, id);
  const media = object(object(body.content, id)["application/json"], id);
  const response = object(object(result.responses, id)["201"], id);
  const success = object(object(response.content, id)["application/json"], id);
  if (
    source.operationId !== id ||
    !isDeepStrictEqual(source, newer) ||
    body.required !== true ||
    !isDeepStrictEqual(media.schema, {
      type: "array",
      items: { type: "string" },
      minItems: direct ? 2 : 3,
      maxItems: direct ? 2 : 8,
    }) ||
    !isDeepStrictEqual(success.schema, { $ref: "#/components/schemas/Channel" })
  )
    throw Error(`Review both pinned ${id} contracts`);
  media.schema = {
    type: "array",
    items: { type: "string" },
    minItems: direct ? 1 : 2,
  };
  body.description = direct
    ? "User IDs of the two participants, or the requester's ID for a self conversation. Duplicate IDs are ignored."
    : "Three to eight distinct participants including the requester. The server adds the requester if omitted and ignores duplicate IDs.";
  return result;
}
