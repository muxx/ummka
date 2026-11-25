import { type Fields, object } from "./objects.ts";

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/user.go#L83-L109
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/user.go#L97-L124
export function correctUserProfile(source: Fields): Fields {
  const fields = object(source.properties, "User properties");
  const missing = {
    position: { type: "string" },
    is_bot: { type: "boolean" },
    remote_id: { type: "string" },
  };
  if (
    source.type !== "object" ||
    object(fields.username, "User.username").type !== "string" ||
    object(fields.last_picture_update, "User.last_picture_update").format !==
      "int64" ||
    Object.keys(missing).some((name) => Object.hasOwn(fields, name))
  )
    throw Error("Review the User profile correction against the pinned source");
  return { ...source, properties: { ...fields, ...missing } };
}
