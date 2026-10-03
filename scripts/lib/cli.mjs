/** 极简终端着色（无第三方依赖，尊重 NO_COLOR / 非 TTY）。 */

const enabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  process.stdout.isTTY === true;

const wrap = (code) => (s) => (enabled ? `\u001B[${code}m${s}\u001B[0m` : String(s));

export const c = {
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  gray: wrap(90),
  bold: wrap(1),
};