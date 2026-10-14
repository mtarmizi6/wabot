const ansi = /\x1b\[[0-9;]*m/g;

export const useColor = () => Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
export const paint = (code, text) => useColor() ? `\x1b[${code}m${text}\x1b[0m` : text;
export const cyan = text => paint('1;36', text);
export const green = text => paint('1;32', text);
export const yellow = text => paint('1;33', text);
export const red = text => paint('1;31', text);
export const white = text => paint('1;37', text);
export const dim = text => paint('2', text);

export function clearScreen() {
  if (!process.stdout.isTTY) return;
  // Erase the visible screen and terminal scrollback so previous install/test
  // output does not remain above the WAPromoBot control panel in Termux.
  process.stdout.write('\x1b[3J\x1b[2J\x1b[H');
}

export function panelWidth() {
  const columns = Number(process.stdout.columns) || 40;
  return Math.max(34, Math.min(46, columns - 2));
}

function visibleLength(value) {
  return String(value).replace(ansi, '').length;
}

function fit(value, size) {
  const text = String(value ?? '');
  const length = visibleLength(text);
  if (length <= size) return text + ' '.repeat(size - length);
  if (size <= 1) return text.slice(0, size);
  return text.slice(0, size - 1) + '…';
}

export function top(width = panelWidth()) {
  return `╭${'─'.repeat(width - 2)}╮`;
}

export function bottom(width = panelWidth()) {
  return `╰${'─'.repeat(width - 2)}╯`;
}

export function divider(width = panelWidth()) {
  return `├${'─'.repeat(width - 2)}┤`;
}

export function row(text = '', width = panelWidth()) {
  return `│ ${fit(text, width - 4)} │`;
}

export function centered(text = '', width = panelWidth()) {
  const inner = width - 4;
  const raw = String(text);
  const len = visibleLength(raw);
  if (len >= inner) return row(raw, width);
  const left = Math.floor((inner - len) / 2);
  const right = inner - len - left;
  return `│ ${' '.repeat(left)}${raw}${' '.repeat(right)} │`;
}

export function printHeader(title, subtitle = '', { clear = true } = {}) {
  const width = panelWidth();
  if (clear) clearScreen();
  console.log(cyan(top(width)));
  console.log(cyan(centered('WA PROMO BOT', width)));
  console.log(cyan(centered(title, width)));
  if (subtitle) console.log(dim(centered(subtitle, width)));
  console.log(cyan(divider(width)));
  return width;
}

export function printFooter(text = '', width = panelWidth()) {
  if (text) {
    console.log(cyan(divider(width)));
    console.log(dim(centered(text, width)));
  }
  console.log(cyan(bottom(width)));
}

export function printRows(lines, width = panelWidth()) {
  for (const item of lines) {
    if (typeof item === 'string') console.log(row(item, width));
    else console.log((item.paint ?? (x => x))(row(item.text ?? '', width)));
  }
}

export function badge(ok, yes = 'READY', no = 'BELUM') {
  return ok ? green(`● ${yes}`) : yellow(`● ${no}`);
}

export function statusText(ok, yes = 'READY', no = 'BELUM') {
  return ok ? `● ${yes}` : `● ${no}`;
}

export function printMessage(title, message, kind = 'info') {
  const paintFn = kind === 'success' ? green : kind === 'error' ? red : kind === 'warning' ? yellow : white;
  const width = printHeader(title);
  console.log(paintFn(row('', width)));
  for (const part of String(message).split('\n')) console.log(paintFn(row(part, width)));
  console.log(paintFn(row('', width)));
  printFooter('', width);
}
