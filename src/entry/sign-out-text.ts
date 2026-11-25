export const signOutText = {
  en: {
    signOut: "Sign out",
    pending: "Signing out…",
    pendingLocal: "Removing account data from this device…",
    unconfirmed: "Mattermost hasn’t confirmed sign-out",
    explain:
      "You can stay signed in or remove this account’s saved messages from this device. Its server session may remain active.",
    localOnly: "Sign out only on this device",
    stay: "Stay signed in",
    confirmed: "Signed out on the server",
    remaining: "The device couldn’t remove the saved account data.",
    retryLocal: "Retry removal",
    error: "Couldn’t complete sign-out. Try again.",
  },
  ru: {
    signOut: "Выйти",
    pending: "Выходим…",
    pendingLocal: "Удаляем данные входа с устройства…",
    unconfirmed: "Mattermost не подтвердил выход",
    explain:
      "Можно остаться в аккаунте или удалить его переписку с этого устройства. Сессия на сервере может остаться активной.",
    localOnly: "Выйти только на этом устройстве",
    stay: "Остаться в аккаунте",
    confirmed: "Вы вышли на сервере",
    remaining: "Не удалось удалить сохранённые данные аккаунта с устройства.",
    retryLocal: "Повторить удаление",
    error: "Не удалось завершить выход. Попробуйте ещё раз.",
  },
} as const;
