export const signOutText = {
  en: {
    signOut: "Sign out",
    confirm: "Sign out of this account?",
    consequence:
      "The server stays in the list and you can sign in again. This account’s messages and drafts will be removed from this device.",
    cancel: "Cancel",
    pending: "Signing out…",
    pendingExplanation: "Ending the session on the server",
    unconfirmed: "Sign-out incomplete",
    sessionRemains:
      "The server hasn’t confirmed sign-out. The session there may still be active.",
    choice:
      "Staying signed in keeps the account and messages. Signing out on this device removes them locally and keeps the server in the list.",
    localOnly: "Sign out only on this device",
    pendingLocal: "Removing account data…",
    pendingLocalExplanation: "Removing the account from this device",
    stay: "Stay signed in",
    cleanup: "Account data is still on this device",
    serverEnded: "The server confirmed sign-out.",
    remaining:
      "The account and messages are still on this device. You can retry cleanup without connecting to the server.",
    later: "Later",
    retryLocal: "Retry cleanup",
    cleaning: "Cleaning up…",
    cleaningExplanation: "Removing the account and messages from this device",
    errorCode: (code: string) => `Error code: ${code}`,
    error: "Couldn’t complete sign-out. Try again.",
    account: "Current account",
    close: "Close",
  },
  ru: {
    signOut: "Выйти",
    confirm: "Выйти из аккаунта?",
    consequence:
      "Сервер останется в списке, войти можно снова. Переписка и черновики этого входа будут удалены с устройства.",
    cancel: "Отмена",
    pending: "Выходим…",
    pendingExplanation: "Завершаем вход на сервере",
    unconfirmed: "Выход не завершён",
    sessionRemains:
      "Сервер не подтвердил выход, сеанс на нём может остаться действующим.",
    choice:
      "«Остаться» сохранит вход и переписку. «Выйти только на этом устройстве» удалит их с устройства, сервер останется в списке.",
    localOnly: "Выйти только на этом устройстве",
    pendingLocal: "Удаляем с устройства…",
    pendingLocalExplanation: "Удаляем вход с этого устройства",
    stay: "Остаться",
    cleanup: "Данные на устройстве не удалены",
    serverEnded: "Сервер подтвердил выход.",
    remaining:
      "Вход и переписка ещё на этом устройстве. Повторите очистку: сервер для неё не нужен.",
    later: "Позже",
    retryLocal: "Повторить очистку",
    cleaning: "Очищаем…",
    cleaningExplanation: "Удаляем вход и переписку с устройства",
    errorCode: (code: string) => `Код ошибки: ${code}`,
    error: "Не удалось завершить выход. Попробуйте ещё раз.",
    account: "Текущий аккаунт",
    close: "Закрыть",
  },
} as const;
