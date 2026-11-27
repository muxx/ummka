import { fireEvent, waitFor, within } from "@testing-library/dom";
import { flushSync } from "react-dom";

const labels = {
  en: {
    title: "Message actions",
    option: "Copy link",
    copied: "Message link copied.",
    denied: "Couldn’t copy the link.",
  },
  ru: {
    title: "Действия с сообщением",
    option: "Скопировать ссылку",
    copied: "Ссылка на сообщение скопирована.",
    denied: "Не удалось скопировать ссылку.",
  },
};

export function openThreadFromMessageMenu(origin: HTMLElement) {
  flushSync(() => fireEvent.click(origin));
  const menu = within(document.body).getByRole("dialog", {
    name: "Message actions",
  });
  const reply = within(menu).getByRole("button", { name: "Reply in thread" });
  if (document.activeElement !== reply)
    throw Error("The message menu did not focus its first action");
  flushSync(() => fireEvent.click(reply));
  if (menu.isConnected) throw Error("Opening the thread left its menu open");
}

export async function checkRowPermalink(
  row: HTMLElement,
  expected: string,
  deny = false,
  language: "en" | "ru" = "en",
) {
  // Intercept writes only inside this disposable document. Never access the system clipboard.
  if (typeof navigator.clipboard?.writeText !== "function")
    throw Error("The application WebView does not expose clipboard writes");
  const { title, option, copied, denied } = labels[language];
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(value: string) {
        writes.push(value);
        if (deny) throw Error("Fixture clipboard denied");
      },
    },
  });
  try {
    const origin = within(row).getByRole("button", {
      name: new RegExp(`^${title}(?: · .+)?$`),
    });
    flushSync(() => fireEvent.click(origin));
    const menu = await within(document.body).findByRole("dialog", {
      name: title,
    });
    const action = within(menu).getByRole("button", { name: option });
    if (
      document.activeElement !==
      menu.querySelector(".post-actions-options button")
    )
      throw Error("The message menu did not focus its first action");
    flushSync(() => fireEvent.click(action));
    await within(document.body).findByText(deny ? denied : copied);
    await waitFor(() => {
      if (
        writes.length !== 1 ||
        writes[0] !== expected ||
        document.activeElement !== origin
      )
        throw Error("Wrong permalink or focus after copy");
    });
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
}
