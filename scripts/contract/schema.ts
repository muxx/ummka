import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import nativeAuth from "../../contracts/mattermost/native-auth.json" with {
  type: "json",
};
import catalog from "../../contracts/mattermost/operations.json" with {
  type: "json",
};
import { correctAuthentication } from "./authentication-corrections.ts";
import {
  correctChannelStats,
  correctChannelStatsQuery,
} from "./channel-audience-corrections.ts";
import { singleChannelMember } from "./channel-member-correction.ts";
import { correctChannelNotifyProps } from "./channel-notify-props.ts";
import {
  autocompleteCommand,
  checkAutocompleteSuggestion,
  correctAutocomplete,
} from "./command-autocomplete.ts";
import {
  correctCommandResponse,
  correctExecuteCommand,
} from "./command-corrections.ts";
import { correctCustomEmoji } from "./custom-emoji-correction.ts";
import {
  correctFileModel,
  correctFileSearch,
} from "./file-search-corrections.ts";
import {
  checkChannelGroupMap,
  correctAssociatedGroup,
  correctGroupAssociations,
} from "./group-association-corrections.ts";
import {
  correctGroupAudienceModel,
  correctGroupAudienceResponse,
} from "./group-audience-correction.ts";
import {
  correctHistoryQuery,
  correctHistorySchema,
} from "./history-corrections.ts";
import { correctMentionGroup } from "./mention-group-correction.ts";
import { correctNullableList } from "./nullable-list-corrections.ts";
import { type Fields, object } from "./objects.ts";
import { checkPathParameters } from "./path-parameters.ts";
import {
  checkPostInfoOperation,
  postInfoSchema,
} from "./post-info-correction.ts";
import {
  correctCreatePost,
  correctPatchPost,
} from "./post-mutation-corrections.ts";
import { correctPostSearchResults } from "./post-search-corrections.ts";
import {
  correctProfileImage,
  correctUserProfile,
} from "./profile-corrections.ts";
import {
  correctReaction,
  correctSaveReaction,
} from "./reaction-corrections.ts";
import {
  correctBulkChannelView,
  correctChannelView,
  correctSetPostUnread,
  correctUnreadAt,
} from "./read-state-corrections.ts";
import {
  correctDirectoryFlags,
  correctSidebarResponse,
  correctSidebarSchema,
} from "./sidebar-corrections.ts";
import { correctSinglePost } from "./single-post-correction.ts";
import { correctTeamMemberRequest } from "./team-member-correction.ts";

const methods = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

export function readSource(directory: string, file: string): Fields {
  const source: unknown = parse(readFileSync(join(directory, file), "utf8"));
  return object(source, file);
}

function checkRequestBody(
  id: string,
  kind: string | undefined,
  operation: Fields,
) {
  if (kind === undefined) {
    if (Object.hasOwn(operation, "requestBody"))
      throw new Error(`Unexpected request body on ${id}`);
    return;
  }
  if (kind !== "json") throw new Error(`Unsupported catalog body on ${id}`);
  const body = object(operation.requestBody, `${id} requestBody`);
  const content = object(body.content, `${id} requestBody.content`);
  if (
    body.required !== true ||
    Object.keys(content).length !== 1 ||
    !Object.hasOwn(content, "application/json")
  )
    throw new Error(`Expected a required application/json body on ${id}`);
  object(
    object(content["application/json"], id).schema,
    `${id} request body schema`,
  );
}

