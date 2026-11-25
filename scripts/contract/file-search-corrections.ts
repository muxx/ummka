import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both handlers decode JSON, despite the multipart example and duplicated operationId.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/file.go#L740-L766
export function correctFileSearch(
  path: string,
  source: Fields,
  newer: Fields,
): Fields {
  const team = path === "/api/v4/teams/{team_id}/files/search";
  const reference = object(object(newer[path], path).post, "file search POST");
  const request = object(source.requestBody, "file search request");
  const content = object(request.content, "file search content");
  if (
    (!team && path !== "/api/v4/files/search") ||
    source.operationId !== "SearchFiles" ||
    reference.operationId !== source.operationId ||
    !isDeepStrictEqual(
      source.tags,
      team ? ["teams", "files", "search"] : ["files", "search"],
    ) ||
    !isDeepStrictEqual(reference.tags, source.tags) ||
    !isDeepStrictEqual(request, reference.requestBody) ||
    !isDeepStrictEqual(Object.keys(content), ["multipart/form-data"]) ||
    !isDeepStrictEqual(source.responses, reference.responses)
  )
    throw Error("Review the file search operation against both tags");
  return {
    ...source,
    // typescript-fetch exports duplicate request types when an operation belongs to two APIs.
    tags: ["files"],
    operationId: team ? "SearchFiles" : "SearchFilesInAllTeams",
    requestBody: {
      ...request,
      content: { "application/json": content["multipart/form-data"] },
    },
  };
}

// Both server versions serialize FileInfoList, including the two cursor IDs and retention boundary.
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/file_info_list.go
export function correctFileModel(
  name: string,
  source: Fields,
  newer: Fields,
): Fields {
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  const properties = object(source.properties, name);
  if (!isDeepStrictEqual(source, schemas[name]))
    throw Error(`Review ${name} against both tags`);
  if (name === "FileInfo") {
    if (
      Object.hasOwn(properties, "channel_id") ||
      Object.hasOwn(properties, "archived")
    )
      throw Error("Review FileInfo channel and archive fields");
    return {
      ...source,
      properties: {
        ...properties,
        channel_id: { type: "string" },
        archived: { type: "boolean" },
      },
    };
  }
  const { order, file_infos, next_file_id, prev_file_id } = properties;
  if (
    name !== "FileInfoList" ||
    Object.keys(properties).length !== 4 ||
    object(next_file_id, "next file ID").type !== "string" ||
    object(prev_file_id, "previous file ID").type !== "string" ||
    object(object(file_infos, "file dictionary").additionalProperties, "file")
      .$ref !== "#/components/schemas/FileInfo" ||
    object(order, "file order").type !== "array"
  )
    throw Error("Review FileInfoList cursor and retention fields");
  const fields = {
    order,
    file_infos,
    next_file_info_id: next_file_id,
    prev_file_info_id: prev_file_id,
    first_inaccessible_file_time: { type: "integer", format: "int64" },
  };
  return { ...source, properties: fields, required: Object.keys(fields) };
}
