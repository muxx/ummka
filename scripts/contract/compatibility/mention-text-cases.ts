// Each root post is read by a second member with channel notifications enabled.
export const mentionTextCases = [
  ["@all", true],
  ["Ordinary fixture post", false],
  ["~~~@all~~~", false],
  ["@all@example.com", false],
  [" /not_cmd @all", true],
  ["[room](https://example.test/@all)", false],
  ["[@all](https://example.test/project)", true],
  ["![bear @all](https://example.test/image.png)", true],
  ["https://example.test/@all", false],
  ['<span title="@all">hello</span>', true],
  ["@a**ll**", false],
] as const;
