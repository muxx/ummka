export const teamText = {
  ru: {
    title: "Выберите команду",
    loading: "Открываем команды…",
    empty: "У вас пока нет команд на этом сервере.",
    offline: "Без сети. Показываем сохранённые команды.",
    noCache:
      "На устройстве пока нет списка команд. Подключитесь к серверу и повторите попытку.",
    network:
      "Не удалось обновить команды. Проверьте соединение и попробуйте ещё раз.",
    server: "Mattermost отклонил запрос при загрузке команд.",
    data: "Не удалось прочитать данные команд, полученные от Mattermost.",
    failed: "Не удалось завершить загрузку команд.",
    storage: "Не удалось прочитать данные аккаунта на устройстве.",
    chooseFailed: "Не удалось сохранить выбор команды.",
    retry: "Попробовать снова",
  },
  en: {
    title: "Choose a team",
    loading: "Opening your teams…",
    empty: "You haven’t joined any teams on this server yet.",
    offline: "You’re offline. Showing saved teams.",
    noCache:
      "This device has no saved team list yet. Reconnect to the server and try again.",
    network: "Couldn’t update your teams. Check the connection and try again.",
    server: "Mattermost returned an error while loading your teams.",
    data: "Couldn’t read the team data returned by Mattermost.",
    failed: "Couldn’t finish loading your teams.",
    storage: "Couldn’t read the account data on this device.",
    chooseFailed: "Couldn’t save your team selection.",
    retry: "Try again",
  },
} as const;

export const firstTeamText = {
  ru: {
    signedIn: "Вход выполнен.",
    signedInAs: "Вы вошли как",
    loading: "Загружаем команды…",
    readFailed: "Команды не загрузились",
    refused: "Сервер отказал в доступе к списку команд.",
    empty: "Команд пока нет",
    emptyDetail:
      "Вас ещё не добавили ни в одну команду на этом сервере. Когда администратор пригласит вас, проверьте снова.",
    checkAgain: "Проверить снова",
    otherServer: "Другой сервер",
    backToTeamChoice: "Назад к выбору команды",
    opening: "Открываем…",
    saving: (team: string) => `Сохраняем выбор команды «${team}»…`,
    saveFailed: (team: string) => `Не открыли «${team}»`,
    saveDetail: "Выбор не сохранился на этом устройстве. Команда не выбрана.",
    unavailable: "Команда больше недоступна.",
    retry: "Повторить",
    retryTeam: (team: string) => `Повторить: открыть «${team}»`,
  },
  en: {
    signedIn: "You’re signed in.",
    signedInAs: "You’re signed in as",
    loading: "Loading teams…",
    readFailed: "Teams couldn’t load",
    refused: "The server denied access to your team list.",
    empty: "No teams yet",
    emptyDetail:
      "You haven’t been added to any teams on this server. Check again after an administrator invites you.",
    checkAgain: "Check again",
    otherServer: "Another server",
    backToTeamChoice: "Back to team choice",
    opening: "Opening…",
    saving: (team: string) => `Saving your selection of “${team}”…`,
    saveFailed: (team: string) => `Couldn’t open “${team}”`,
    saveDetail:
      "Your selection couldn’t be saved on this device. No team was selected.",
    unavailable: "This team is no longer available.",
    retry: "Retry",
    retryTeam: (team: string) => `Retry opening “${team}”`,
  },
} as const;
