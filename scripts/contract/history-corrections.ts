import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// v10.10.1 implements the endpoint but only v12.1.0 publishes its OpenAPI operation.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/post.go#L545-L575
// https://github.com/mattermost/mattermost/blob/v12.1.0/api/v4/source/posts.yaml#L665-L698
export function checkEditHistoryOperation(
  baseline: Fields,
  path: string,
  reference: Fields,
) {
  const id = "GetEditHistoryForPost";
  const op = object(reference.get, id);
  const success = object(object(op.responses, id)["200"], id);
  const media = object(object(success.content, id)["application/json"], id);
  const parameters =
    Array.isArray(op.parameters) &&
    op.parameters.map((field) => {
      const { description: _description, ...shape } = object(field, id);
      return shape;
    });
  if (
    Object.hasOwn(baseline, path) ||
    Object.hasOwn(reference, "parameters") ||
    Object.hasOwn(op, "security") ||
    !isDeepStrictEqual(parameters, [
      {
        name: "post_id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ]) ||
    !isDeepStrictEqual(media.schema, {
      type: "array",
      items: { $ref: "#/components/schemas/Post" },
    })
  )
    throw Error(
      "Review the GetEditHistoryForPost contract against both pinned sources",
    );
}

// Both handlers encode one PostList for the requesting user.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/post.go#L361-L443
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/post.go#L489-L586
export function correctFlaggedPosts(source: Fields, newer: Fields): Fields {
  const id = "GetFlaggedPostsForUser";
  const path = "/api/v4/users/{user_id}/posts/flagged";
  const list = { $ref: "#/components/schemas/PostList" };
  const result = structuredClone(source);
  const reference = object(object(newer[path], path).get, id);
  for (const op of [reference, result]) {
    const ok = object(object(op.responses, id)["200"], id);
    const media = object(object(ok.content, id)["application/json"], id);
    if (
      op.operationId !== id ||
      !isDeepStrictEqual(media.schema, { type: "array", items: list })
    )
      throw Error("Review the GetFlaggedPostsForUser response");
    if (op === result) media.schema = list;
  }
  return result;
}

const flags = [
  "skipFetchThreads",
  "collapsedThreads",
  "collapsedThreadsExtended",
];

function parameters(operation: Fields, name: string): Fields[] {
  if (
    operation.operationId !== "GetPostsForChannel" ||
    !Array.isArray(operation.parameters)
  )
    throw Error(`Review the GetPostsForChannel parameters in ${name}`);
  return operation.parameters.map((p) => object(p, name));
}

// Both servers read these flags. v12.1.0 supplies the missing OpenAPI nodes.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/post.go#L195-L205
// https://github.com/mattermost/mattermost/blob/v12.1.0/api/v4/source/posts.yaml#L764-L781
export function correctHistoryQuery(
  operation: Fields,
  reference: Fields,
  path: string,
): Fields {
  const base = parameters(operation, "10.10.1");
  const other = parameters(
    object(object(reference[path], path).get, path),
    "12.1.0",
  );
  const additions = flags.map((name) => {
    const matches = other.filter((p) => p.name === name && p.in === "query");
    const [node] = matches;
    if (
      base.some((p) => p.name === name && p.in === "query") ||
      matches.length !== 1 ||
      (node.required !== undefined && node.required !== false) ||
      !isDeepStrictEqual(node.schema, { type: "boolean", default: false })
    )
      throw Error(`Review the GetPostsForChannel correction for ${name}`);
    return node;
  });
  return { ...operation, parameters: [...base, ...additions] };
}

const integer64 = { type: "integer", format: "int64" };

function addProperties(
  name: string,
  schema: Fields,
  additions: Fields,
): Fields {
  const properties = object(schema.properties, name);
  if (
    schema.type !== "object" ||
    Object.keys(additions).some((key) => Object.hasOwn(properties, key))
  )
    throw Error(`Review the ${name} history fields against the baseline`);
  return { ...schema, properties: { ...properties, ...additions } };
}

// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/post_metadata.go#L20-L25
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/app/post_metadata.go#L568-L579
export function correctRedactedFileCount(
  baseline: Fields,
  newer: Fields,
): Fields {
  const name = "PostMetadata";
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  for (const schema of [baseline, object(schemas[name], name)]) {
    const properties = object(schema.properties, name);
    const { description: _description, ...files } = object(
      properties.files,
      "PostMetadata.files",
    );
    if (
      schema.type !== "object" ||
      Object.hasOwn(properties, "redacted_file_count") ||
      (Array.isArray(schema.required) &&
        schema.required.includes("redacted_file_count")) ||
      !isDeepStrictEqual(files, {
        type: "array",
        items: { $ref: "#/components/schemas/FileInfo" },
      })
    )
      throw Error("Review the PostMetadata attachment count against both tags");
  }
  return addProperties(name, baseline, {
    redacted_file_count: { ...integer64, minimum: 0 },
  });
}

export function correctHistorySchema(name: string, schema: Fields): Fields {
  // https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/post_list.go#L12-L22
  if (name === "PostList")
    return addProperties(name, schema, {
      first_inaccessible_post_time: { ...integer64 },
    });
  // https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/post.go#L90-L122
  if (name === "Post") {
    const { hashtag, ...properties } = object(schema.properties, name);
    if (
      !isDeepStrictEqual(hashtag, { type: "string" }) ||
      (Array.isArray(schema.required) && schema.required.includes("hashtag"))
    ) {
      throw Error("Review the Post hashtag field against the baseline");
    }
    return addProperties(
      name,
      { ...schema, properties },
      {
        hashtags: hashtag,
        is_pinned: { type: "boolean" },
        message_source: { type: "string" },
        reply_count: { ...integer64 },
        last_reply_at: { ...integer64 },
        participants: {
          type: "array",
          nullable: true,
          items: { $ref: "#/components/schemas/User" },
        },
        is_following: { type: "boolean" },
      },
    );
  }
  if (name !== "PostMetadata") return schema;
  // https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/post_metadata.go#L18-L63
  const properties = object(schema.properties, name);
  const { description, ...shape } = object(
    properties.images,
    "PostMetadata.images",
  );
  const dimensions = {
    height: { type: "integer" },
    width: { type: "integer" },
  };
  if (
    schema.type !== "object" ||
    typeof description !== "string" ||
    !isDeepStrictEqual(shape, {
      type: "object",
      items: { type: "object", properties: dimensions },
    })
  )
    throw Error(
      "Review the PostMetadata.images correction against the baseline",
    );
  const image = {
    type: "object",
    properties: {
      ...dimensions,
      format: { type: "string" },
      frame_count: { type: "integer" },
    },
  };
  return {
    ...schema,
    properties: {
      ...properties,
      images: { type: "object", description, additionalProperties: image },
    },
  };
}
