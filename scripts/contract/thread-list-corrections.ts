import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

export const threadListPath = "/api/v4/users/{user_id}/teams/{team_id}/threads";

// Both handlers parse cursor IDs and a row limit. Neither reads a page number.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/user.go#L3313-L3387
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/user.go#L3981-L4057
export function correctThreadListQuery(source: Fields, newer: Fields): Fields {
  const params = source.parameters;
  const page =
    Array.isArray(params) && params.find((item) => item.name === "page");
  if (
    !isDeepStrictEqual(source, newer) ||
    !Array.isArray(params) ||
    !isDeepStrictEqual(
      params.map((item) => item.name),
      [
        "user_id",
        "team_id",
        "since",
        "deleted",
        "extended",
        "page",
        "per_page",
        "totalsOnly",
        "threadsOnly",
      ],
    ) ||
    page?.in !== "query" ||
    page.required !== false ||
    !isDeepStrictEqual(page.schema, {
      type: "integer",
      default: 0,
    })
  )
    throw Error("Review both GetUserThreads query definitions");
  return {
    ...source,
    parameters: [
      ...params.filter((item) => item.name !== "page"),
      ...["before", "after"].map((name) => ({
        name,
        in: "query",
        schema: { type: "string" },
      })),
      ...["unread", "excludeDirect"].map((name) => ({
        name,
        in: "query",
        schema: { type: "boolean", default: false },
      })),
    ],
  };
}

// The 10.10.1 document calls a participant a Post. Both server versions return a User.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/thread.go#L37-L55
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/thread.go#L37-L55
export function correctThreadListModel(
  name: "UserThread" | "UserThreads",
  source: Fields,
  newer: Fields,
): Fields {
  const fields = object(source.properties, name);
  const integer = { type: "integer", format: "int64" };
  if (name === "UserThreads") {
    const threads = object(fields.threads, "threads");
    if (
      !isDeepStrictEqual(source, newer) ||
      !isDeepStrictEqual(Object.keys(fields).sort(), ["threads", "total"]) ||
      threads.type !== "array" ||
      threads.nullable !== undefined ||
      !isDeepStrictEqual(threads.items, {
        $ref: "#/components/schemas/UserThread",
      })
    )
      throw Error("Review both UserThreads models");
    return {
      ...source,
      properties: {
        ...fields,
        threads: { ...threads, nullable: true },
        total_unread_threads: integer,
        total_unread_mentions: integer,
        total_unread_urgent_mentions: integer,
      },
    };
  }
  const participants = object(fields.participants, "participants");
  const corrected = {
    ...fields,
    participants: {
      ...participants,
      items: { $ref: "#/components/schemas/User" },
    },
  };
  if (
    !isDeepStrictEqual(Object.keys(fields).sort(), [
      "id",
      "last_reply_at",
      "last_viewed_at",
      "participants",
      "post",
      "reply_count",
    ]) ||
    participants.type !== "array" ||
    !isDeepStrictEqual(participants.items, {
      $ref: "#/components/schemas/Post",
    }) ||
    !isDeepStrictEqual({ ...source, properties: corrected }, newer)
  )
    throw Error("Review both UserThread models");
  return {
    ...source,
    properties: {
      ...corrected,
      unread_replies: integer,
      unread_mentions: integer,
      is_urgent: { type: "boolean" },
      delete_at: integer,
    },
  };
}
