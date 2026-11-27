export const teamChoiceText = {
  en: {
    title: "Teams and servers",
    group: (address: string) => `Teams on ${address}`,
    current: "Current",
    progress: "Switching…",
    saving: (name: string) => `Saving the selection of “${name}”…`,
    refused: (name: string, current: string) =>
      `Couldn’t switch to “${name}”. The selection wasn’t saved on this device. You’re still in “${current}”. Choose a team again or close this dialog.`,
    back: "Back",
    close: "Close team picker",
    profilePending: "My profile · Loading profile",
  },
  ru: {
    title: "Команды и серверы",
    group: (address: string) => `Команды на ${address}`,
    current: "Текущая",
    progress: "Переходим…",
    saving: (name: string) => `Сохраняем выбор команды «${name}»…`,
    refused: (name: string, current: string) =>
      `Не перешли в «${name}»: выбор не сохранился на этом устройстве. Вы остаётесь в команде «${current}». Выберите команду снова или закройте окно.`,
    back: "Назад",
    close: "Закрыть выбор команды",
    profilePending: "Мой профиль · профиль загружается",
  },
};
