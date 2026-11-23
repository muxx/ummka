# Design system

People spend hours reading Channels. Make a conversation easy to scan, comfortable to read and quick to resume. Use the official Mattermost client as the reference for where things live and how they behave. Use the Slack UI Kit as a visual reference.

## Layout and type

- On desktop, keep channels on the left, the conversation in the center and the open thread on the right. On a phone, give the conversation and the thread their own screens. Back returns to the message that opened the thread.
- Give message text the clearest reading contrast. Keep authors easy to scan and timestamps quieter but legible. Choose type with distinct Latin and Cyrillic glyphs. Use consistent roles for headings, message text, metadata and code. Respect text scaling.
- Align message bodies on a common edge. Use spacing to group a reply with its author and to separate speakers. Allow long names, links and paragraphs to wrap. Keep horizontal scrolling inside wide code blocks.
- Reserve space for attachments as they load. Revealing message actions, loading older history or receiving new posts must preserve the reader’s place.

## Interaction and motion

- A link to a post brings its surrounding messages into view and briefly marks the target. Opening a thread moves keyboard focus into it. Closing it restores focus to the opener and preserves its position in the feed.
- Make message actions reachable by pointer, keyboard and touch. Give icon buttons accessible names. Use visible keyboard focus and follow the platform’s Back and dismissal conventions.
- Distinguish hover, focus, selection and unread status. Pair meaningful colors with another cue, such as a count for mentions, a shape for presence or a marker for selection.
- Use motion to show what opened, closed or received focus. Input works as soon as the control appears. With reduced motion, show the destination immediately and keep a static cue. Keep typing and scrolling responsive while the feed updates.
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

## Review in context

Use the same populated channel in both appearances. Include Cyrillic and Latin text, a long message, a link, code, an attachment and a thread. Follow a link, read the neighboring messages, open the replies and return. Repeat with the keyboard, larger text, reduced motion and a narrow viewport. Change appearance midway and check that reading can continue from the same line.
