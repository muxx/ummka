import {
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { EntryLanguage } from "../entry/language";
import { AppearanceMark } from "./AppearanceMark";
import { auroraColors, editableRoles, PaletteError } from "./palette";
import { windowAppearance } from "./window";
import "./dialog.css";

const copy = {
  ru: {
    title: "Оформление",
    close: "Закрыть",
    theme: "Тема",
    name: "Ночь с сиянием",
    mode: "Режим",
    system: "Система",
    light: "Светлый",
    dark: "Тёмный",
    lightMode: "Светлый режим",
    darkMode: "Тёмный режим",
    customized: "свои цвета",
    original: "исходные цвета",
    heading: "Цвета текущего режима",
    navigation: "Навигация",
    selected: "Выбранный канал",
    presence: "Присутствие",
    notification: "Уведомления",
    apply: "Применить цвета",
    doneCustom: "Свои цвета применены",
    doneDefault: "Цвета темы «Ночь с сиянием»",
    reset: "Вернуть исходные цвета",
    contrast: {
      presence:
        "Индикатор присутствия сливается с навигацией. Измените один из этих цветов.",
      notification:
        "Значок уведомления сливается с навигацией. Измените один из этих цветов.",
      selected:
        "Выбранный канал сливается с навигацией. Сделайте его светлее или темнее.",
      text: "Контраст текста слишком низкий. Измените цвет фона.",
      row: "Выбранная строка в списках станет плохо читаемой. Выберите другой цвет выбранного канала.",
    },
    storage: "Не удалось сохранить оформление на устройстве.",
  },
  en: {
    title: "Appearance",
    close: "Close",
    theme: "Theme",
    name: "Aurora Night",
    mode: "Mode",
    system: "System",
    light: "Light",
    dark: "Dark",
    lightMode: "Light mode",
    darkMode: "Dark mode",
    customized: "custom colors",
    original: "default colors",
    heading: "Colors for this mode",
    navigation: "Navigation",
    selected: "Selected channel",
    presence: "Presence",
    notification: "Notifications",
    apply: "Apply colors",
    doneCustom: "Custom colors applied",
    doneDefault: "Aurora Night colors applied",
    reset: "Restore default colors",
    contrast: {
      presence:
        "The presence indicator blends into the navigation. Change either color.",
      notification:
        "The notification badge blends into the navigation. Change either color.",
      selected:
        "The selected channel blends into the navigation. Make the selected channel lighter or darker.",
      text: "The text is hard to read. Change the background color.",
      row: "Selected rows in lists will be hard to read. Choose a different color for the selected channel.",
    },
    storage: "Couldn’t save appearance on this device.",
  },
} as const;

function contrastProblem({ roles: [foreground, background] }: PaletteError) {
  if (background === "row-selected" || background === "row-selected-hover")
    return "row";
  if (
    foreground === "presence" ||
    foreground === "notification" ||
    foreground === "selected"
  )
    return foreground;
  return "text";
}

function outside(dialog: HTMLDialogElement, x: number, y: number) {
  const rect = dialog.getBoundingClientRect();
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

export default function AppearanceDialog({
  language,
  close,
  opener,
  applied,
}: {
  language: EntryLanguage;
  close: () => void;
  applied: (message: string) => void;
  opener: RefObject<HTMLButtonElement | null>;
}) {
  const text = copy[language];
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const fields = useRef<HTMLDivElement>(null);
  const { settings, mode } = useSyncExternalStore(
    windowAppearance.subscribe,
    windowAppearance.getSnapshot,
  );
  const saved = settings.palettes[mode];
  const [colors, setColors] = useState(saved);
  const [error, setError] = useState<{ message: string } | null>(null);
  const paletteKey = [mode, ...editableRoles.map((role) => saved[role])].join(
    "|",
  );
  const [editingKey, setEditingKey] = useState(paletteKey);
  if (paletteKey !== editingKey) {
    setEditingKey(paletteKey);
    setColors(saved);
    setError(null);
  }
  const pressedBackdrop = useRef(false);
  useLayoutEffect(() => {
    const node = dialog.current;
    const button = opener.current;
    node?.showModal();
    return () => {
      node?.close();
      button?.focus();
    };
  }, [opener]);
  useLayoutEffect(() => {
    const scroll = fields.current;
    if (error && scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [error]);
  function edit(action: () => void) {
    try {
      action();
      setError(null);
    } catch (error) {
      if (error instanceof PaletteError && error.roles.length === 2) {
        setError({ message: text.contrast[contrastProblem(error)] });
      } else if (error instanceof DOMException) {
        setError({ message: text.storage });
      } else throw error;
    }
  }
  const custom = editableRoles.some(
    (role) => saved[role].toLowerCase() !== auroraColors[mode][role],
  );
  return (
    <dialog
      ref={dialog}
      className="appearance-dialog modal-layout"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current =
          event.target === dialog.current &&
          outside(event.currentTarget, event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (
          pressedBackdrop.current &&
          event.target === dialog.current &&
          outside(event.currentTarget, event.clientX, event.clientY)
        )
          close();
        pressedBackdrop.current = false;
      }}
    >
      <header>
        <h2 id={title}>{text.title}</h2>
        <button type="button" aria-label={text.close} onClick={close}>
          <AppearanceMark name="close" />
        </button>
      </header>
      <div ref={fields} className="appearance-fields modal-scroll">
        <h3>{text.theme}</h3>
        <div className="appearance-card">
          <span className="appearance-swatch" aria-hidden="true" />
          <div>
            <strong>{text.name}</strong>
            <small>
              {mode === "light" ? text.lightMode : text.darkMode} ·{" "}
              {custom ? text.customized : text.original}
            </small>
          </div>
        </div>
        <h3>{text.mode}</h3>
        <fieldset className="appearance-modes" aria-label={text.mode}>
          {(["system", "light", "dark"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={settings.appearance === value}
              onClick={() =>
                edit(() => {
                  windowAppearance.setAppearance(value);
                  const next = windowAppearance.getSnapshot();
                  setColors(next.settings.palettes[next.mode]);
                })
              }
            >
              <AppearanceMark name={value} />
              {text[value]}
            </button>
          ))}
        </fieldset>
        <h3>{text.heading}</h3>
        <div className="appearance-colors">
          {editableRoles.map((role) => (
            <label key={role}>
              {text[role]}
              <input
                type="color"
                value={colors[role]}
                onChange={(event) => {
                  setColors({ ...colors, [role]: event.currentTarget.value });
                  setError(null);
                }}
              />
            </label>
          ))}
        </div>
        <p role="status">{error?.message}</p>
      </div>
      <footer className="appearance-actions">
        <button
          type="button"
          onClick={() =>
            edit(() => {
              windowAppearance.setColors(mode, colors);
              const isCustom = editableRoles.some(
                (role) =>
                  colors[role].toLowerCase() !== auroraColors[mode][role],
              );
              applied(isCustom ? text.doneCustom : text.doneDefault);
              close();
            })
          }
        >
          {text.apply}
        </button>
        <button
          type="button"
          onClick={() =>
            edit(() => {
              windowAppearance.setColors(mode, auroraColors[mode]);
              setColors(auroraColors[mode]);
            })
          }
        >
          {text.reset}
        </button>
      </footer>
    </dialog>
  );
}
