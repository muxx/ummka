import { type Fields, object } from "./objects.ts";

function requestSchema(operation: Fields, id: string) {
  const body = object(operation.requestBody, `${id} body`);
  const content = object(body.content, `${id} content`);
  const schema = object(
    object(content["application/json"], `${id} JSON`).schema,
    `${id} schema`,
  );
  if (
    operation.operationId !== id ||
    body.required !== true ||
    schema.type !== "object"
  )
    throw Error(`Review the pinned Mattermost ${id} request`);
  return schema;
}

function createProperties(operation: Fields) {
  const schema = requestSchema(operation, "CreatePost");
  const fields = object(schema.properties, "CreatePost properties");
  const required = schema.required;
  if (
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

function checkPatchProps(operation: Fields) {
  const fields = object(
    requestSchema(operation, "PatchPost").properties,
    "PatchPost properties",
  );
  const props = object(fields.props, "PatchPost.props");
  if (
    props.type !== "string" ||
    Object.hasOwn(props, "additionalProperties") ||
    object(fields.message, "PatchPost.message").type !== "string"
  )
    throw Error("Review PatchPost.props against the pinned Mattermost request");
  return props;
}

// PostPatch.Props is *StringInterface, a JSON object whose values may have different types.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/post.go
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/post.go
export function correctPatchPost(operation: Fields, reference: Fields): Fields {
  const other = object(
    reference["/api/v4/posts/{post_id}/patch"],
    "12.1 post patch",
  );
  checkPatchProps(object(other.put, "12.1 PatchPost"));
  const result = structuredClone(operation);
  const props = checkPatchProps(result);
  props.type = "object";
  props.additionalProperties = true;
  return result;
}
