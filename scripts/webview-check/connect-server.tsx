import {
  fireEvent,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";
import { isMobile } from "../../src/build-platform.ts";
import { sessionText } from "../../src/entry/session-text.ts";

import {
  forgetInstallation,
  readInstallationSelection,
} from "../../src/mattermost/installation-registry.ts";

export async function checkConnectServer(origin: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<App language="ru" />));
    const ui = within(host);
    const address = `${new URL(origin).host}/entry/team/`;
    const opening = () => ui.queryByText(sessionText.ru.opening);
    if (opening())
      await waitForElementToBeRemoved(opening, { timeout: 20_000 });
    const input = ui.getByRole<HTMLInputElement>("textbox", {
      name: "Адрес сервера",
    });
    flushSync(() => fireEvent.input(input, { target: { value: address } }));
    ui.getByRole("button", { name: "Продолжить" }).click();
    const site = await ui.findByRole(
      "heading",
      { name: "Как войти?" },
      { timeout: 20_000 },
    );
    const provider = ui.getByRole("button", { name: "GitLab" });
    if (
      document.activeElement !== (isMobile ? site : provider) ||
      !ui.queryByText("Entry fixture") ||
      !ui.queryByTitle(`${origin}/entry/team`) ||
      !ui.queryByText("Пароль") ||
      ui.queryByRole("button", { name: "Пароль" })
    )
      throw Error("entry-profile-result");
    if ((await readInstallationSelection()).selected !== `${origin}/entry/team`)
      throw Error("entry-profile-not-selected");
    flushSync(() =>
      ui.getByRole("button", { name: "Изменить адрес сервера" }).click(),
    );
    const restored = ui.getByRole<HTMLInputElement>("textbox", {
      name: "Адрес сервера",
    });
    if (restored.value !== address || document.activeElement !== restored)
      throw Error("entry-profile-back");
  } finally {
    root.unmount();
    host.remove();
    await forgetInstallation(`${origin}/entry/team`);
  }
}
