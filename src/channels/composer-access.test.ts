import { expect, test } from "vitest";
import { channelComposerAccess } from "./composer-access.ts";

const me = "m".repeat(26);
const partner = "p".repeat(26);
const context = {
  permission: "allowed",
  userId: me,
  profiles: new Map(),
  sharedChannelDMs: false,
} as const;
const direct = {
  kind: "D",
  name: `${me}__${partner}`,
  deleteAt: 0,
  shared: false,
};

test("an archived conversation or a deactivated DM partner takes precedence over posting rights", () => {
  const profiles = new Map([[partner, { deleteAt: 12 }]]);
  expect(channelComposerAccess({ ...context, channel: undefined })).toBe(
    "absent",
  );
  for (const kind of ["O", "P", "D", "G"]) {
    const channel = { ...direct, kind, deleteAt: 3, shared: true };
    expect(
      channelComposerAccess({
        ...context,
        channel,
        profiles,
        permission: "denied",
      }),
    ).toBe(kind === "D" ? "deactivated" : "archived");
  }
  for (const name of [`${me}__${partner}`, `${partner}__${me}`]) {
    expect(
      channelComposerAccess({
        ...context,
        channel: { ...direct, name },
        profiles,
      }),
    ).toBe("deactivated");
  }
  expect(channelComposerAccess({ ...context, channel: direct })).toBe(
    "writable",
  );
  expect(
    channelComposerAccess({
      ...context,
      channel: direct,
      profiles: new Map([[me, { deleteAt: 3 }]]),
    }),
  ).toBe("writable");
  expect(
    channelComposerAccess({
      ...context,
      channel: { ...direct, kind: "G" },
      profiles,
    }),
  ).toBe("writable");
});

test("only shared DMs and GMs need the cross-server flag", () => {
  for (const kind of ["D", "G"]) {
    for (const [shared, enabled, result] of [
      [true, true, "writable"],
      [true, false, "sharedDisabled"],
      [true, undefined, "unknown"],
      [false, true, "writable"],
      [false, false, "writable"],
      [false, undefined, "writable"],
      [undefined, true, "writable"],
      [undefined, false, "unknown"],
      [undefined, undefined, "unknown"],
    ] as const) {
      const channel = { ...direct, kind, shared };
      expect(
        channelComposerAccess({
          ...context,
          channel,
          sharedChannelDMs: enabled,
        }),
      ).toBe(result);
      expect(
        channelComposerAccess({
          ...context,
          channel,
          sharedChannelDMs: enabled,
          permission: "denied",
        }),
      ).toBe("readOnly");
      expect(
        channelComposerAccess({
          ...context,
          channel,
          sharedChannelDMs: enabled,
          permission: "unknown",
        }),
      ).toBe(result === "sharedDisabled" ? "sharedDisabled" : "unknown");
    }
  }
  for (const kind of ["O", "P"]) {
    const channel = { ...direct, kind, shared: true };
    expect(channelComposerAccess({ ...context, channel })).toBe("writable");
    expect(
      channelComposerAccess({ ...context, channel, permission: "unknown" }),
    ).toBe("unknown");
  }
});
