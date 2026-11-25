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
