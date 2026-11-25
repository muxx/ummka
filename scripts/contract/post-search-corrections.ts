import { isDeepStrictEqual } from "node:util";
import { correctHistorySchema } from "./history-corrections.ts";
import { type Fields, object } from "./objects.ts";

// PostSearchResults embeds PostList and always writes its matches map, including a JSON null.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/public/model/post_search_results.go
export function correctPostSearchResults(schema: Fields, list: Fields): Fields {
  const base = object(
    correctHistorySchema("PostList", list).properties,
    "PostList properties",
  );
  const properties = object(schema.properties, "search properties");
  const matches = object(properties.matches, "search matches");
  if (
    schema.type !== "object" ||
    Object.keys(properties).length !== 3 ||
    !isDeepStrictEqual(base.order, properties.order) ||
    !isDeepStrictEqual(base.posts, properties.posts) ||
    matches.type !== "object" ||
    !isDeepStrictEqual(matches.additionalProperties, {
      type: "array",
      items: { type: "string" },
    }) ||
    Object.hasOwn(matches, "nullable") ||
    Object.hasOwn(schema, "required")
  )
    throw Error(
      "Review the embedded PostList and search matches against Mattermost",
    );
  return {
    ...schema,
    properties: { ...base, matches: { ...matches, nullable: true } },
    required: [
      "order",
      "posts",
      "matches",
      "prev_post_id",
      "next_post_id",
      "first_inaccessible_post_time",
    ],
  };
}
