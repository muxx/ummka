import type { EntryLanguage } from "../entry/language.ts";
import type { LocalPost } from "../mattermost/local-history.ts";

type Observation = NonNullable<LocalPost["attachments"]>;
export type PublishedFile = NonNullable<Observation["files"]>[number];

export function cardFiles(observation: Observation): PublishedFile[] {
  if (observation.redactedFileCount) return [];
  const files = new Map(observation.files?.map((file) => [file.id, file]));
  const result = (observation.fileIds ?? []).map((id) => {
    const file = files.get(id) ?? { id };
    files.delete(id);
    return file;
  });
  return result.concat([...files.values()]);
}

export const attachmentCopy = {
  en: {
    file: "Attachment",
    open: "Open attachment",
    details: "File details",
    inThread: "thread in",
    onServer: "details on server",
    emptySize: "0 B, empty file",
    name: "Name",
    close: "Close",
    archived: "Archived",
    type: "Type",
    size: "Size",
    dimensions: "Image",
    pending: "Getting file details",
    offlineTitle: "File details aren’t saved",
    idleTitle: "Details haven’t been fetched",
    idle: "The request was cancelled. You can fetch the details again.",
    ready: "You’re online. You can fetch the file details.",
    serverDetail: "The server will return the name and size.",
    cancel: "Cancel request",
    denied: "You don’t have access to this file.",
    gone: "The message or file is no longer on the server.",
    offline: "File details aren’t saved on this device.",
    unavailable: "File details are unavailable.",
    failure: "Couldn’t load file details.",
    retry: "Try again",
    load: "Load details",
    units: ["B", "KB", "MB", "GB", "TB"],
    hidden: {
      one: "hidden attachment",
      few: "hidden attachments",
      other: "hidden attachments",
    },
  },
  ru: {
    file: "Вложение",
    open: "Открыть вложение",
    details: "Сведения о файле",
    inThread: "тред в",
    onServer: "сведения на сервере",
    emptySize: "0 Б, файл пустой",
    name: "Имя",
    close: "Закрыть",
    archived: "В архиве",
    type: "Тип",
    size: "Размер",
    dimensions: "Изображение",
    pending: "Получаем сведения о файле",
    offlineTitle: "Сведения о файле не сохранены",
    idleTitle: "Сведения о файле не получены",
    idle: "Запрос отменён. Получить сведения можно снова.",
    ready: "Связь есть — сведения можно получить.",
    serverDetail: "Сервер пришлёт имя и размер.",
    cancel: "Отменить запрос",
    denied: "Нет доступа к файлу.",
    gone: "Сообщение или файл удалили на сервере.",
    offline: "Сведения о файле ещё не сохранены на устройстве.",
    unavailable: "Сведения о файле недоступны.",
    failure: "Не удалось загрузить сведения о файле.",
    retry: "Повторить",
    load: "Загрузить сведения",
    units: ["Б", "КБ", "МБ", "ГБ", "ТБ"],
    hidden: {
      one: "скрытое вложение",
      few: "скрытых вложения",
      other: "скрытых вложений",
    },
  },
} as const;

export function attachmentName(
  file: PublishedFile,
  position: number,
  language: EntryLanguage,
) {
  return file.name?.trim() || `${attachmentCopy[language].file} ${position}`;
}

export function attachmentExcerpt(
  attachments: Observation | undefined,
  language: EntryLanguage,
) {
  if (!attachments) return "";
  return cardFiles(attachments)
    .map((file, index) => attachmentName(file, index + 1, language))
    .join(", ")
    .replace(/\s+/gu, " ");
}

const numbers = {
  en: new Intl.NumberFormat("en", { maximumFractionDigits: 1 }),
  ru: new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }),
};
const plurals = {
  en: new Intl.PluralRules("en"),
  ru: new Intl.PluralRules("ru"),
};
export function hiddenFiles(count: number, language: EntryLanguage) {
  const form = plurals[language].select(count);
  return `${numbers[language].format(count)} ${attachmentCopy[language].hidden[form === "one" || form === "few" ? form : "other"]}`;
}
export function attachmentSize(bytes: number, language: EntryLanguage) {
  const units = attachmentCopy[language].units;
  if (bytes === 0) return `0 ${units[0]}`;
  if (bytes < 1024 * 1024)
    return `${Math.max(1, Math.round(bytes / 1024))} ${units[1]}`;
  let value = bytes / (1024 * 1024);
  let unit = 2;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${numbers[language].format(value)} ${units[unit]}`;
}

export function hasDetails(file: PublishedFile) {
  return Boolean(
    file.name?.trim() ||
      file.extension?.trim() ||
      file.mimeType?.trim() ||
      file.size !== undefined ||
      (file.width && file.height) ||
      file.archived,
  );
}
