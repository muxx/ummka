import { type Fields, object } from "./objects.ts";

function createProperties(operation: Fields) {
  const body = object(operation.requestBody, "CreatePost body");
  const content = object(body.content, "CreatePost content");
  const schema = object(
    object(content["application/json"], "CreatePost JSON").schema,
    "CreatePost schema",
  );
  const fields = object(schema.properties, "CreatePost properties");
  const required = schema.required;
  if (
    operation.operationId !== "CreatePost" ||
    body.required !== true ||
    schema.type !== "object" ||
    !Array.isArray(required) ||
    !["channel_id", "message"].every((k) => required.includes(k)) ||
    !["channel_id", "root_id", "message"].every(
      (k) => object(fields[k], k).type === "string",
    ) ||
    Object.hasOwn(fields, "pending_post_id")
  )
    throw Error(
      "Review CreatePost.pending_post_id against the pinned Mattermost request",
    );
  return fields;
}

// The two tagged servers accept Post.PendingPostId when creating a post, including a reply.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/app/post.go#L137-L179
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/app/post.go#L126-L171
export function correctCreatePost(
  operation: Fields,
  reference: Fields,
): Fields {
  createProperties(
    object(
      object(reference["/api/v4/posts"], "12.1 posts").post,
      "12.1 CreatePost",
    ),
  );
  const result = structuredClone(operation);
  createProperties(result).pending_post_id = { type: "string" };
  return result;
}
