import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  DraftPostConfirmation,
  type MentionConfirmation,
} from "./DraftPostConfirmation.tsx";

afterEach(cleanup);
test.each([
  {
    kind: "channel",
    mentions: ["@channel"],
    title: "@channel уведомит весь канал",
    description: "11 человек в 3 часовых поясах.",
  },
  {
    kind: "here",
    mentions: ["@here"],
    title: "@here уведомит всех в сети",
    description: "До 11 человек в 3 часовых поясах.",
  },
  {
    kind: "groups",
    mentions: ["@docs", "@release"],
    title: "@docs и @release уведомят группы",
    description: "Не меньше 11 человек в 3 часовых поясах.",
  },
] as const)(
  "shows the $kind audience, focuses Send and handles Escape inside the conversation",
  ({ kind, mentions, title, description }) => {
    const confirm = vi.fn(),
      cancel = vi.fn(),
      outer = vi.fn();
    const confirmation: MentionConfirmation = {
      kind,
      mentions: [...mentions],
      members: 11,
      timezones: 3,
    };
    render(
      <section aria-label="conversation" onKeyDown={outer}>
        <DraftPostConfirmation
          language="ru"
          conversation={{ name: "общий", direct: false }}
          confirmation={confirmation}
          confirm={confirm}
          cancel={cancel}
        />
      </section>,
    );
    const group = screen.getByRole("group", { name: title });
    const desc = document.getElementById(
      group.getAttribute("aria-describedby") ?? "",
    );
    expect(desc?.textContent).toContain(description);
    const send = within(group).getByRole("button", { name: "Отправить" });
    expect(document.activeElement).toBe(send);
    fireEvent.keyDown(send, { key: "Escape", isComposing: true });
    expect(cancel).not.toHaveBeenCalled();
    outer.mockClear();
    fireEvent.keyDown(send, { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
    fireEvent.click(send);
    expect(confirm).toHaveBeenCalledOnce();
  },
);

test("uses the conversation name and omits a single time zone", () => {
  render(
    <DraftPostConfirmation
      language="en"
      conversation={{ name: "Ada, Lin", direct: true }}
      confirmation={{
        kind: "here",
        mentions: ["@here"],
        members: 6,
        timezones: 1,
      }}
      confirm={vi.fn()}
      cancel={vi.fn()}
    />,
  );
  expect(screen.getByText(/Up to 6 people/).textContent).toContain(
    "conversation “Ada, Lin”",
  );
  expect(screen.queryByText(/time zone/)).toBeNull();
});
