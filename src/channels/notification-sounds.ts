export const notificationSounds = [
  "Bing",
  "Crackle",
  "Down",
  "Hello",
  "Ripple",
  "Upstairs",
] as const;
type NotificationSound = (typeof notificationSounds)[number];

export function notificationSoundUrl(name: NotificationSound) {
  if (!notificationSounds.includes(name))
    throw new TypeError("Unknown notification sound.");
  return `/sounds/notifications/${name.toLowerCase()}.mp3`;
}

export function createNotificationSoundPreview() {
  let current: HTMLAudioElement | null = null;

  function stop() {
    const audio = current;
    if (!audio) return;
    current = null;
    audio.onended = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  async function play(name: NotificationSound) {
    const url = notificationSoundUrl(name);
    stop();
    const audio = new Audio(url);
    current = audio;
    audio.onended = () => {
      if (current === audio) stop();
    };
    try {
      await audio.play();
    } catch (error) {
      // Replacing or stopping a pending play can reject its promise.
      if (current !== audio) return;
      stop();
      throw error;
    }
  }

  return { play, stop };
}
