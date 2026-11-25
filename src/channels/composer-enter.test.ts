import { expect, test } from "vitest";
import { composerEnter } from "./composer-enter.ts";

const ordinary = { sendOnCtrlEnter: false, codeBlockOnCtrlEnter: true };
const shortcut = { sendOnCtrlEnter: true, codeBlockOnCtrlEnter: false };
type Field = Parameters<typeof composerEnter>[1];
function decide(
  message: string,
  key: KeyboardEventInit = {},
  options: Partial<Field> = {},
) {
  return composerEnter(new KeyboardEvent("keydown", { key: "Enter", ...key }), {
    message,
    caret: message.length,
    mobile: false,
    preferences: ordinary,
    ...options,
  });
}

test.each([
  { key: "a" },
  { shiftKey: true },
  { altKey: true },
  { metaKey: true, shiftKey: true },
  { isComposing: true },
  { keyCode: 229 },
])("leaves other keys and composition to the field (%o)", (key) => {
  expect(decide("text", key).kind).toBe("native");
});

test("leaves an Enter used by the suggestion picker alone", () => {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    cancelable: true,
  });
  event.preventDefault();
  expect(
    composerEnter(event, {
      message: "/he",
      caret: 3,
      mobile: false,
      preferences: ordinary,
    }).kind,
  ).toBe("native");
});

test.each([{}, { ctrlKey: true }, { metaKey: true }])(
  "leaves mobile and unknown account settings editable (%o)",
  (key) => {
    expect(decide("a", key, { mobile: true }).kind).toBe("native");
    expect(decide("a", key, { preferences: undefined }).kind).toBe("native");
  },
);

test("consumes the channel-switch Enter through 500 ms and preserves a thread's first Enter", () => {
  for (const elapsed of [0, 499, 500]) {
    expect(
      decide("text", {}, { millisecondsSinceChannelSwitch: elapsed }).kind,
    ).toBe("ignore");
    expect(
      decide(
        "text",
        { shiftKey: true },
        { millisecondsSinceChannelSwitch: elapsed },
      ).kind,
    ).toBe("native");
  }
  expect(decide("text", {}, { millisecondsSinceChannelSwitch: 501 }).kind).toBe(
    "submit",
  );
  expect(decide("text")).toEqual({ kind: "submit", message: "text" });
});

test.each(["ctrlKey", "metaKey"] as const)(
  "honours explicit send on %s+Enter",
  (key) => {
    for (const message of ["text", "  "]) {
      expect(decide(message, {}, { preferences: shortcut }).kind).toBe(
        "native",
      );
      expect(
        decide(message, { [key]: true }, { preferences: shortcut }),
      ).toEqual({ kind: "submit", message });
    }
  },
);

test("tests the Markdown fence at the caret, leaving single and inline backticks alone", () => {
  const prefix = "🐻‍❄️ note\n";
  const message = prefix + "```ts\nλ\n```\n";
  expect(decide(message, {}, { caret: prefix.length + 2 }).kind).toBe("submit");
  expect(decide(message, {}, { caret: prefix.length + 3 }).kind).toBe("native");
  expect(decide(message)).toEqual({ kind: "submit", message });
  expect(decide("text ```ts\nline").kind).toBe("submit");
  expect(decide("`inline`").kind).toBe("submit");
});

test("closes an unfinished multiline fence for the send without trimming the draft", () => {
  for (const message of [
    "```sh\necho 🐻",
    "```sh\necho 🐻\n",
    "```sh\necho 🐻\n\n",
  ]) {
    expect(decide(message).kind).toBe("native");
    expect(decide(message, { ctrlKey: true })).toEqual({
      kind: "submit",
      message: message + (message.endsWith("\n") ? "```" : "\n```"),
    });
  }
  expect(decide("```ts", { metaKey: true })).toEqual({
    kind: "submit",
    message: "```ts",
  });
  const disabled = { sendOnCtrlEnter: false, codeBlockOnCtrlEnter: false };
  const open = "```\ncode";
  expect(decide(open, {}, { preferences: disabled })).toEqual({
    kind: "submit",
    message: open,
  });
  expect(decide(open, { ctrlKey: true }, { preferences: shortcut })).toEqual({
    kind: "submit",
    message: open + "\n```",
  });
});