export function buildSpecification(
  read: (file: string) => Fields,
  operations: ReadonlyArray<{
    file: string;
    path: string;
    method: string;
    id: string;
    body?: string;
  }> = catalog,
) {
  const introduction = read("introduction.yaml");
  const definitions = read("definitions.yaml");
  const original = object(definitions.components, "components");
  const components: Record<string, Fields> = Object.create(null);
  const paths: Record<string, Fields> = Object.create(null);

  function includeComponent(kind: string, name: string) {
    components[kind] ??= Object.create(null);
    const group = components[kind];
    if (Object.hasOwn(group, name)) return;
    const upstream = object(original[kind], `components/${kind}`);
    if (kind === "schemas" && name === "PostInfo") {
      group[name] = postInfoSchema(upstream, read("definitions-12.1.0.yaml"));
      visit(group[name]);
      return;
    }
    if (kind === "schemas" && name === "AutocompleteCommand") {
      group[name] = autocompleteCommand(
        upstream,
        read("definitions-12.1.0.yaml"),
      );
      return;
    }
    if (!Object.hasOwn(upstream, name))
      throw new Error(`Missing component ${kind}/${name}`);
    const source = object(upstream[name], `components/${kind}/${name}`);
    if (kind !== "schemas") group[name] = source;
    else if (name === "ChannelNotifyProps")
      group[name] = correctChannelNotifyProps(
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "ChannelMemberCountByGroup")
      group[name] = correctGroupAudienceModel(
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "GroupsAssociatedToChannels")
      group[name] = checkChannelGroupMap(
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "GroupWithSchemeAdmin")
      group[name] = correctAssociatedGroup(
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "Group")
      group[name] = correctMentionGroup(
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "FileInfo" || name === "FileInfoList")
      group[name] = correctFileModel(
        name,
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "PostListWithSearchMatches")
      group[name] = correctPostSearchResults(
        source,
        object(upstream.PostList, "PostList"),
      );
    else if (name === "Emoji")
      group[name] = correctCustomEmoji(source, read("definitions-12.1.0.yaml"));
    else if (name === "Reaction")
      group[name] = correctReaction(source, read("definitions-12.1.0.yaml"));
    else if (name === "ChannelStats")
      group[name] = correctChannelStats(
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "ChannelUnreadAt")
      group[name] = correctUnreadAt(source, read("definitions-12.1.0.yaml"));
    else if (name === "Channel" || name === "Team")
      group[name] = correctDirectoryFlags(
        name,
        correctSidebarSchema(name, correctHistorySchema(name, source)),
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "AutocompleteSuggestion")
      group[name] = checkAutocompleteSuggestion(
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "CommandResponse")
      group[name] = correctCommandResponse(
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "User") group[name] = correctUserProfile(source);
    else
      group[name] = correctSidebarSchema(
        name,
        correctHistorySchema(name, source),
      );
    visit(group[name]);
  }

  function visit(value: unknown) {
    if (value === null || typeof value !== "object") return;
    if ("$ref" in value) {
      const ref = value.$ref;
      const match =
        typeof ref === "string" &&
        /^#\/components\/([\w.-]+)\/([\w.-]+)$/.exec(ref);
      if (!match) throw new Error(`Unsupported OpenAPI reference ${ref}`);
      includeComponent(match[1], match[2]);
    }
    for (const item of Object.values(value)) visit(item);
  }

  function includeSecurity(requirements: unknown) {
    if (!Array.isArray(requirements))
      throw new Error("Expected OpenAPI security requirements");
    for (const requirement of requirements) {
      for (const name of Object.keys(
        object(requirement, "security requirement"),
      )) {
        includeComponent("securitySchemes", name);
      }
    }
  }

  includeSecurity(definitions.security);
  for (const { file, path, method: verb, id, body } of operations) {
    const method = verb.toLowerCase();
    if (!methods.has(method) || verb !== verb.toUpperCase())
      throw new Error(`Invalid HTTP method in the operation catalog: ${verb}`);
    if (!path.startsWith("/api/v4/"))
      throw new Error(`Expected a REST v4 path: ${path}`);
    const sourcePath = object(read(file)[path], path);
    const originalOperation = object(sourcePath[method], `${method} ${path}`);
    let operation = originalOperation;
    if (id === "SetPostUnread")
      operation = correctSetPostUnread(
        originalOperation,
        read("posts-12.1.0.yaml"),
        path,
      );
    else if (id === "SearchFiles" || id === "SearchFilesInAllTeams")
      operation = correctFileSearch(
        path,
        originalOperation,
        read("files-12.1.0.yaml"),
      );
    if (operation.operationId !== id)
      throw new Error(`Expected operation ${id} at ${method} ${path}`);
    if (id === "GetReactions" || id === "DeleteReaction") {
      const newerPath = object(read("reactions-12.1.0.yaml")[path], path);
      const components = object(
        read("definitions-12.1.0.yaml").components,
        "components",
      );
      checkPathParameters(
        path,
        newerPath,
        object(newerPath[method], id),
        components,
      );
    }
    if (id === "GetPostInfo")
      checkPostInfoOperation(read("posts.yaml"), path, operation);
    checkPathParameters(path, sourcePath, operation, original);
    checkRequestBody(id, body, operation);
    paths[path] ??= Object.fromEntries(
      Object.entries(sourcePath).filter(([key]) => !methods.has(key)),
    );
    if (id === "GetPostsForChannel")
      paths[path][method] = correctHistoryQuery(
        operation,
        read("posts-12.1.0.yaml"),
        path,
      );
    else if (id === "GetPost")
      paths[path][method] = correctSinglePost(
        operation,
        read("posts-12.1.0.yaml"),
        definitions,
      );
    else if (id === "AddTeamMember")
      paths[path][method] = correctTeamMemberRequest(
        operation,
        read("teams-12.1.0.yaml"),
      );
    else if (id === "AddChannelMember")
      paths[path][method] = singleChannelMember(
        operation,
        read("channels-12.1.0.yaml"),
      );
    else if (id === "SaveReaction")
      paths[path][method] = correctSaveReaction(
        operation,
        read("reactions-12.1.0.yaml"),
      );
    else if (id === "CreatePost")
      paths[path][method] = correctCreatePost(
        operation,
        read("posts-12.1.0.yaml"),
      );
    else if (id === "PatchPost")
      paths[path][method] = correctPatchPost(
        operation,
        read("posts-12.1.0.yaml"),
      );
    else if (
      id === "GetGroupsByTeam" ||
      id === "GetGroupsAssociatedToChannelsByTeam"
    )
      paths[path][method] = correctGroupAssociations(
        id,
        path,
        operation,
        read("groups-12.1.0.yaml"),
      );
    else if (id === "GetChannelMemberCountsByGroup")
      paths[path][method] = correctGroupAudienceResponse(
        operation,
        read("channels-12.1.0.yaml"),
      );
    else if (id === "GetChannelStats")
      paths[path][method] = correctChannelStatsQuery(
        operation,
        read("channels-12.1.0.yaml"),
      );
    else if (id === "ViewChannel")
      paths[path][method] = correctChannelView(
        operation,
        read("channels-12.1.0.yaml"),
        path,
      );
    else if (id === "MarkChannelsReadForUser")
      paths[path][method] = correctBulkChannelView(
        operation,
        read("channels.yaml"),
        path,
      );
    else if (
      id === "ListAutocompleteCommands" ||
      id === "ListCommandAutocompleteSuggestions"
    )
      paths[path][method] = correctAutocomplete(
        operation,
        read("commands-12.1.0.yaml"),
        path,
      );
    else if (id === "ExecuteCommand")
      paths[path][method] = correctExecuteCommand(
        operation,
        read("commands-12.1.0.yaml"),
      );
    else if (
      id === "GetReactions" ||
      id === "GetRolesByNames" ||
      id === "GetPreferences" ||
      id === "GetChannelMembersTimezones"
    )
      paths[path][method] = correctNullableList(
        id,
        operation,
        read(file.replace(".yaml", "-12.1.0.yaml")),
      );
    else if (id === "GetSidebarCategoriesForTeamForUser")
      paths[path][method] = correctSidebarResponse(operation);
    else if (id === "GetProfileImage")
      paths[path][method] = correctProfileImage(operation);
    else paths[path][method] = correctAuthentication(operation);
    if (Object.hasOwn(operation, "security"))
      includeSecurity(operation.security);
  }
  visit(paths);

  return {
    openapi: introduction.openapi,
    info: introduction.info,
    servers: introduction.servers,
    security: definitions.security,
    paths,
    components,
  };
}

if (import.meta.main) {
  const [directory, destination, nativeDestination] = process.argv.slice(2);
  if (!directory || !destination)
    throw new Error("Expected a source directory and output file");
  const specification = buildSpecification((file) =>
    readSource(directory, file),
  );
  writeFileSync(destination, `${JSON.stringify(specification, null, 2)}\n`);
  if (nativeDestination) {
    const auth = buildSpecification(
      (file) => readSource(directory, file),
      nativeAuth,
    );
    writeFileSync(nativeDestination, `${JSON.stringify(auth, null, 2)}\n`);
  }
}
