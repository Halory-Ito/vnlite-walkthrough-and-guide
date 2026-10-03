/**
 * 攻略存储路径规则：vid -> walkthroughs/<1-10000>/<1-1000>/<1-100>/v<num>.json
 *
 * 三级分区的起始值都按各自宽度从 1 对齐，因此只需对同一个 n 分别取区间即可，
 * 天然满足「上一级包含下一级」的嵌套关系。
 *
 *   v11   -> walkthroughs/1-10000/1-1000/1-100/v11.json
 *   v184  -> walkthroughs/1-10000/1-1000/101-200/v184.json
 *   v1234 -> walkthroughs/1-10000/1001-2000/1201-1300/v1234.json
 *   v18437-> walkthroughs/10001-20000/18001-19000/18401-18500/v18437.json
 */

export const ROOT_DIR_NAME = 'walkthroughs';
export const INDEX_REL = 'index.json';
export const LEVEL_WIDTHS = [10000, 1000, 100];
export const VID_RE = /^v(\d+)$/;

/** 解析并规范化 vid，非法时返回 null。 */
export function parseVid(vid) {
  if (typeof vid !== 'string') return null;
  const m = VID_RE.exec(vid.trim().toLowerCase());
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isSafeInteger(num) || num < 1) return null;
  return { vid: `v${num}`, num };
}

/** 区间目录名，如 (1, 10000) -> "1-10000"。 */
export function rangeDirName(start, width) {
  return `${start}-${start + width - 1}`;
}

/** 该 vid 应当存放的仓库相对路径（始终使用 / 分隔）。 */
export function walkthroughPath(num) {
  const dirs = LEVEL_WIDTHS.map((width) => rangeDirName(Math.floor((num - 1) / width) * width + 1, width));
  return `${[ROOT_DIR_NAME, ...dirs, `v${num}.json`].join('/')}`;
}

/** 该 vid 应当存放的三级分区目录名（不含根目录与文件名）。 */
export function walkthroughDirs(num) {
  return LEVEL_WIDTHS.map((width) => rangeDirName(Math.floor((num - 1) / width) * width + 1, width));
}

/** 整个分区树的根级目录范围，数量由最大 vid 决定。 */
export function topLevelRangeCount(maxNum) {
  return Math.max(1, Math.ceil(maxNum / LEVEL_WIDTHS[0]));
}