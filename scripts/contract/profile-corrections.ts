import { isDeepStrictEqual } from "node:util";
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

// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/user.go#L383-L427
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/user.go#L562-L607
export function correctProfileImage(source: Fields): Fields {
  const responses = object(source.responses, "profile image responses");
  const success = object(responses["200"], "profile image success");
  if (
    source.operationId !== "GetProfileImage" ||
    success.description !== "User's profile image" ||
    Object.hasOwn(success, "content")
  )
    throw Error("Review the profile image response against the pinned source");
  return {
    ...source,
    responses: {
      ...responses,
      "200": {
        ...success,
        content: {
          "image/png": { schema: { type: "string", format: "binary" } },
        },
      },
    },
  };
}

// The server's User.Timezone is a string map in both releases.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/shared/timezones/timezones.go#L22-L30
// https://github.com/mattermost/mattermost/blob/v12.1.0/api/v4/source/definitions.yaml#L3182-L3195
export function correctProfileTimezone(source: Fields, newer: Fields): Fields {
  const fields = object(source.properties, "Timezone properties");
  const mode = object(
    fields.useAutomaticTimezone,
    "Timezone.useAutomaticTimezone",
  );
  const schemas = object(
    object(newer.components, "components").schemas,
    "schemas",
  );
  const corrected = {
    ...source,
    properties: {
      ...fields,
      useAutomaticTimezone: { ...mode, type: "string" },
    },
  };
  if (
    source.type !== "object" ||
    mode.type !== "boolean" ||
    object(fields.manualTimezone, "Timezone.manualTimezone").type !==
      "string" ||
    object(fields.automaticTimezone, "Timezone.automaticTimezone").type !==
      "string" ||
    !isDeepStrictEqual(corrected, schemas.Timezone)
  ) {
    throw Error("Review the Timezone correction against both pinned sources");
  }
  return corrected;
}

// Both successful branches emit this boolean. The older server does not implement the operation.
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/shared_channel.go#L319-L358
export function correctDmCapability(
  source: Fields,
  baseline: Fields,
  path: string,
) {
  const result = structuredClone(source);
  const success = object(
    object(result.responses, "DM capability responses")["200"],
    "DM capability success",
  );
  const schema = object(
    object(
      object(success.content, "DM capability content")["application/json"],
      "DM capability JSON",
    ).schema,
    "DM capability schema",
  );
  const properties = object(schema.properties, "DM capability properties");
  if (
    Object.hasOwn(baseline, path) ||
    result.operationId !== "CanUserDirectMessage" ||
    schema.type !== "object" ||
    Object.hasOwn(schema, "required") ||
    !isDeepStrictEqual(Object.keys(properties), ["can_dm"]) ||
    object(properties.can_dm, "can_dm").type !== "boolean"
  )
    throw Error("Review the pinned DM capability response");
  schema.required = ["can_dm"];
  return result;
}
