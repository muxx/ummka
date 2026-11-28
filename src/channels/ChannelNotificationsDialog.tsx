import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type { EntryLanguage } from "../entry/language.ts";
import { ChannelNotificationFields } from "./ChannelNotificationFields.tsx";
import { ContextPanelHeader } from "./ContextPanelHeader.tsx";
import { notificationCopy } from "./channel-notification-copy.ts";
import { ChannelNotificationForm } from "./channel-notification-form.ts";
import { createNotificationSoundPreview } from "./notification-sounds.ts";
import type { WorkspaceConnection } from "./use-workspace-read.ts";
import { workspaceFailure } from "./workspace-data.ts";
import "./channel-notifications-dialog.css";

type Props = {
  account: Pick<
    WorkspaceConnection,
    "readChannelNotifications" | "updateChannelNotifications"
  >;
  channelId: string;
  kind: "O" | "P" | "G";
  name: string;
  language: EntryLanguage;
  online: boolean;
  collapsed: boolean;
  fromInfo?: boolean;
  saved: () => void;
  back: () => void;
  dismiss: () => void;
  sessionIssue: (issue: "session" | "unauthorized") => void;
};
export function ChannelNotificationsDialog(props: Props) {
  const [owner] = useState(() => ({
    account: props.account,
    id: props.channelId,
  }));
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);
  const eligible =
    owner.account === props.account && owner.id === props.channelId;
  useEffect(() => {
    if (!eligible) props.dismiss();
  }, [eligible, props.dismiss]);
  return eligible ? (
    <NotificationDialog key={attempt} {...props} retry={retry} />
  ) : null;
}
function NotificationDialog({
  account,
  channelId,
  kind,
  name,
  language,
  online,
  collapsed,
  fromInfo,
  back,
  dismiss,
  sessionIssue,
  saved,
  retry,
}: Props & { retry: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    first = useRef<HTMLInputElement>(null),
    submit = useRef<HTMLButtonElement>(null),
    saving = useRef<AbortController | null>(null),
    id = useId();
  const [preview] = useState(createNotificationSoundPreview);
  const [state, setState] = useState<{
    form: ChannelNotificationForm;
    defaults: { desktop?: string; push?: string };
  } | null>(null);
  const [error, setError] = useState<
      "readError" | "writeError" | "offline" | "audioError" | null
    >(null),
    [busy, setBusy] = useState(false);
  const [, redraw] = useReducer((n) => n + 1, 0),
    t = notificationCopy[language];
  const failure = useEffectEvent(
    (reason: unknown, phase: "readError" | "writeError") => {
      const problem = workspaceFailure(reason, "network");
      if (problem === "session" || problem === "unauthorized")
        sessionIssue(problem);
      else setError(phase);
    },
  );
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      saving.current?.abort();
      preview.stop();
      element?.close();
    };
  }, [preview]);
  useEffect(() => {
    const request = new AbortController();
    setState(null);
    setError(null);
    void account.readChannelNotifications(channelId, request.signal).then(
      (result) => {
        if (!request.signal.aborted)
          setState({
            form: new ChannelNotificationForm(kind, result),
            defaults: result.account,
          });
      },
      (reason) => {
        if (!request.signal.aborted) failure(reason, "readError");
      },
    );
    return () => request.abort();
  }, [account, channelId, kind]);
  useLayoutEffect(() => {
    if (state) first.current?.focus({ preventScroll: true });
  }, [state]);
  async function save() {
    if (!state || saving.current) return;
    const changes = state.form.changes;
    if (!Object.keys(changes).length) {
      dismiss();
      return;
    }
    if (!online) {
      setError("offline");
      return;
    }
    const request = new AbortController();
    saving.current = request;
    submit.current?.focus({ preventScroll: true });
    setBusy(true);
    setError(null);
    try {
      await account.updateChannelNotifications(
        channelId,
        changes,
        request.signal,
      );
      if (!request.signal.aborted) {
        saved();
        dismiss();
      }
    } catch (reason) {
      if (!request.signal.aborted) {
        const problem = workspaceFailure(reason, "network");
        if (problem === "session" || problem === "unauthorized")
          sessionIssue(problem);
        else setError("writeError");
      }
    } finally {
      if (!request.signal.aborted) {
        saving.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <dialog
      className="channel-notifications-dialog modal-layout"
      data-from-info={fromInfo || undefined}
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        back();
      }}
    >
      <ContextPanelHeader
        id={id}
        title={t.title}
        subtitle={name}
        dialog
        back={{ label: t.back, run: back }}
        close={{
          label: language === "ru" ? "Закрыть" : "Close",
          run: dismiss,
          compact: !fromInfo,
        }}
      />
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="modal-scroll notify-body">
          {state ? (
            <fieldset className="notify-fields" disabled={busy}>
              <ChannelNotificationFields
                first={first}
                form={state.form}
                language={language}
                group={kind === "G"}
                groupDefaults={state.defaults}
                collapsed={collapsed}
                changed={() => {
                  setError(null);
                  redraw();
                }}
                play={(value) => {
                  if (value === "off") {
                    preview.stop();
                    return;
                  }
                  void preview.play(value).catch(() => setError("audioError"));
                }}
              />
            </fieldset>
          ) : (
            !error && <p role="status">{t.loading}</p>
          )}
        </div>
        <footer>
          {error && <p role="alert">{t[error]}</p>}
          <div>
            <button type="button" onClick={back}>
              {t.cancel}
            </button>
            {state ? (
              <button
                ref={submit}
                className="primary"
                type="submit"
                aria-disabled={busy || undefined}
                onPointerDown={(event) => {
                  if (saving.current) event.preventDefault();
                }}
              >
                {t.save}
              </button>
            ) : (
              error && (
                <button className="primary" type="button" onClick={retry}>
                  {t.retry}
                </button>
              )
            )}
          </div>
        </footer>
      </form>
    </dialog>
  );
}
