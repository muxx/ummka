import { isMattermostId } from "./model-fields.ts";

export function orderedItems<T extends { id?: string; channelId?: string }>(
  order: string[] | undefined,
  items: Record<string, T> | undefined,
) {
  if (
    !Array.isArray(order) ||
    !items ||
    typeof items !== "object" ||
    Array.isArray(items)
  )
    throw new TypeError("Invalid Mattermost result list.");
  return order.map((id) => {
    const item = items[id];
    if (
      !isMattermostId(id) ||
      !Object.hasOwn(items, id) ||
      item?.id !== id ||
      !isMattermostId(item.channelId)
    )
      throw new TypeError("Invalid Mattermost result identity.");
    return { ...item, id, channelId: item.channelId };
  });
}
