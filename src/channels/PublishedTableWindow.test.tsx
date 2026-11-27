import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PublishedPostBody } from "./PublishedPostBody.tsx";
import {
  PublishedTableScreen,
  PublishedTableWindow,
  usePublishedTableWindow,
} from "./PublishedTableWindow.tsx";
import "./workspace-dom.test-utils.ts";

vi.mock("../build-platform.ts", () => ({
  isAndroid: true,
  isMobile: true,
  usesMacOSOverlay: false,
}));

const large = [
  "| A | B | C | D |",
  "| :- | :-: | -: | - |",
  "| 1 | 2 | 3 | 4 |",
  "| 5 | 6 | 7 | 8 |",
  "| 9 | 10 | 11 | 12 | **Extra** |",
].join("\n");
const small = "| Solo |\n| - |\n| `short` |";

function Workspace({
  message,
  scope = "channel",
  locale = "en",
  inThread,
}: {
  message: string;
  scope?: string;
  locale?: "en" | "ru";
  inThread?: boolean;
}) {
  const tables = usePublishedTableWindow(scope, "# Release");
  return (
    <PublishedTableWindow value={tables.value}>
      <PublishedPostBody
        message={message}
        locale={locale}
        authorName="Ada"
        inThread={inThread}
      />
      <PublishedTableScreen tables={tables} />
    </PublishedTableWindow>
  );
}

function resize(width: number) {
  vi.stubGlobal("innerWidth", width);
  fireEvent.resize(window);
}

function expectPreview(rows: number, columns: number) {
  const grid = within(screen.getByRole("table"));
  expect(grid.getAllByRole("row")).toHaveLength(rows);
  expect(grid.getAllByRole("columnheader")).toHaveLength(columns);
}

function preview() {
  return screen.getByRole("table").closest(".post-table-preview");
}

afterEach(cleanup);

test.each([320, 383, 384, 390])(
  "caps the rows including headings and columns at %d logical pixels",
  (width) => {
    resize(width);
    render(<Workspace message={large} />);
    const limit = width < 384 ? 3 : 4;
    expectPreview(limit, limit);
    expect(screen.queryByText("Extra")).toBeNull();
    expect(preview()?.hasAttribute("data-more-rows")).toBe(limit === 3);
    expect(preview()?.hasAttribute("data-more-columns")).toBe(true);
  },
);

test.each([
  {
    message: small,
    rows: false,
    columns: false,
  },
  {
    message: "| A |\n| - |\n| 1 |\n| 2 |\n| 3 |",
    rows: true,
    columns: false,
  },
  {
    message: "| A | B | C | D |\n| - | - | - | - |\n| 1 | 2 | 3 | 4 |",
    rows: false,
    columns: true,
  },
])(
  "indicates exactly the clipped axes for $message",
  ({ message, rows, columns }) => {
    resize(320);
    render(<Workspace message={message} />);
    const frame = preview();
    expect(frame?.hasAttribute("data-more-rows")).toBe(rows);
    expect(frame?.hasAttribute("data-more-columns")).toBe(columns);
    expect(screen.getByRole("button", { name: /^Open table:/ })).toBeTruthy();
  },
);

test("shows the right edge cue for six columns on a tablet", () => {
  resize(820);
  render(
    <Workspace
      message={"| A | B | C | D | E | F |\n| - | - | - | - | - | - |"}
    />,
  );
  expectPreview(1, 6);
  expect(preview()?.hasAttribute("data-more-rows")).toBe(false);
  expect(preview()?.hasAttribute("data-more-columns")).toBe(true);
});

test("selects one table, returns focus, and recomputes its preview after resize", async () => {
  resize(320);
  render(<Workspace message={`${small}\n\n${large}`} />);
  const [first, second] = screen.getAllByRole<HTMLButtonElement>("button", {
    name: /^Open table:/,
  });
  fireEvent.click(second);
  let dialog = screen.getByRole("dialog", { name: "Table" });
  const full = within(dialog);
  expect(full.getAllByRole("table")).toHaveLength(1);
  expect(full.queryByText("short")).toBeNull();
  expect(
    full.getByRole("cell", { name: "Extra" }).firstElementChild?.tagName,
  ).toBe("STRONG");
  expect(full.getByRole("columnheader", { name: "C" }).style.textAlign).toBe(
    "right",
  );
  expect(document.activeElement).toBe(
    full.getByRole("region", { name: "Table" }),
  );
  resize(820);
  expect(full.getAllByRole("row")).toHaveLength(4);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(document.activeElement).toBe(second));
  expect(
    within(screen.getAllByRole("table")[1]).getByText("Extra"),
  ).toBeTruthy();
  fireEvent.click(first);
  dialog = screen.getByRole("dialog", { name: "Table" });
  expect(within(dialog).getAllByRole("table")).toHaveLength(1);
  expect(
    within(dialog).getByRole("cell", { name: "short" }).firstElementChild
      ?.tagName,
  ).toBe("CODE");
  fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
  await waitFor(() => expect(document.activeElement).toBe(first));
});

test("changes of workspace scope dismiss the open table", () => {
  const { rerender } = render(<Workspace message={large} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Open table: 4 rows, 5 columns" }),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  rerender(<Workspace message={small} scope="thread" />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("announces the authored dimensions and displays Russian thread context", () => {
  render(<Workspace message={large} locale="ru" inThread />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Открыть таблицу: 4 строки, 5 столбцов",
    }),
  );
  const dialog = within(screen.getByRole("dialog", { name: "Таблица" }));
  expect(dialog.getByText("Ada · тред в # Release")).toBeTruthy();
  expect(document.activeElement).toBe(
    dialog.getByRole("region", { name: "Таблица" }),
  );
});
