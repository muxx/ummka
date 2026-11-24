import { fireEvent, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "../../src/App.tsx";

export async function checkConnectServer(origin: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<App language="ru" />));
    const ui = within(host);
    const address = `${new URL(origin).host}/entry/team/`;
    const input = ui.getByRole<HTMLInputElement>("textbox", {
      name: "Адрес сервера",
    });
    flushSync(() => fireEvent.input(input, { target: { value: address } }));
    ui.getByRole("button", { name: "Продолжить" }).click();
    const site = await ui.findByRole(
      "heading",
      { name: "Entry fixture" },
      { timeout: 20_000 },
    );
    if (
      site !== document.activeElement ||
      ui
        .getAllByRole("listitem")
        .map((el) => el.textContent)
        .join(",") !== "Пароль,GitLab" ||
      !ui.queryByText(`${origin}/entry/team`)
    )
      throw Error("entry-profile-result");
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
  }
}
