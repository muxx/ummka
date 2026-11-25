import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both servers compare the body team ID with the path and validate the body user ID.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/team.go#L719-L740
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/team.go#L972-L991
export function correctTeamMemberRequest(
  source: Fields,
  newer: Fields,
): Fields {
  const path = "/api/v4/teams/{team_id}/members";
  const id = "AddTeamMember";
  const reference = object(object(newer[path], path).post, id);
  const result = structuredClone(source);
  const body = object(result.requestBody, id);
  const media = object(object(body.content, id)["application/json"], id);
  const schema = object(media.schema, id);
  if (
    source.operationId !== id ||
    reference.operationId !== id ||
    !isDeepStrictEqual(source.requestBody, reference.requestBody) ||
    body.required !== true ||
    !isDeepStrictEqual(schema, {
      type: "object",
      properties: { team_id: { type: "string" }, user_id: { type: "string" } },
    })
  )
    throw Error("Review the pinned AddTeamMember request on both servers");
  schema.required = ["team_id", "user_id"];
  return result;
}
