import {
  notificationSounds,
  notificationSoundUrl,
} from "../../src/channels/notification-sounds.ts";

export async function checkNotificationSoundAssets() {
  const decoder = new OfflineAudioContext(1, 1, 44100);
  for (const name of notificationSounds) {
    const response = await fetch(notificationSoundUrl(name));
    if (!response.ok) throw Error(`notification-sound-file-${name}`);
    const clip = await decoder.decodeAudioData(await response.arrayBuffer());
    if (
      clip.duration <= 0 ||
      !clip.getChannelData(0).some((sample) => Math.abs(sample) > 0.001)
    )
      throw Error(`notification-sound-empty-${name}`);
  }
}
