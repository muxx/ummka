import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// Both servers put the retention marker on a forbidden response, not on the post.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/post.go#L458-L466
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/post.go#L608-L617
export function correctSinglePost(
  source: Fields,
  newer: Fields,
  definitions: Fields,
): Fields {
  const id = "GetPost";
  const path = "/api/v4/posts/{post_id}";
  const reference = object(object(newer[path], path).get, id);
  const current = structuredClone(source);
  const responses = object(current.responses, id);
  const updated = object(reference.responses, id);
  const success = object(responses["200"], id);
  const headers = object(success.headers, id);
  const old = object(headers["Has-Inaccessible-Posts"], id);
  if (
    source.operationId !== id ||
    reference.operationId !== id ||
    !isDeepStrictEqual(success, updated["200"]) ||
    !isDeepStrictEqual(Object.keys(headers), ["Has-Inaccessible-Posts"]) ||
    !isDeepStrictEqual(old.schema, { type: "boolean" }) ||
    !isDeepStrictEqual(responses["403"], {
      $ref: "#/components/responses/Forbidden",
    }) ||
    !isDeepStrictEqual(responses["403"], updated["403"]) ||
    Object.hasOwn(responses, "404") ||
    !isDeepStrictEqual(updated["404"], {
      $ref: "#/components/responses/NotFound",
    })
  )
    throw Error("Review the single-post retention and missing-post responses");
  const components = object(definitions.components, id);
  const errors = object(components.responses, "components/responses");
  if (!Object.hasOwn(errors, "Forbidden"))
    throw Error("Missing component responses/Forbidden");
  const forbidden = object(errors.Forbidden, "components/responses/Forbidden");
  delete success.headers;
  responses["403"] = {
    ...forbidden,
    headers: {
      "First-Inaccessible-Post-Time": {
        description:
          "Present when the post falls outside the accessible history.",
        schema: { type: "string", enum: ["1"] },
      },
    },
  };
  responses["404"] = updated["404"];
  return current;
}
