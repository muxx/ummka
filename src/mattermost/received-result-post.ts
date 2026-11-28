import type { Post } from "../../vendor/mattermost/index.js";
import { receivedIntegrationCards } from "./integration-cards.ts";
import { receivedPostAttachments } from "./post-attachments.ts";

export function receivedResultPost<T extends Post>(post: T) {
  const attachments = receivedPostAttachments(post);
  return {
    ...post,
    cards: receivedIntegrationCards(post, "complete"),
    ...(attachments !== undefined && { attachments }),
  };
}

export type ReceivedResultPost = ReturnType<typeof receivedResultPost>;
