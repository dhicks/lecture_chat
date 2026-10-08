// Parse the poll options textarea into an array of option strings.
// One option per line. A leading Markdown bullet (-, *, or +) is removed;
// lines without a bullet are kept as written. Blank lines are skipped.
export function parseOptions(text) {
  return String(text)
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*+]\s+/, '').replace(/^[-*+]$/, '').trim())
    .filter(option => option.length > 0);
}
