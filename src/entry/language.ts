export const entryText = {
  en: {
    title: "Connect your Mattermost server",
    lead: "Enter the address you use in your browser.",
    address: "Server address",
    hint: "Include the path if Mattermost runs in a subdirectory.",
    go: "Continue",
    busy: "Checking…",
    back: "Change server address",
    linkTitle: "Sign in to open the message",
    linkLead:
      "This link points to this server. The message will open after you sign in.",
    linkCancelledTitle: "Sign-in canceled",
    linkCancelled: "The message will still open when you sign in.",
    declineLink: "Don’t open this link",
    browserMethod: "Opens the system browser",
    gitlabSignIn: "Sign in with GitLab",
    browserHint:
      "Sign-in opens in your browser. ummka doesn’t get your password.",
    otherServer: "Another server",
    savedServers: "Servers on this device",
    savedServersLead: "Servers on the same host can have different paths.",
    selectedServer: "Selected",
    linkWaitingForSignIn: "Message link is waiting for sign-in",
    addServer: "Add server",
    backToSignIn: "Back to sign-in",
    backToServers: "Back to saved servers",
    selectServerError: "Couldn’t switch servers. Try again.",
    methods: "How would you like to sign in?",
    methodsLead: "These are the sign-in methods enabled on this server.",
    restoreSignIn: "Sign in again",
    restoreSignInLead:
      "This server is saved. You’re signed out on this device.",
    cancel: "Cancel",
    browserCancelled: (provider: string) => `Sign-in with ${provider} canceled`,
    password: "Password",
    guest: "Guest email link",
    methodUnavailable: "Unavailable in ummka",
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
    linkTitle: "Войдите, чтобы открыть сообщение",
    linkLead:
      "Ссылка ведёт на этот сервер. Сообщение откроется сразу после входа.",
    linkCancelledTitle: "Вход отменён",
    linkCancelled: "Сообщение не открыто. Оно откроется, когда вы войдёте.",
    declineLink: "Не открывать ссылку",
    browserMethod: "Откроется системный браузер",
    gitlabSignIn: "Войти через GitLab",
    browserHint: "Вход откроется в браузере. Пароль ummka не получает.",
    otherServer: "Другой сервер",
    savedServers: "Серверы на этом устройстве",
    savedServersLead: "Адреса на одном домене различаются подкаталогом.",
    selectedServer: "Выбран",
    linkWaitingForSignIn: "Ссылка на сообщение ждёт входа",
    addServer: "Добавить сервер",
    backToSignIn: "Вернуться ко входу",
    backToServers: "К сохранённым серверам",
    selectServerError: "Не удалось переключить сервер. Попробуйте ещё раз.",
    methods: "Как войти?",
    methodsLead: "Способы входа, которые включены на этом сервере.",
    restoreSignIn: "Войдите снова",
    restoreSignInLead: "Сервер сохранён, вход на этом устройстве завершён.",
    cancel: "Отмена",
    browserCancelled: (provider: string) => `Вход через ${provider} отменён`,
    password: "Пароль",
    guest: "Ссылка на почту гостя",
    methodUnavailable: "Недоступно в ummka",
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
