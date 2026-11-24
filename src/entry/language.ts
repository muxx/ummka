export const entryText = {
  en: {
    title: "Connect your Mattermost server",
    lead: "Enter the address you use in your browser.",
    address: "Server address",
    hint: "Include the path if Mattermost runs in a subdirectory.",
    go: "Continue",
    busy: "Checking…",
    back: "Change server address",
    methods: "Sign-in methods",
    password: "Password",
    guest: "Guest email link",
    none: "This server has no sign-in methods enabled. Contact your Mattermost administrator.",
    empty: "Enter your server address.",
    protocol: "Use an HTTPS address.",
    "extra-parts":
      "Use the server address without credentials, a query or a fragment.",
    invalid: "Check the server address and port.",
    missing:
      "Mattermost was not found at this address. Check the address and path.",
    network:
      "Couldn’t connect. Check the address and your connection, then try again.",
  },
  ru: {
    title: "Подключите сервер Mattermost",
    lead: "Введите адрес, который открываете в браузере.",
    address: "Адрес сервера",
    hint: "Если Mattermost открыт в подкаталоге, укажите и его.",
    go: "Продолжить",
    busy: "Проверяем…",
    back: "Изменить адрес сервера",
    methods: "Способы входа",
    password: "Пароль",
    guest: "Ссылка на почту гостя",
    none: "На этом сервере отключены все способы входа. Обратитесь к администратору Mattermost.",
    empty: "Введите адрес сервера.",
    protocol: "Используйте адрес с HTTPS.",
    "extra-parts":
      "Укажите адрес сервера без данных входа, параметров и фрагмента.",
    invalid: "Проверьте адрес сервера и порт.",
    missing:
      "По этому адресу Mattermost не найден. Проверьте адрес и подкаталог.",
    network:
      "Не удалось подключиться. Проверьте адрес и соединение, затем попробуйте ещё раз.",
  },
} as const;

export type EntryLanguage = keyof typeof entryText;

export function entryLanguage(languages: readonly string[]): EntryLanguage {
  for (const tag of languages) {
    const primary = tag.split("-", 1)[0].toLowerCase();
    if (primary === "en" || primary === "ru") return primary;
  }
  return "en";
}
