import assert from "node:assert/strict";
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
  const me = await commands.executeCommand({
    executeCommandRequest: { ...inThread, command: "/me checks the draft" },
  });
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
  const thread = await posts.getPostThread({ postId: root.id });
  const replies = Object.values(thread.posts ?? {}).filter(
    (post) => post.rootId === root.id,
  );
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.message, me.text);
  assert.equal(replies[0]?.type, "me");
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
