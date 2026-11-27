import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

export function correctFileUpload(source: Fields, newerPaths: Fields) {
  const newer = object(newerPaths["/api/v4/files"], "12.1.0 file upload").post;
  const body = object(source.requestBody, "file upload request");
  const media = object(
    object(body.content, "file upload content")["multipart/form-data"],
    "file upload multipart",
  );
  const schema = object(media.schema, "file upload form");
  const fields = object(schema.properties, "file upload fields");
  const params = source.parameters;
  const result = object(
    object(source.responses, "file upload responses")["201"],
    "upload receipt",
  );
  const receipt = object(
    object(
      object(result.content, "receipt content")["application/json"],
      "receipt JSON",
    ).schema,
    "receipt schema",
  );
  const lists = object(receipt.properties, "receipt fields");
  if (
    source.operationId !== "UploadFile" ||
    !isDeepStrictEqual(source, newer) ||
    !String(source.description).includes("bookmark=true") ||
    !Array.isArray(params) ||
    !isDeepStrictEqual(
      params.map((p) => [p.name, p.in, p.required, p.schema]),
      [
        ["channel_id", "query", false, { type: "string" }],
        ["filename", "query", false, { type: "string" }],
      ],
    ) ||
    !isDeepStrictEqual(Object.keys(fields).sort(), [
      "channel_id",
      "client_ids",
      "files",
    ]) ||
    schema.type !== "object" ||
    Object.hasOwn(schema, "required") ||
    object(fields.files, "upload file").type !== "string" ||
    object(fields.files, "upload file").format !== "binary" ||
    object(fields.channel_id, "upload channel").type !== "string" ||
    object(fields.client_ids, "upload client ID").type !== "string" ||
    object(lists.file_infos, "uploaded files").type !== "array" ||
    object(lists.client_ids, "returned client IDs").type !== "array" ||
    !isDeepStrictEqual(object(lists.file_infos, "uploaded files").items, {
      $ref: "#/components/schemas/FileInfo",
    }) ||
    !isDeepStrictEqual(object(lists.client_ids, "returned client IDs").items, {
      type: "string",
    })
  )
    throw Error("Review both pinned file upload contracts");
  // Both official clients send metadata before the bytes so the server can stream to disk.
  return {
    ...source,
    parameters: [
      {
        name: "bookmark",
        in: "query",
        required: false,
        schema: { type: "boolean" },
      },
    ],
    requestBody: {
      ...body,
      required: true,
      content: {
        "multipart/form-data": {
          ...media,
          schema: {
            ...schema,
            required: ["channel_id", "client_ids", "files"],
            properties: {
              channel_id: fields.channel_id,
              client_ids: fields.client_ids,
              files: fields.files,
            },
          },
        },
      },
    },
  };
}
