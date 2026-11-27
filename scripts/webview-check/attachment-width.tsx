import { fireEvent, within } from "@testing-library/dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChannelTimeline } from "../../src/channels/ChannelTimeline.tsx";
import {
  AttachmentWindow,
  useAttachmentWindow,
} from "../../src/channels/PublishedAttachments.tsx";

const channelId = "c".repeat(26),
  fileId = "f".repeat(26);
const name = "longfilename".repeat(32) + ".txt";
const context = "UnbrokenChannelName".repeat(32);
function Fixture() {
  const attachment = useAttachmentWindow(
    {
      connection: {
        async readPostFiles() {
          throw Error("Already known metadata");
        },
      },
      online: false,
      sessionIssue() {
        throw Error("Unexpected test session change");
      },
    },
    channelId,
    context,
  );
  return (
    <AttachmentWindow value={attachment}>
      <ChannelTimeline
        channelId={channelId}
        locale="en"
        timeZone="UTC"
        offline
        author={() => ({ name: "Ada Example" })}
        page={{
          posts: [
            {
              id: "p".repeat(26),
              channelId,
              userId: "u".repeat(26),
              rootId: null,
              createAt: 1,
              updateAt: 1,
              editAt: 0,
              isPinned: false,
              type: "",
              message: "",
              messageSource: null,
              hashtags: "",
              attachments: {
                fileIds: [fileId],
                files: [{ id: fileId, name, size: 0 }],
              },
            },
          ],
          older: { kind: "end" },
          newer: { kind: "end" },
          firstInaccessiblePostTime: 0,
        }}
      />
    </AttachmentWindow>
  );
}
export async function checkAttachmentWidth() {
  const host = document.createElement("div");
  host.style.width = "320px";
  host.style.height = "260px";
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<Fixture />));
    const pane = host.querySelector<HTMLElement>(".timeline-scroll");
    const file = within(host).getByRole("button", {
      name: `Open attachment ${name}, 0 B`,
    });
    if (
      !pane ||
      !file.getClientRects().length ||
      pane.scrollWidth > pane.clientWidth + 1 ||
      file.getBoundingClientRect().right >
        pane.getBoundingClientRect().right + 1
    )
      throw Error("Long file name overflowed the 320px timeline");
    flushSync(() => fireEvent.click(file));
    const dialog = await within(document.body).findByRole("dialog", { name });
    const body = within(dialog).getByRole("region", { name: "File details" });
    if (
      !body.textContent?.includes(context) ||
      body.scrollWidth > body.clientWidth + 1
    )
      throw Error("The file details overflowed on a long channel name");
    flushSync(() =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" })),
    );
  } finally {
    root.unmount();
    host.remove();
  }
}
