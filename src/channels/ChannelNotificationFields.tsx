import { type RefObject, useId, useRef } from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { notificationCopy } from "./channel-notification-copy.ts";
import type { ChannelNotificationForm } from "./channel-notification-form.ts";
import { notificationSounds } from "./notification-sounds.ts";

type FormProps = {
  form: ChannelNotificationForm;
  language: EntryLanguage;
  group: boolean;
  collapsed: boolean;
  groupDefaults: { desktop?: string; push?: string };
  changed: () => void;
  play: (sound: (typeof notificationSounds)[number] | "off") => void;
};
type Text = typeof notificationCopy.ru;
const levels = ["all", "mention", "none"] as const;
function label(labels: Record<string, string>, value: string) {
  return Object.hasOwn(labels, value) ? labels[value] : value;
}

function Check({
  title,
  help,
  value,
  disabled,
  change,
  control,
}: {
  title: string;
  help: string;
  value: boolean;
  disabled?: boolean;
  change: (value: boolean) => void;
  control?: RefObject<HTMLInputElement | null>;
}) {
  const helpId = useId();
  return (
    <label className="notify-check">
      <input
        ref={control}
        type="checkbox"
        checked={value}
        aria-disabled={disabled || undefined}
        aria-describedby={help ? helpId : undefined}
        onChange={(event) => !disabled && change(event.target.checked)}
      />
      <span>
        {title}
        <small id={helpId}>{help}</small>
      </span>
    </label>
  );
}
function DeviceSection({
  device,
  form,
  language,
  group,
  groupDefaults,
  collapsed,
  changed,
  play,
}: FormProps & { device: "desktop" | "push" }) {
  const title = useId(),
    fieldset = useRef<HTMLFieldSetElement>(null);
  const t: Text = notificationCopy[language],
    { level, threads } = form.section(device),
    sound = form.sound;
  const replies = collapsed && level.value === "mention",
    audible = device === "desktop" && level.value !== "none";
  const inherited =
    level.inherited &&
    (!replies || threads.inherited) &&
    (!audible || sound.inherited);
  const own = group ? t.ownGroup : t.ownChannel;
  let status = t.follows;
  if (inherited && group && groupDefaults[device] === "mention")
    status += ` ${t.groupRule}`;
  if (!inherited) {
    if (level.value !== level.account)
      status =
        own +
        ". " +
        t.defaultLabel +
        " — " +
        (language === "ru"
          ? `«${label(t.levels, level.account)}»`
          : label(t.levels, level.account)) +
        ".";
    else if (replies && threads.value !== threads.account)
      status =
        t.customThreads +
        ". " +
        t.defaultLabel +
        " — " +
        (threads.account === "all" ? t.threadOn : t.threadOff) +
        ".";
    else if (audible && sound.value !== sound.account)
      status =
        t.customSound +
        ". " +
        t.defaultLabel +
        " — " +
        (language === "ru"
          ? `«${label(t.sounds, sound.account)}»`
          : label(t.sounds, sound.account)) +
        ".";
    else status = `${own}, ${t.same}`;
  }
  return (
    <fieldset className="notify-section" ref={fieldset}>
      <legend>{t[device]}</legend>
      <div className="notify-section-head">
        <p id={title} className={inherited ? "" : "own"}>
          {status}
        </p>
        {!inherited && (
          <button
            type="button"
            className="notify-reset"
            aria-label={`${t.reset} · ${t[device]}`}
            onClick={() => {
              form.resetSection(device);
              changed();
              requestAnimationFrame(() =>
                fieldset.current
                  ?.querySelector<HTMLInputElement>("input[type=radio]:checked")
                  ?.focus({ preventScroll: true }),
              );
            }}
          >
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M3 10a9 9 0 0 1 15.5-4l2 2M21 3v5h-5M21 14a9 9 0 0 1-15.5 4l-2-2M3 21v-5h5" />
            </svg>
            {t.reset}
          </button>
        )}
      </div>
      {levels.map((value) => (
        <label className="notify-option" key={value}>
          <input
            type="radio"
            name={title}
            aria-describedby={title}
            checked={level.value === value}
            onChange={() => {
              form.setLevel(device, value);
              changed();
            }}
          />
          <span>{t.levels[value]}</span>
          {value === level.value && !level.inherited ? (
            <em>{t.own}</em>
          ) : (
            value === level.account && <b>{t.inherited}</b>
          )}
        </label>
      ))}
      {replies && (
        <div className="notify-replies">
          <Check
            title={t.replies}
            value={threads.value === "all"}
            help={
              (threads.inherited ? t.defaultLabel : t.customThreads) +
              " — " +
              (threads.account === "all" ? t.threadOn : t.threadOff) +
              "."
            }
            change={(checked) => {
              form.setThreads(device, checked ? "all" : "mention");
              changed();
            }}
          />
        </div>
      )}
      {audible && (
        <label className="notify-sound">
          <span>{t.sound}</span>
          <span className="notify-select">
            <select
              aria-describedby={title}
              value={sound.value}
              onChange={(event) => {
                const name = event.target.value;
                const selected = ["off" as const, ...notificationSounds].find(
                  (value) => value === name,
                );
                if (!selected) return;
                form.setSound(selected);
                changed();
                play(selected);
              }}
            >
              {!["off", ...notificationSounds].includes(sound.value) && (
                <option disabled value={sound.value}>
                  {sound.value}
                </option>
              )}
              {(["off", ...notificationSounds] as const).map((value) => (
                <option key={value} value={value}>
                  {t.sounds[value]}
                  {value === sound.account ? ` (${t.inherited})` : ""}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="m5 8 5 5 5-5" />
            </svg>
          </span>
          {sound.inherited ? <b>{t.inherited}</b> : <em>{t.own}</em>}
        </label>
      )}
    </fieldset>
  );
}
export function ChannelNotificationFields(
  props: FormProps & { first: RefObject<HTMLInputElement | null> },
) {
  const { form, language, group, changed, collapsed, first } = props,
    t = notificationCopy[language],
    ignore = form.ignoreMentions;
  return (
    <>
      <fieldset>
        <legend>{t.muteSection}</legend>
        <Check
          control={first}
          title={group ? t.muteGroup : t.mute}
          help={t.muteHelp}
          value={form.muted}
          change={(value) => {
            form.setMuted(value);
            changed();
          }}
        />
        <Check
          title={t.ignored}
          value={ignore.value}
          disabled={ignore.blocked}
          help={
            ignore.blocked
              ? t.blocked
              : (ignore.inherited
                  ? ""
                  : `${group ? t.ownGroup : t.ownChannel}. `) +
                (form.muted ? t.ignoreOn : t.ignoreOff)
          }
          change={(value) => {
            form.setIgnoreMentions(value);
            changed();
          }}
        />
      </fieldset>
      {form.muted && (
        <div className="notify-banner">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            stroke="currentColor"
            strokeWidth="1.65"
            fill="none"
          >
            <path d="m3 3 18 18M9.6 4.5A6 6 0 0 1 18 10c0 2.3.4 3.5 1.8 5.5M6.3 7.9A8 8 0 0 0 6 10c0 3-1 4.8-2.4 6.5H16M10 19a2 2 0 0 0 4 0" />
          </svg>
          <div>
            <strong>{group ? t.mutedGroup : t.muted}</strong>
            <p>{t.mutedHelp}</p>
          </div>
        </div>
      )}
      <DeviceSection {...props} device="desktop" />
      <DeviceSection {...props} device="push" />
      {collapsed && (
        <fieldset className="notify-section">
          <legend>{t.threads}</legend>
          <Check
            title={t.follow}
            value={form.followThreads}
            help={t.followHelp}
            change={(value) => {
              form.setFollowThreads(value);
              changed();
            }}
          />
        </fieldset>
      )}
    </>
  );
}
