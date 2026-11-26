import type {
  ChannelNotifyProps,
  UserNotifyProps,
} from "../../vendor/mattermost/index.js";

type Device = "desktop" | "push";
type Level = "all" | "mention" | "none";
type Threads = Exclude<Level, "none">;
type DesktopSound =
  | "off"
  | "Bing"
  | "Crackle"
  | "Down"
  | "Hello"
  | "Ripple"
  | "Upstairs";
type ChannelKind = "O" | "P" | "G";
type NotificationSource = {
  account: UserNotifyProps;
  channel: ChannelNotifyProps;
};
const threadField = {
  desktop: "desktopThreads",
  push: "pushThreads",
} as const;
const fieldDefault = {
  desktop: "default",
  push: "default",
  desktopThreads: "default",
  pushThreads: "default",
  markUnread: "all",
  ignoreChannelMentions: "default",
  desktopSound: "default",
  desktopNotificationSound: "default",
  channelAutoFollowThreads: "off",
} as const;
type Field = keyof typeof fieldDefault;

function choice(stored: string, account: string) {
  const inherited = stored === "default";
  return { value: inherited ? account : stored, account, inherited };
}

export class ChannelNotificationForm {
  private readonly account: UserNotifyProps;
  private readonly stored: ChannelNotifyProps;
  private readonly edits: ChannelNotifyProps = {};
  private readonly kind: ChannelKind;

  constructor(kind: ChannelKind, source: NotificationSource) {
    this.kind = kind;
    this.account = { ...source.account };
    this.stored = { ...source.channel };
  }

  get changes(): ChannelNotifyProps {
    return { ...this.edits };
  }

  private read(field: Field) {
    return this.edits[field] ?? this.stored[field] ?? fieldDefault[field];
  }

  private set(field: Field, value: string) {
    if (value === (this.stored[field] ?? fieldDefault[field]))
      delete this.edits[field];
    else this.edits[field] = value;
  }

  section(device: Device) {
    const account = this.account[device] ?? "all";
    return {
      level: choice(
        this.read(device),
        this.kind === "G" && account === "mention" ? "all" : account,
      ),
      threads: choice(
        this.read(threadField[device]),
        this.account[threadField[device]] ?? "all",
      ),
    };
  }

  setLevel(device: Device, level: Level) {
    this.set(
      device,
      level === this.section(device).level.account ? "default" : level,
    );
  }

  setThreads(device: Device, level: Threads) {
    this.set(
      threadField[device],
      level === this.section(device).threads.account ? "default" : level,
    );
  }

  resetSection(device: Device) {
    this.set(device, "default");
    this.set(threadField[device], "default");
    if (device === "desktop") {
      this.set("desktopSound", "default");
      this.set("desktopNotificationSound", "default");
    }
  }

  get sound() {
    const enabled = this.read("desktopSound");
    const melody = this.read("desktopNotificationSound");
    const accountMelody = this.account.desktopNotificationSound || "Bing";
    const accountEnabled = this.account.desktopSound !== "false";
    const active =
      enabled === "on" || (enabled === "default" && accountEnabled);
    return {
      value: active ? (melody === "default" ? accountMelody : melody) : "off",
      account: accountEnabled ? accountMelody : "off",
      inherited: enabled === "default" && melody === "default",
    };
  }

  setSound(value: DesktopSound) {
    if (value === this.sound.account) {
      this.set("desktopSound", "default");
      this.set("desktopNotificationSound", "default");
    } else if (value === "off") {
      this.set("desktopSound", "off");
      delete this.edits.desktopNotificationSound;
    } else {
      this.set("desktopSound", "on");
      this.set("desktopNotificationSound", value);
    }
  }

  get muted() {
    return this.read("markUnread") === "mention";
  }

  setMuted(muted: boolean) {
    this.set("markUnread", muted ? "mention" : "all");
  }

  get ignoreMentions() {
    const stored = this.read("ignoreChannelMentions");
    const blocked = this.account.channel === "false";
    return {
      value: blocked || (stored === "default" ? this.muted : stored === "on"),
      inherited: stored === "default",
      blocked,
    };
  }

  setIgnoreMentions(ignore: boolean) {
    if (this.ignoreMentions.blocked) return;
    this.set(
      "ignoreChannelMentions",
      ignore === this.muted ? "default" : ignore ? "on" : "off",
    );
  }

  get followThreads() {
    return this.read("channelAutoFollowThreads") === "on";
  }

  setFollowThreads(follow: boolean) {
    this.set("channelAutoFollowThreads", follow ? "on" : "off");
  }
}
