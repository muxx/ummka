import { writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import nativeAuth from "../../contracts/mattermost/native-auth.json" with {
  type: "json",
};
import nativeFiles from "../../contracts/mattermost/native-files.json" with {
  type: "json",
};
import nativeUploads from "../../contracts/mattermost/native-uploads.json" with {
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
import {
  autocompleteCommand,
  checkAutocompleteSuggestion,
  correctAutocomplete,
} from "./command-autocomplete.ts";
import {
  correctCommandResponse,
  correctExecuteCommand,
} from "./command-corrections.ts";
import { correctConversationCreation } from "./conversation-creation-correction.ts";
import { correctCustomEmoji } from "./custom-emoji-correction.ts";
import { correctFileContent } from "./file-content-correction.ts";
import {
  correctFileModel,
  correctFileSearch,
} from "./file-search-corrections.ts";
import { correctFileUpload } from "./file-upload-contract.ts";
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
  checkEditHistoryOperation,
  correctFlaggedPosts,
  correctHistoryQuery,
  correctHistorySchema,
  correctRedactedFileCount,
} from "./history-corrections.ts";
import { correctMentionGroup } from "./mention-group-correction.ts";
import { correctNotificationProps } from "./notification-props.ts";
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
  correctProfileTimezone,
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
  correctSidebarWrite,
  sidebarWriteCorrections,
} from "./sidebar-corrections.ts";
import { correctSinglePost } from "./single-post-correction.ts";
import { snapshotSources } from "./sources.ts";
import { correctTeamMemberRequest } from "./team-member-correction.ts";
import {
  correctThreadListModel,
  correctThreadListQuery,
} from "./thread-list-corrections.ts";
import { correctThreadMutation } from "./thread-mutation-correction.ts";
import { correctUserStatus } from "./user-status-correction.ts";

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
  if (kind !== "json" && kind !== "multipart")
    throw new Error(`Unsupported catalog body on ${id}`);
  const mediaType =
    kind === "json" ? "application/json" : "multipart/form-data";
  const body = object(operation.requestBody, `${id} requestBody`);
  const content = object(body.content, `${id} requestBody.content`);
  if (
    body.required !== true ||
    Object.keys(content).length !== 1 ||
    !Object.hasOwn(content, mediaType)
  )
    throw new Error(`Expected a required ${mediaType} body on ${id}`);
  object(object(content[mediaType], id).schema, `${id} request body schema`);
}

export function buildSpecification(
  read: (file: string) => Fields,
  operations: ReadonlyArray<{
    file: string;
    path: string;
    method: string;
    id: string;
    body?: string;
  }> = [...catalog, ...nativeFiles, ...nativeUploads],
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
    else if (name === "ChannelBookmark") {
      // v12 adds externally managed board bookmarks, without changing link or file rows.
      // https://github.com/mattermost/mattermost/blob/v12.1.0/server/public/model/channel_bookmark.go#L14-L66
      const schemas = object(
        object(read("definitions-12.1.0.yaml").components, "components")
          .schemas,
        "schemas",
      );
      const newer = object(schemas.ChannelBookmark, name);
      const fields = object(source.properties, name);
      const { target_id, ...shared } = object(newer.properties, name);
      if (
        !isDeepStrictEqual(fields.type, {
          type: "string",
          enum: ["link", "file"],
        }) ||
        Object.hasOwn(fields, "target_id") ||
        object(target_id, "target_id").type !== "string" ||
        !isDeepStrictEqual(
          {
            ...source,
            properties: {
              ...fields,
              type: { type: "string", enum: ["link", "file", "board"] },
            },
          },
          { ...newer, properties: shared },
        )
      )
        throw new Error(
          "Review ChannelBookmark against both pinned server models",
        );
      group[name] = newer;
    } else if (name === "Status")
      group[name] = correctUserStatus(source, read("definitions-12.1.0.yaml"));
    else if (name === "UserThreads" || name === "UserThread")
      group[name] = correctThreadListModel(
        name,
        source,
        object(
          object(
            object(read("definitions-12.1.0.yaml").components, "components")
              .schemas,
            "schemas",
          )[name],
          name,
        ),
      );
    else if (name === "PostMetadata")
      group[name] = correctHistorySchema(
        name,
        correctRedactedFileCount(source, read("definitions-12.1.0.yaml")),
      );
    else if (name === "Timezone")
      group[name] = correctProfileTimezone(
        source,
        read("definitions-12.1.0.yaml"),
      );
    else if (name === "ChannelNotifyProps" || name === "UserNotifyProps")
      group[name] = correctNotificationProps(
        name,
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
    else if (id === "ListChannelBookmarksForChannel") {
      // v10.10.1's handler encodes the list without writing a status (HTTP 200).
      // https://github.com/mattermost/mattermost/blob/v10.10.1/server/channels/api4/channel_bookmark.go#L432-L441
      const newerPath = object(read("bookmarks-12.1.0.yaml")[path], path);
      const newer = object(newerPath.get, id);
      const responses = object(originalOperation.responses, id);
      const { "201": success, ...otherResponses } = responses;
      operation = {
        ...originalOperation,
        responses: { ...otherResponses, "200": success },
      };
      if (!success || !isDeepStrictEqual(operation, newer))
        throw new Error("Unrecognized channel bookmark list contract");
    } else if (id === "UploadFile")
      operation = correctFileUpload(
        originalOperation,
        read("files-12.1.0.yaml"),
      );
    else if (nativeFiles.some((file) => file.id === id))
      operation = correctFileContent(
        originalOperation,
        read("files-12.1.0.yaml"),
        path,
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
    if (id === "GetEditHistoryForPost")
      checkEditHistoryOperation(read("posts.yaml"), path, sourcePath);
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
    else if (id === "GetFlaggedPostsForUser")
      paths[path][method] = correctFlaggedPosts(
        operation,
        read("posts-12.1.0.yaml"),
      );
    else if (id === "GetPost")
      paths[path][method] = correctSinglePost(
        operation,
        read("posts-12.1.0.yaml"),
        definitions,
      );
    else if (id === "GetUserThreads")
      paths[path][method] = correctThreadListQuery(
        operation,
        object(object(read("users-12.1.0.yaml")[path], path)[method], id),
      );
    else if (
      id === "UpdateThreadReadForUser" ||
      id === "UpdateThreadsReadForUser" ||
      id === "StartFollowingThread" ||
      id === "StopFollowingThread"
    )
      paths[path][method] = correctThreadMutation(
        operation,
        object(object(read("users-12.1.0.yaml")[path], path)[method], id),
      );
    else if (id === "CreateDirectChannel" || id === "CreateGroupChannel")
      paths[path][method] = correctConversationCreation(
        id,
        operation,
        object(object(read("channels-12.1.0.yaml")[path], path)[method], id),
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
      id === "GetFileInfosForPost" ||
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
    else if (sidebarWriteCorrections.has(id))
      paths[path][method] = correctSidebarWrite(
        id,
        operation,
        object(object(read("channels-12.1.0.yaml")[path], path)[method], id),
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
  const read = snapshotSources(directory);
  const specification = `${JSON.stringify(buildSpecification(read), null, 2)}\n`;
  const auth = nativeDestination && {
    path: nativeDestination,
    contents: `${JSON.stringify(buildSpecification(read, nativeAuth), null, 2)}\n`,
  };
  // Validate both schemas before replacing either output.
  writeFileSync(destination, specification);
  if (auth) writeFileSync(auth.path, auth.contents);
}
