import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both handlers call ReturnStatusOK. The published operations omit the JSON response.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/user.go#L3468-L3530
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/user.go#L4154-L4217
export function correctThreadFollow(source: Fields, newer: Fields): Fields {
  const responses = object(source.responses, "thread follow responses");
  const success = { description: "User's thread update successful" };
  if (
    !isDeepStrictEqual(source, newer) ||
    !isDeepStrictEqual(responses["200"], success)
  )
    throw Error(
      "Review both thread follow responses before applying the StatusOK correction",
    );
  return {
    ...source,
    responses: {
      ...responses,
      "200": {
        ...success,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/StatusOK" },
          },
        },
      },
    },
  };
}
