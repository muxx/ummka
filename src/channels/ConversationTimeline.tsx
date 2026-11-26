import type { LocalPost } from "../mattermost/local-history.ts";
import { ChannelTimeline, type TimelineProps } from "./ChannelTimeline.tsx";
import {
  type OutgoingAccount,
  useConversationOutgoing,
} from "./use-conversation-outgoing.tsx";

type Props = TimelineProps & {
  connection: OutgoingAccount;
  userId: string;
  rootId?: string;
  latest: boolean;
  sessionIssue: (issue: "session" | "unauthorized") => void;
};
const noPosts: readonly LocalPost[] = [];

export function ConversationTimeline(props: Props) {
  return (
    <Conversation
      key={JSON.stringify([
        props.connection.rid,
        props.channelId,
        props.rootId,
      ])}
      {...props}
    />
  );
}

function Conversation({
  connection,
  userId,
  rootId,
  sessionIssue,
  latest,
  ...timeline
}: Props) {
  const outgoing = useConversationOutgoing({
    channelId: timeline.channelId,
    history: timeline.page?.posts ?? noPosts,
    locale: timeline.locale,
    connection,
    userId,
    rootId,
    sessionIssue,
    placement: latest ? "timeline" : "hidden",
  });
  return (
    <ChannelTimeline
      {...timeline}
      messages={outgoing.messages}
      ownName={outgoing.ownName}
      localNotice={outgoing.localNotice}
      renderOutgoing={outgoing.renderOutgoing}
    />
  );
}
