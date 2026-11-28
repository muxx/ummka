# Design system

People spend hours reading Channels. Make a conversation easy to scan, comfortable to read and quick to resume. Use the official Mattermost client as the reference for where things live and how they behave. Use the Slack UI Kit as a visual reference.

## Layout and type

- On desktop, keep channels on the left, the conversation in the center and the open thread on the right. On a phone, give the conversation and the thread their own screens. Back returns to the message or list row that opened the thread.
- In Channels on desktop, reserve the space above the sidebar for dragging the window. On mobile, show the small bear beside search. Keep the bear and wordmark together on sign-in and recovery screens. On mobile, center the lockup horizontally, including when the keyboard shortens the window.
- Integrate desktop window controls into the first row of the application. In Channels the row can also contain navigation and search. During sign-in it can show Back and the selected server.
- Allow desktop windows to resize down to 400 logical pixels. At that width the address field, primary action, and window controls must remain usable in both languages. Phones use the available screen width.
- Preserve each desktop’s window controls. On macOS, reserve space on the left for the system close, minimize and zoom buttons. Center the three native buttons on the same 46-point row as Back and the Channels controls. Keep the spacing and hit areas supplied by AppKit. On Windows, keep the caption buttons and system menu available and preserve Snap Layouts on supported systems. On Linux, follow the desktop’s configured side, order and set of controls. Verify each layout on its platform. [Windows title bars](https://learn.microsoft.com/en-us/windows/apps/develop/title-bar) · [Windows Snap Layouts](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu) · [GTK decoration layout](https://docs.gtk.org/gtk3/property.Settings.gtk-decoration-layout.html)
- Leave a clear part of that row available for dragging. Keep fields, buttons, focus rings and selectable text outside the drag region. Check a narrow window, an inactive window and full screen. On phones, use the system insets and navigation conventions.
- Give message text the clearest reading contrast. Keep authors easy to scan and timestamps quieter but legible. Choose type with distinct Latin and Cyrillic glyphs. Use consistent roles for headings, message text, metadata and code. Respect text scaling.
- Align message bodies on a common edge. Use spacing to group a reply with its author and to separate speakers. Let long names, links and paragraphs wrap. Confine horizontal scrolling to wide code blocks and tables. At narrow pane widths and on 320 px screens, keep row actions reachable by tightening spacing and moving secondary details into the metadata line.
- Reserve space for attachments as they load. Revealing message actions, loading older history or receiving new posts must preserve the reader’s place.
- Where a decorative gradient meets a resizable column, blend it into the column color along the shared edge. Keep the blend aligned as the column moves.

## Shared panel components

Use BEM names for shared components: `block`, `block__element` and `block--modifier`. Migrate the parts a change touches and keep existing component names elsewhere. The component stylesheet owns its variants and its hover, focus and disabled treatments. Use the theme's surface and focus roles.

Give headings, tab and navigation labels, body text, and supporting text semantic type roles. Use system type for controls and their labels. Use a persistent fill for the current navigation item and an underline for the selected tab. Keep the label weight steady as a person moves between items.

Use a common state block for first loading, confirmed empty results and failed reads with Retry when available. Keep the existing rows usable while refreshing, and show the refreshing status after one second. Keep pagination and permission states tied to the reading surface that owns them.

### Context panel headers and action groups

Give context panels a shared header. Put Back on the left when the panel has a visible parent screen. Back, Escape, and the system Back action follow the same route and restore focus to the control that opened it. A direct entry from the channel uses the channel as its parent. Close dismisses the side pane and restores focus to its opener. A dialog closes within its own route and restores focus to the control that summoned it.

On desktop, place persistent actions as a group at the right edge. Use 32 × 32 px targets, 4 px between them and an 11 px right inset. Adding or removing Expand leaves Close in place. Give the heading and subtitle separate single lines with ellipsis, accessible full text, and a tooltip. Reserve room for controls as either line grows. On a compact side pane, keep a 44 × 44 px Back target and use the space at the right for the heading and subtitle.

Align action groups at the start and place targets next to each other without gaps or margins. Use a 32 px minimum for desktop rows and 44 px when a row has supporting text. In compact layouts each target is at least 44 px. Give rows 4 px of vertical padding and let them grow for wrapped or enlarged text. Keep 8 px from the preceding divider to the first hover surface and draw the focus ring inside each row. Apply these roles in both themes.

[Context panel examples](https://github.com/muxx/ummka-docs/blob/main/prototypes/screens.md#channel-info-frame)

[Interactive examples](https://github.com/muxx/ummka-docs/blob/main/prototypes/screens.md#workspace-panel-styles)

## Interaction and motion

- A link to a post brings its surrounding messages into view and briefly marks the target. Opening a thread from a message moves focus to its reply field on desktop and to its heading on a phone. Arrow keys in a list of threads change the open thread while focus stays in the list. Closing a thread restores focus to the opener, marks it briefly and preserves its position.
- Make message actions reachable by pointer, keyboard and touch. Give icon buttons accessible names. Use visible keyboard focus and follow the platform’s Back and dismissal conventions.
- Across the app, start with the keyboard focus ring hidden. Tab or Shift+Tab reveals it on the focused control, including on a phone with an external keyboard. Keep it visible as keyboard navigation moves or restores focus. A mouse press or tap hides it until the next Tab. Typing into a field leaves the input mode alone. Preserve the caret, selection, validation feedback and accessibility focus in both modes.
- Keep a dialog’s heading, dismissal control and action bar in place. Give the content between them its own vertical scroll area. Long lists and forms must stay usable with keyboard focus, touch and the platform scrollbar at compact heights.
- Keep an open popover anchored as the window resizes. At phone width, adapt it to a sheet and preserve the current input and focus.
- The channel switcher opens conversations and accepts pasted message links. On desktop, choosing a conversation focuses its draft. The header search finds messages and files on submit. Show results beside the conversation on desktop and on a separate screen on a phone. Preserve the draft and reading position. After stepping through matches, Back returns to the results at the last opened match.
- Give the current row a persistent fill and a second cue, such as a change in label weight. Use a distinct hover fill so a neighboring row stays distinguishable. Keep the keyboard focus outline visible over both states. Vertical accent bars are prohibited as selection markers.
- Pair meaningful colors with another cue, such as a shape for presence or a count for mentions. Unread activity has its own indicator so readers can see which other conversations have new messages.
- Use motion to show what opened, closed or received focus. Play the effect once for the action that triggered it. Input works as soon as the control appears. With reduced motion, show the destination immediately and keep a static cue. Keep typing and scrolling responsive while the feed updates.
- Use Telegram as a reference for how quickly people can continue an action. Try typing immediately after switching conversations, returning to a half-written reply, and dismissing an image back to the same line of a thread. Keep a separate draft for each channel and thread.

## Themes and appearance

A **theme** contains a complete light palette and a complete dark palette, including custom themes. **Appearance** selects which palette to use. Offer System (default), Light and Dark. In System mode, follow changes to the device setting while the app is open. Switching appearance keeps the selected theme, open thread, draft, focus and scroll position.

Use four user-editable color roles, following Slack’s customization model. A custom theme starts with both palettes of the selected theme. Editing a color changes that role in the selected appearance and preserves its value in the other appearance. [Slack theme settings](https://slack.com/help/articles/205166337-Change-your-Slack-theme) · [Slack appearance settings](https://slack.com/help/articles/360019434914-Use-dark-mode-in-Slack)

| Color control | Where people see it |
| --- | --- |
| Navigation | Workspace and channel navigation surfaces |
| Selected item | The active conversation in the sidebar |
| Presence | The available status indicator |
| Notifications | Mention and notification badges |

Components use colors by purpose, including reading surfaces, text, links, borders, focus rings and message highlights. Define each role for both appearances in the theme. Typography, spacing, layout, keyboard behavior and motion rules apply to every theme.

Keep normal text at a contrast ratio of at least 4.5:1, large text at 3:1, and essential control outlines and state indicators at 3:1 against adjacent colors. Check custom palettes on their actual surfaces, including text on a selected row and counts inside badges. Show which color pair needs adjustment before saving an inaccessible combination. [Text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) · [Control and state contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

Underline inline links on hover and keyboard focus. A link distinguished by color at rest needs at least 3:1 against adjacent text. Where muted text makes that distinction too weak, keep the underline at rest. Check link readability against hover, selection and message highlight fills as well as the reading surface. [Distinguishing inline links](https://www.w3.org/WAI/WCAG22/Techniques/general/G183)

## Native sign-in forms

- Above the fields, name the server and show its full address, including any path prefix. Use visible labels and platform autofill hints for the username, current password and one-time code.
- Show missing values and invalid one-time codes under their fields. Focus the first field that needs attention. Show rejected credentials above the fields and keep the username for the next attempt.
- While a request is pending, make fields read-only, show progress on the primary button and ignore repeated submissions. Back and Cancel stay unavailable until it settles. After a connection failure, send again only when the person chooses Retry.
- Report success only after the result is saved on the device. Ask for a second factor only when the server requires it, and accept a pasted code with spaces or dashes in a single field.
- Back returns one step. Cancel clears the form and confirms cancellation. On desktop, Escape goes back and Return in the username field moves to the password field when it is empty.

## Review in context

Use the same populated channel in both appearances. Include Cyrillic and Latin text, a long message, a link, code, an attachment and a thread. Follow a link, read the neighboring messages, open the replies and return. Repeat with the keyboard, larger text, reduced motion, a narrow viewport and the narrowest column the panes allow. Change appearance midway and check that reading can continue from the same line.
