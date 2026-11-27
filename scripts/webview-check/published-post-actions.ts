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
    const origin = within(row).getByRole("button", { name: title });
    flushSync(() => fireEvent.click(origin));
    const menu = await within(document.body).findByRole("dialog", {
      name: title,
    });
    const action = within(menu).getByRole("button", { name: option });
    if (document.activeElement !== action)
      throw Error("No focus on the permalink action");
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
