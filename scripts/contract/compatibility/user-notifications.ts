import assert from "node:assert/strict";
import { Configuration, UsersApi } from "../../../vendor/mattermost/index.js";

export async function checkUserNotifications(base: string, token: string) {
  const own = new UsersApi(
    new Configuration({ basePath: base, accessToken: token }),
  );
  const me = base + "/api/v4/users/me";
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const rawSettings = async () => {
    const response = await fetch(me, { headers });
    assert.equal(response.status, 200);
    return (await response.json()).notify_props as Record<string, string>;
  };
  const setFixture = async (props: Record<string, string>) => {
    const response = await fetch(me + "/patch", {
      method: "PUT",
      headers,
      body: JSON.stringify({ notify_props: props }),
    });
    assert.equal(response.status, 200);
  };
  const original = await rawSettings();
  const fresh = (await own.getUser({ userId: "me" })).notifyProps;
  assert.equal(original.desktop_threads, "all");
  assert.equal(fresh?.desktopThreads, original.desktop_threads);
  assert.equal(original.push_threads, "all");
  assert.equal(fresh?.pushThreads, original.push_threads);
  assert.equal(original.desktop_notification_sound, undefined);
  assert.equal(fresh?.desktopNotificationSound, undefined);

  try {
    for (const [desktop, push] of [
      ["mention", "all"],
      ["all", "mention"],
    ]) {
      const preferences = {
        ...original,
        desktop_threads: desktop,
        push_threads: push,
        desktop_notification_sound: "Crackle",
      };
      await setFixture(preferences);
      const raw = await rawSettings();
      assert.deepEqual(raw, preferences);
      const saved = (await own.getUser({ userId: "me" })).notifyProps;
      assert.equal(saved?.desktopThreads, raw.desktop_threads);
      assert.equal(saved?.pushThreads, raw.push_threads);
      assert.equal(
        saved?.desktopNotificationSound,
        raw.desktop_notification_sound,
      );
      assert.equal(saved?.desktopSound, original.desktop_sound);
    }
  } finally {
    await setFixture(original);
    assert.deepEqual(await rawSettings(), original);
  }
}
