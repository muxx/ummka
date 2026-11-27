import type { FileInfo } from "../../vendor/mattermost/index.js";
import { isMattermostId } from "./model-fields.ts";

export interface ReceivedFile {
  id: string;
  name?: string;
  extension?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  hasPreviewImage?: boolean;
  archived?: boolean;
}

export function receivedFileDetails(file: FileInfo): ReceivedFile {
  if (!isMattermostId(file?.id)) throw TypeError("Invalid Mattermost file ID.");
  const result: ReceivedFile = { id: file.id };
  for (const field of ["name", "extension", "mimeType"] as const) {
    const value = file[field];
    if (value === undefined) continue;
    if (typeof value !== "string")
      throw TypeError("Invalid Mattermost file metadata.");
    result[field] = value;
  }
  for (const field of ["size", "width", "height"] as const) {
    const value = file[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0)
      throw TypeError("Invalid Mattermost file metadata.");
    result[field] = value;
  }
  for (const field of ["hasPreviewImage", "archived"] as const) {
    const value = file[field];
    if (value === undefined) continue;
    if (typeof value !== "boolean")
      throw TypeError("Invalid Mattermost file metadata.");
    result[field] = value;
  }
  return result;
}
