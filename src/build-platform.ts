// Vite and Vitest both preserve the Tauri target as a string.
const target: string = import.meta.env.UMMKA_PLATFORM;

export const isAndroid = target === "android";
export const isMobile = isAndroid || target === "ios";
export const usesMacOSOverlay = target === "darwin";
