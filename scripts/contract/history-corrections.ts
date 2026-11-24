import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

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
