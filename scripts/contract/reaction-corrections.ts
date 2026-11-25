import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both server models serialize these eight fields, including a nullable remote_id.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/reaction.go#L12-L20
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/reaction.go#L12-L20
export function correctReaction(source: Fields, newer: Fields): Fields {
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  const integer = { type: "integer", format: "int64" };
  const expected = {
    user_id: { type: "string" },
    post_id: { type: "string" },
    emoji_name: { type: "string" },
    create_at: integer,
  };
  for (const model of [source, object(schemas.Reaction, "Reaction")]) {
    const properties = Object.fromEntries(
      Object.entries(object(model.properties, "Reaction")).map(
        ([key, value]) => {
          const { description: _description, ...shape } = object(value, key);
          return [key, shape];
        },
      ),
    );
    if (
      model.type !== "object" ||
      Object.hasOwn(model, "required") ||
      !isDeepStrictEqual(properties, expected)
    )
      throw Error("Review Reaction against both pinned server models");
  }
  const properties = {
    ...object(source.properties, "Reaction"),
    channel_id: { type: "string" },
    update_at: integer,
    delete_at: integer,
    remote_id: { type: "string", nullable: true },
  };
  return { ...source, properties, required: Object.keys(properties) };
}

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/reaction.go#L21-L52
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/reaction.go#L21-L54
export function correctSaveReaction(source: Fields, newer: Fields): Fields {
  const id = "SaveReaction";
  const reaction = { $ref: "#/components/schemas/Reaction" };
  const updated = structuredClone(source);
  for (const operation of [
    object(object(newer["/api/v4/reactions"], id).post, id),
    updated,
  ]) {
    const body = object(operation.requestBody, id);
    const media = object(object(body.content, id)["application/json"], id);
    const responses = object(operation.responses, id);
    const success = object(responses["201"], id);
    const successMedia = object(
      object(success.content, id)["application/json"],
      id,
    );
    if (
      operation.operationId !== id ||
      body.required !== true ||
      !isDeepStrictEqual(media.schema, reaction) ||
      !isDeepStrictEqual(successMedia.schema, reaction) ||
      Object.keys(responses)
        .filter((key) => key.startsWith("2"))
        .join() !== "201"
    )
      throw Error(
        "Review SaveReaction request and success status against both pins",
      );
  }
  const body = object(updated.requestBody, id);
  const media = object(object(body.content, id)["application/json"], id);
  const properties = {
    user_id: { type: "string" },
    post_id: { type: "string" },
    emoji_name: { type: "string" },
  };
  media.schema = {
    type: "object",
    required: Object.keys(properties),
    properties,
  };
  const responses = object(updated.responses, id);
  responses["200"] = responses["201"];
  delete responses["201"];
  return updated;
}
