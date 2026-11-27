import type { EntryLanguage } from "../entry/language.ts";

export function PaneWidthNotice({ language }: { language: EntryLanguage }) {
  return (
    <p className="pane-width-notice" role="status">
      {language === "ru"
        ? "Не удалось сохранить или прочитать ширину панелей на этом устройстве."
        : "Couldn’t save or load pane widths on this device."}
    </p>
  );
}
