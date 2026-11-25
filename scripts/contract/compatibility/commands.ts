import assert from "node:assert/strict";
import { executeAccountCommand } from "../../../src/mattermost/execute-account-command.ts";
import { executeSavedCommand } from "../../../src/mattermost/execute-saved-command.ts";
import {
  CommandsApi,
  type Configuration,
  PostsApi,
  ResponseError,
} from "../../../vendor/mattermost/index.js";

export async function checkCommands(
  session: Configuration,
  teamId: string,
  channelId: string,
  version: string,
) {
  const commands = new CommandsApi(session);
  const posts = new PostsApi(session);
  const root = await posts.createPost({
    createPostRequest: { channelId, message: "Command fixture thread" },
  });
  assert.ok(root.id);
  const inThread = { channelId, teamId, rootId: root.id };
  await checkSuggestions(commands, inThread, version);
  const submitted = await executeAccountCommand(
    commands,
    inThread,
    "/ME  checks the draft  ",
  );
  assert.equal(submitted.kind, "executed");
  const me = submitted.response;
  assert.equal(me.responseType, "in_channel");
  assert.equal(me.text, "*checks the draft*");
  assert.equal(me.gotoLocation, "");
  assert.equal(me.triggerId, "");
  assert.equal(me.skipSlackParsing, false);
  const help = await commands.executeCommand({
    executeCommandRequest: { ...inThread, command: "/help" },
  });
  assert.equal(help.responseType, "ephemeral");
  assert.ok(help.text.length);
  const refused = await commands
    .executeCommand({
      executeCommandRequest: { ...inThread, command: "/not-an-ummka-command" },
    })
    .then(
      () => assert.fail("An unknown command must return an HTTP error"),
      (error: unknown) => {
        assert.ok(error instanceof ResponseError);
        return error.response;
      },
    );
  assert.equal(refused.status, 404);
  assert.equal(
    (await refused.json()).id,
    "api.command.execute_command.not_found.app_error",
  );
  const missing = await executeAccountCommand(
    commands,
    inThread,
    "/ummka-unknown-fixture-command",
  );
  assert.equal(missing.kind, "unknownCommand");
  const thread = await posts.getPostThread({ postId: root.id });
  const replies = Object.values(thread.posts ?? {}).filter(
    (post) => post.rootId === root.id,
  );
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.message, me.text);
  assert.equal(replies[0]?.type, "me");
  for (const message of [
    "/me runs a saved draft",
    "/ummka-unknown-saved-command",
  ]) {
    const finishing = message.startsWith("/me ") ? "complete" : "release";
    const transitions: string[] = [];
    const answer = await executeSavedCommand(
      commands,
      async (location, action) => {
        assert.equal(location.channelId, channelId);
        assert.equal(location.rootId, root.id);
        transitions.push(action);
        if (action === "start") {
          assert.equal(location.revision, "original");
          return {
            kind: "saved",
            draft: { message, revision: "attempt", commandPending: true },
          };
        }
        assert.equal(location.revision, "attempt");
        assert.equal(action, finishing);
        return {
          kind: "saved",
          draft: {
            message: action === "complete" ? "" : message,
            revision: "finished",
          },
        };
      },
      inThread,
      "original",
    );
    assert.deepEqual(transitions, ["start", finishing]);
    assert.equal(answer.kind, "answered");
    assert.equal(answer.settlement, "saved");
    assert.equal(
      answer.result.kind,
      finishing === "complete" ? "executed" : "unknownCommand",
    );
  }
  const finalThread = await posts.getPostThread({ postId: root.id });
  assert.equal(
    Object.values(finalThread.posts ?? {}).filter(
      (post) =>
        post.rootId === root.id && post.message === "*runs a saved draft*",
    ).length,
    1,
  );
  console.log(
    `Mattermost ${version} verified an in-thread /me, ephemeral /help and an unknown user command.`,
  );
}

async function checkSuggestions(
  commands: CommandsApi,
  context: { teamId: string; channelId: string; rootId: string },
  version: string,
) {
  const choices = await commands.listAutocompleteCommands({
    teamId: context.teamId,
  });
  const help = choices.find((item) => item.trigger === "help");
  assert.ok(help?.autoComplete);
  const matches = await commands.listCommandAutocompleteSuggestions({
    ...context,
    userInput: "/he",
  });
  assert.ok(
    matches.some(
      (item) => item.complete === "help" && item.suggestion === "help",
    ),
  );
  assert.ok(matches.some((item) => item.complete === "header"));
  assert.deepEqual(
    await commands.listCommandAutocompleteSuggestions({
      ...context,
      userInput: "/not-an-ummka-command",
    }),
    [],
  );
  await assert.rejects(
    commands.listCommandAutocompleteSuggestions({ ...context, userInput: "" }),
    (e: unknown) => e instanceof ResponseError && e.response.status === 400,
  );
  console.log(
    `Mattermost ${version} verified member command choices, in-thread suggestions and empty results.`,
  );
}
