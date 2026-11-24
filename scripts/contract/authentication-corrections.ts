import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

// v10 and v12 send 200. Login is public and supplies the session in the Token header.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/user.go#L1913-L1920
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/app/login.go#L212-L223
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/user.go#L2106-L2126
export function correctAuthentication(operation: Fields): Fields {
  const login = operation.operationId === "Login";
  if (!login && operation.operationId !== "Logout") return operation;
  const result = structuredClone(operation);
  const responses = object(result.responses, "authentication responses");
  const ok = object(responses["201"], "upstream authentication success");
  const baseline = {
    description: login ? "User login successful" : "User logout successful",
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${login ? "User" : "StatusOK"}` },
      },
    },
  };
  if (Object.hasOwn(responses, "200") || !isDeepStrictEqual(ok, baseline)) {
    throw Error("Review the upstream authentication success response");
  }
  delete responses["201"];
  responses["200"] = ok;
  if (!login) return result;
  if (Object.hasOwn(result, "security"))
    throw Error("Review the upstream Login security requirements");
  result.security = [];
  ok.headers = { Token: { required: true, schema: { type: "string" } } };
  const body = object(result.requestBody, "Login requestBody");
  const json = object(
    object(body.content, "Login content")["application/json"],
    "Login JSON",
  );
  const fields = object(
    object(json.schema, "Login schema").properties,
    "Login properties",
  );
  // The official client sends the string "true" when LDAP-only login is selected.
  // https://github.com/mattermost/mattermost/blob/v12.1.0/webapp/platform/client/src/client4.ts#L842-L868
  if (!isDeepStrictEqual(fields.ldap_only, { type: "boolean" }))
    throw Error("Review the upstream LDAP field");
  fields.ldap_only = { type: "string" };
  for (const name of ["password", "token"]) {
    const field = object(fields[name], `Login ${name}`);
    if (field.type !== "string" || Object.hasOwn(field, "format"))
      throw Error(`Review the upstream Login ${name}`);
    field.format = "password";
  }
  return result;
}
