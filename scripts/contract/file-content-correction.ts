import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both tags delegate delivery to net/http.ServeContent. The original's media
// type comes from the file. Thumbnail/preview advertise JPEG, even for PNG bytes.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/file.go#L467-L665
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/file.go#L504-L825
export function correctFileContent(
  source: Fields,
  newer: Fields,
  path: string,
): Fields {
  const reference = object(object(newer[path], path).get, path);
  const params = source.parameters;
  const responses = object(source.responses, "file content responses");
  if (
    !isDeepStrictEqual(source, reference) ||
    !Array.isArray(params) ||
    params.length !== 1 ||
    params[0]?.name !== "file_id" ||
    params[0]?.in !== "path" ||
    params[0]?.required !== true ||
    !isDeepStrictEqual(params[0]?.schema, { type: "string" }) ||
    !isDeepStrictEqual(Object.keys(responses).sort(), [
      "400",
      "401",
      "403",
      "404",
      "501",
    ])
  )
    throw new Error("Review both pinned file content contracts");

  const mediaType = source.operationId === "GetFile" ? "*/*" : "image/jpeg";
  const content = {
    [mediaType]: { schema: { type: "string", format: "binary" } },
  };
  return {
    ...source,
    parameters: [
      ...params,
      {
        name: "Range",
        in: "header",
        required: false,
        schema: { type: "string", pattern: "^bytes=([0-9]+-[0-9]*|-[0-9]+)$" },
      },
    ],
    responses: {
      ...responses,
      "200": { description: "Complete file representation", content },
      "206": {
        description: "Requested range of the file representation",
        content,
        headers: { "Content-Range": { schema: { type: "string" } } },
      },
      "416": {
        description: "Requested range outside the representation",
        headers: { "Content-Range": { schema: { type: "string" } } },
      },
    },
  };
}
