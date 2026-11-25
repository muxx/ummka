import type { SidebarPreferences } from "../mattermost/workspace-preferences.ts";

type ComposerKey = Pick<
  KeyboardEvent,
  | "key"
  | "keyCode"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "altKey"
  | "isComposing"
  | "defaultPrevented"
>;

type Field = {
  message: string;
  caret: number;
  mobile: boolean;
  preferences: SidebarPreferences["composerKeys"];
  /** Only the main channel field supplies the time since its last channel change. */
  millisecondsSinceChannelSwitch?: number;
};

type EnterDecision =
  | { kind: "native" }
  | { kind: "ignore" }
  | { kind: "submit"; message: string };

export function composerEnter(event: ComposerKey, field: Field): EnterDecision {
  const { message, caret, preferences, millisecondsSinceChannelSwitch } = field;
  if (
    event.key !== "Enter" ||
    field.mobile ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.defaultPrevented ||
    event.shiftKey ||
    event.altKey ||
    !preferences
  )
    return { kind: "native" };

  if (
    millisecondsSinceChannelSwitch !== undefined &&
    millisecondsSinceChannelSwitch >= 0 &&
    millisecondsSinceChannelSwitch <= 500
  )
    return { kind: "ignore" };

  const modified = event.ctrlKey || event.metaKey;
  if (preferences.sendOnCtrlEnter && !modified) return { kind: "native" };
  if (preferences.sendOnCtrlEnter || preferences.codeBlockOnCtrlEnter) {
    // The WebApp counts line-start fences before the caret, including a language tag.
    const fences = message.slice(0, caret).match(/^```/gm);
    if (fences && fences.length % 2 === 1) {
      if (!modified) return { kind: "native" };
      const lines = message.split("\n").filter((line) => line.trim() !== "");
      if (lines.length > 1 && !lines.at(-1)?.includes("```"))
        return {
          kind: "submit",
          message: message + (message.endsWith("\n") ? "```" : "\n```"),
        };
    }
  }
  return { kind: "submit", message };
}
