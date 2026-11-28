import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both handlers check access to the post, parse extended and encode a ThreadResponse.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/user.go#L3280-L3310
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/user.go#L3936-L3980
export function correctThreadRead(source: Fields, newer: Fields): Fields {
  const parameters = source.parameters;
  const responses = object(source.responses, "GetUserThread responses");
  const success = { description: "Get was successful" };
  if (
    !isDeepStrictEqual(source, newer) ||
    !Array.isArray(parameters) ||
    !isDeepStrictEqual(
      parameters.map((p) => [p.name, p.in]),
      [
        ["user_id", "path"],
        ["team_id", "path"],
        ["thread_id", "path"],
      ],
    ) ||
    !isDeepStrictEqual(responses["200"], success) ||
    "403" in responses
  )
    throw Error("Review both GetUserThread contracts before correcting them");
  return {
    ...source,
    parameters: [
      ...parameters,
      {
        name: "extended",
        in: "query",
        description: "Include participant profiles.",
        schema: { type: "boolean", default: false },
      },
    ],
    responses: {
      ...responses,
      "200": {
        ...success,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UserThread" },
          },
        },
      },
      "403": { $ref: "#/components/responses/Forbidden" },
    },
  };
}
