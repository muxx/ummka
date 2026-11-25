import { isDeepStrictEqual } from "node:util";
import { type Fields, object } from "./objects.ts";

const listId = "ListAutocompleteCommands";
const suggestionId = "ListCommandAutocompleteSuggestions";

// The member-facing picker consumes a subset of Command. Both official clients read these fields.
// https://github.com/mattermost/mattermost-mobile/blob/v2.29.1/app/components/autocomplete/slash_suggestion/slash_suggestion.tsx#L29-L48
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/command.go
export function autocompleteCommand(
  sourceSchemas: Fields,
  reference: Fields,
): Fields {
  const newer = object(
    object(reference.components, "v12 components").schemas,
    "v12 schemas",
  );
  const properties: Fields = {};
  for (const schemas of [newer, sourceSchemas]) {
    if (Object.hasOwn(schemas, "AutocompleteCommand"))
      throw Error("Review the name of the command picker model");
    const command = object(schemas.Command, "Command");
    const fields = object(command.properties, "Command properties");
    if (
      command.type !== "object" ||
      Object.hasOwn(fields, "autocomplete_icon_data")
    )
      throw Error(
        "Review Command.autocomplete_icon_data in both pinned definitions",
      );
    for (const key of [
      "id",
      "trigger",
      "display_name",
      "auto_complete",
      "auto_complete_hint",
      "auto_complete_desc",
      "icon_url",
    ]) {
      const field = object(fields[key], key);
      if (field.type !== (key === "auto_complete" ? "boolean" : "string"))
        throw Error(`Review the pinned command picker field ${key}`);
      properties[key] = field;
    }
  }
  properties.autocomplete_icon_data = { type: "string" };
  return { type: "object", properties };
}

// Both handlers take team_id from the path. Only suggestions read a channel and optional thread.
// https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/command.go#L374-L447
// https://github.com/mattermost/mattermost/blob/v12.1.0/server/channels/api4/command.go
// Upstream suggestions use five capitalized JSON keys. Their spelling is part of the wire contract.
export function checkAutocompleteSuggestion(
  source: Fields,
  reference: Fields,
): Fields {
  const newer = object(
    object(reference.components, "v12 components").schemas,
    "v12 schemas",
  );
  const expected = [
    "Complete",
    "Description",
    "Hint",
    "IconData",
    "Suggestion",
  ];
  for (const schema of [
    source,
    object(newer.AutocompleteSuggestion, "v12 AutocompleteSuggestion"),
  ]) {
    const fields = object(
      schema.properties,
      "AutocompleteSuggestion properties",
    );
    if (
      schema.type !== "object" ||
      schema.nullable !== undefined ||
      schema.required !== undefined ||
      !isDeepStrictEqual(Object.keys(fields).sort(), expected) ||
      expected.some((key) => {
        const field = object(fields[key], key);
        return field.type !== "string" || field.nullable !== undefined;
      })
    )
      throw Error("Review AutocompleteSuggestion in both pinned definitions");
  }
  return source;
}

export function correctAutocomplete(
  operation: Fields,
  reference: Fields,
  path: string,
): Fields {
  const original = object(
    object(reference[path], path).get,
    "v12 autocomplete",
  );
  const corrected = structuredClone(operation);
  const id = operation.operationId;
  const list = id === listId;
  if (!list && id !== suggestionId)
    throw Error("Unknown autocomplete operation");

  function inspect(version: Fields) {
    const responses = object(version.responses, "autocomplete responses");
    const success = object(responses["200"], "autocomplete success");
    const content = object(success.content, "autocomplete content");
    const schema = object(
      object(content["application/json"], "autocomplete JSON").schema,
      "autocomplete rows",
    );
    const parameters = version.parameters;
    const names = list ? ["team_id"] : ["team_id", "user_input"];
    if (
      version.operationId !== id ||
      !Array.isArray(parameters) ||
      !isDeepStrictEqual(
        parameters.map((p) => p.name),
        names,
      ) ||
      parameters.some(
        (p) =>
          p.in !== (p.name === "team_id" ? "path" : "query") ||
          p.required !== true ||
          p.schema?.type !== "string",
      ) ||
      schema.type !== "array" ||
      !isDeepStrictEqual(schema.items, {
        $ref: list
          ? "#/components/schemas/Command"
          : "#/components/schemas/AutocompleteSuggestion",
      })
    )
      throw Error("Review autocomplete against both tagged operations");
    return { schema, parameters };
  }

  inspect(original);
  const { schema, parameters } = inspect(corrected);
  if (list) schema.items = { $ref: "#/components/schemas/AutocompleteCommand" };
  else
    for (const name of ["channel_id", "root_id"])
      parameters.push({
        name,
        in: "query",
        required: false,
        schema: { type: "string" },
      });
  return corrected;
}
