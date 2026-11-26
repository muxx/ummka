import type { openAccountRestConnection } from "../../src/mattermost/native-rest.ts";

export async function checkAccountThreadReadState(
  account: Awaited<ReturnType<typeof openAccountRestConnection>>,
  teamId: string,
  threadId: string,
  timestamp: number,
) {
  const state = await account.markFollowedThreadRead(
    teamId,
    threadId,
    timestamp,
  );
  if (
    state.id !== threadId ||
    state.lastViewedAt !== timestamp ||
    state.unreadReplies !== 3 ||
    state.unreadMentions !== 2
  )
    throw Error(
      "Signed account lost the server's confirmed thread read position or remaining unread counts.",
    );
  await account.markTeamThreadsRead(teamId);
}
