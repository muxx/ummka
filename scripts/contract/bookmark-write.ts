import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both API handlers read Connection-Id; the official WebApp sends it on all four mutations.
// https://github.com/mattermost/mattermost/blob/v12.1.0/webapp/platform/client/src/client4.ts#L2257-L2282
export function correctBookmarkWrite(
  id: string,
  baseline: Fields,
  newer: Fields,
): Fields {
  function correct(source: Fields) {
    const op = structuredClone(source);
    if (
      op.operationId !== id ||
      !Array.isArray(op.parameters) ||
      op.parameters.some((p) => p.in === "header")
    )
      throw new Error(`Unrecognized bookmark mutation parameters: ${id}`);
    op.parameters.push({
      name: "Connection-Id",
      in: "header",
      required: false,
      schema: { type: "string" },
    });
    if (id === "DeleteChannelBookmark") return op;
    if (op.body !== null)
      throw new Error(`Unrecognized bookmark body placeholder: ${id}`);
    delete op.body;
    const body = object(op.requestBody, id);
    const schema = object(
      object(object(body.content, id)["application/json"], id).schema,
      id,
    );
    if (id === "UpdateChannelBookmarkSortOrder") {
      // Both handlers decode an int64 and reject a negative position.
      // https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/channel_bookmark.go#L227-L236
      if (
        body.required !== undefined ||
        schema.type !== "number" ||
        schema.format !== "int64"
      )
        throw new Error("Unrecognized bookmark sort order");
      body.required = true;
      schema.type = "integer";
      schema.minimum = 0;
    } else {
      if (
        !["CreateChannelBookmark", "UpdateChannelBookmark"].includes(id) ||
        schema.type !== "object" ||
        body.required !== true
      )
        throw new Error(`Unrecognized bookmark mutation: ${id}`);
      const fields = object(schema.properties, id);
      const type = object(fields.type, id);
      if (!isDeepStrictEqual(type.enum, ["link", "file"]))
        throw new Error("Unrecognized writable bookmark types");
      if (id === "UpdateChannelBookmark") {
        // https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel_bookmark.go#L238-L245
        delete fields.type;
      } else {
        // The two releases differ only in a spelling correction in this description.
        type.description = "Link or file bookmark.";
      }
    }
    return op;
  }
  const result = correct(baseline);
  if (!isDeepStrictEqual(result, correct(newer)))
    throw new Error(`Bookmark mutation contracts differ: ${id}`);
  return result;
}
