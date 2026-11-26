import assert from "node:assert/strict";
import { test } from "node:test";
import { watchWebviewSteps } from "./macos.ts";

test("new fixture steps renew the deadline, but a repeating or stalled step expires", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let expired = 0;
  const watchdog = watchWebviewSteps(() => expired++, 100);
  t.mock.timers.tick(80);
  watchdog.completed("format-times");
  t.mock.timers.tick(80);
  watchdog.completed("back-reopened");
  assert.equal(expired, 0);
  t.mock.timers.tick(80);
  watchdog.completed("back-reopened");
  t.mock.timers.tick(20);
  assert.equal(expired, 1);
  watchdog.close();
});

test("closing the fixture releases its watchdog", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = watchWebviewSteps(() => assert.fail("orphaned watchdog"), 100);
  watch.completed("before");
  watch.close();
  watch.completed("late");
  t.mock.timers.tick(100);
});
