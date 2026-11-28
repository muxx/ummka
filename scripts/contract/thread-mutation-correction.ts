import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both OpenAPI versions omit the successful response body for thread mutations.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/user.go#L3390-L3561
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/user.go#L4067-L4247
export function correctThreadMutation(source: Fields, newer: Fields): Fields {
  const responses = object(source.responses, "thread mutation responses");
  const success = { description: "User's thread update successful" };
  if (
    !isDeepStrictEqual(source, newer) ||
    "requestBody" in source ||
    !isDeepStrictEqual(responses["200"], success)
  )
    throw Error("Review both thread mutation responses before correcting them");
  const byTime = source.operationId === "UpdateThreadReadForUser";
  let parameters = source.parameters;
  if (byTime) {
    // https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/web/params.go#L201-L205
    // https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/web/context.go#L377-L386
    const time =
      Array.isArray(parameters) &&
      parameters.find((p) => p.name === "timestamp");
    if (
      !Array.isArray(parameters) ||
      time?.in !== "path" ||
      time.required !== true ||
      !isDeepStrictEqual(time.schema, { type: "string" })
    )
      throw Error("Review both thread read timestamp parameters");
    parameters = parameters.map((p) =>
      p === time
        ? {
            ...p,
            schema: {
              type: "integer",
              format: "int64",
              minimum: 1,
              maximum: Number.MAX_SAFE_INTEGER,
            },
          }
        : p,
    );
  }
  const model =
    byTime || source.operationId === "SetThreadUnreadByPostId"
      ? "UserThread"
      : "StatusOK";
  return {
    ...source,
    parameters,
    responses: {
      ...responses,
      "200": {
        ...success,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${model}` },
          },
        },
      },
    },
  };
}
