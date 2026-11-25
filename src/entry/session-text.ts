export const sessionText = {
  en: {
    opening: "Opening ummka…",
    storage: "Couldn’t read or save this device’s account data.",
    retry: "Try again",
    waiting: "Continue in your browser",
    cancel: "Cancel sign-in",
    cancelling: "Finishing sign-in…",
    unsupported: "This device has no browser that supports secure sign-in.",
    unavailable: "Couldn’t open the system browser. Try again.",
    busy: "Another sign-in is in progress.",
    exchange: "Couldn’t verify the sign-in with Mattermost. Try again.",
    notSaved:
      "Couldn’t save your sign-in on this device. The new server session was closed.",
    unconfirmed:
      "Couldn’t save your sign-in. Mattermost hasn’t confirmed that the new server session was closed.",
    chooseTeam: "Switch team",
  },
  ru: {
    opening: "Открываем ummka…",
    storage:
      "Не удалось прочитать или сохранить данные аккаунта на устройстве.",
    retry: "Повторить",
    waiting: "Продолжите вход в браузере",
    cancel: "Отменить вход",
    cancelling: "Завершаем вход…",
    unsupported: "На устройстве нет браузера с поддержкой защищённого входа.",
    unavailable: "Не удалось открыть системный браузер. Попробуйте ещё раз.",
    busy: "Другой вход уже выполняется.",
    exchange:
      "Не удалось подтвердить вход на сервере Mattermost. Попробуйте ещё раз.",
    notSaved:
      "Не удалось сохранить вход на устройстве. Новая сессия на сервере завершена.",
    unconfirmed:
      "Не удалось сохранить вход. Сервер не подтвердил завершение новой сессии.",
    chooseTeam: "Сменить команду",
  },
} as const;
