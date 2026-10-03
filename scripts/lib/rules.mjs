/**
 * 攻略数据的字段规则与校验。
 *
 * 字段定义来自项目 README 的「字段说明」，校验器是它的可执行版本：
 *   - error   -> 会让 validate / CI 失败
 *   - warning -> 只提示（多为风格或扩展字段问题）
 */

export const STEP_TYPES = ['choice', 'save', 'load', 'note'];
export const ENDING_TYPES = ['normal', 'bad', 'good', 'true'];

export const TOP_KEYS = ['vid', 'name', 'level', 'author', 'contact', 'updatedAt', 'tips', 'routes'];
export const ROUTE_KEYS = ['id', 'name', 'description', 'endings'];
export const ENDING_KEYS = ['id', 'name', 'type', 'requirements', 'steps'];
export const STEP_KEYS = ['id', 'type', 'content', 'prefix', 'subfix', 'group'];

/** id 建议格式：<kind>_<timestamp 或短 slug>，如 step_1755094701246。 */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
export const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** 严格校验 YYYY-MM-DD，并确认是真实存在的日期（如 2026-02-30 不合法）。 */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 今天的 UTC 日期字符串，用于提示 updatedAt 是否写成了未来日期。 */
export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

class Collector {
  constructor(file) {
    this.file = file;
    this.errors = [];
    this.warnings = [];
  }

  error(where, message) {
    this.errors.push({ file: this.file, where, message });
  }

  warn(where, message) {
    this.warnings.push({ file: this.file, where, message });
  }
}

function checkKnownKeys(c, where, obj, known) {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) {
      c.warn(where, `未知字段 "${key}"（当前允许：${known.join(', ')}）`);
    }
  }
}

function checkUniqueId(c, where, value, seen, kind) {
  if (value === undefined) return;
  if (!isNonEmptyString(value)) {
    c.error(where, `id 必须是非空字符串，实际为 ${JSON.stringify(value)}`);
    return;
  }
  if (!ID_RE.test(value)) {
    c.warn(where, `id "${value}" 建议使用 ${kind}_<timestamp> 形式，只含字母数字与 . _ : -`);
  }
  if (seen.has(value)) {
    c.error(where, `id "${value}" 重复（本文件内 ${kind} 级 id 必须唯一）`);
  }
  seen.add(value);
}

function checkEnum(c, where, value, allowed, fallback) {
  if (value === undefined) return fallback;
  if (!allowed.includes(value)) {
    c.error(where, `type 必须是 ${allowed.map((v) => `"${v}"`).join(' / ')}，实际为 ${JSON.stringify(value)}`);
    return fallback;
  }
  return value;
}

function validateStep(c, step, where, seenStepIds) {
  if (!isPlainObject(step)) {
    c.error(where, `步骤必须是对象，实际为 ${JSON.stringify(step)}`);
    return 0;
  }
  checkKnownKeys(c, where, step, STEP_KEYS);
  checkUniqueId(c, where, step.id, seenStepIds, 'step');

  if (!isNonEmptyString(step.content)) {
    c.error(`${where}.content`, 'content 必填，且必须是非空字符串');
  }

  const type = checkEnum(c, where, step.type, STEP_TYPES, 'choice');

  for (const key of ['prefix', 'subfix', 'group']) {
    if (step[key] !== undefined && !isNonEmptyString(step[key])) {
      c.error(`${where}.${key}`, `${key} 若提供则必须是非空字符串`);
    }
  }

  // 常见笔误提示
  if (step.subfix !== undefined && step.suffix !== undefined) {
    c.error(where, 'subfix 与 suffix 只能保留一个（规范字段名为 subfix）');
  }
  if (type === 'save' || type === 'load') {
    if (step.prefix === '※' || step.prefix === '★') {
      c.warn(where, `${type} 步骤通常不需要 prefix（${step.prefix}）标记`);
    }
  }

  return 1;
}

function validateEnding(c, ending, where, seenEndingIds, seenStepIds) {
  if (!isPlainObject(ending)) {
    c.error(where, `结局必须是对象，实际为 ${JSON.stringify(ending)}`);
    return { endings: 0, steps: 0 };
  }
  checkKnownKeys(c, where, ending, ENDING_KEYS);
  checkUniqueId(c, where, ending.id, seenEndingIds, 'ending');

  if (!isNonEmptyString(ending.name)) {
    c.error(`${where}.name`, 'name 必填，且必须是非空字符串');
  }

  const type = checkEnum(c, where, ending.type, ENDING_TYPES, 'normal');

  if (ending.requirements !== undefined && !isNonEmptyString(ending.requirements)) {
    c.error(`${where}.requirements`, 'requirements 若提供则必须是非空字符串');
  }

  if (!Array.isArray(ending.steps)) {
    c.error(`${where}.steps`, 'steps 必填，且必须是数组');
    return { endings: 1, steps: 0 };
  }
  if (ending.steps.length === 0) {
    c.error(`${where}.steps`, 'steps 不能为空数组');
  }
  if (type === 'true' && ending.requirements === undefined) {
    c.warn(where, '真结局建议填写 requirements 说明开启条件');
  }

  let steps = 0;
  ending.steps.forEach((step, i) => {
    steps += validateStep(c, step, `${where}.steps[${i}]`, seenStepIds);
  });

  return { endings: 1, steps };
}

function validateRoute(c, route, where, seenRouteIds, seenEndingIds, seenStepIds) {
  if (!isPlainObject(route)) {
    c.error(where, `路线必须是对象，实际为 ${JSON.stringify(route)}`);
    return { routes: 0, endings: 0, steps: 0 };
  }
  checkKnownKeys(c, where, route, ROUTE_KEYS);
  checkUniqueId(c, where, route.id, seenRouteIds, 'route');

  if (!isNonEmptyString(route.name)) {
    c.error(`${where}.name`, 'name 必填，且必须是非空字符串');
  }

  if (route.description !== undefined && !isNonEmptyString(route.description)) {
    c.error(`${where}.description`, 'description 若提供则必须是非空字符串');
  }

  if (!Array.isArray(route.endings)) {
    c.error(`${where}.endings`, 'endings 必填，且必须是数组');
    return { routes: 1, endings: 0, steps: 0 };
  }
  if (route.endings.length === 0) {
    c.error(`${where}.endings`, 'endings 不能为空数组');
  }

  let totals = { endings: 0, steps: 0 };
  route.endings.forEach((ending, i) => {
    const r = validateEnding(c, ending, `${where}.endings[${i}]`, seenEndingIds, seenStepIds);
    totals.endings += r.endings;
    totals.steps += r.steps;
  });

  return { routes: 1, ...totals };
}

function validateName(c, value) {
  if (!isPlainObject(value)) {
    c.error('name', 'name 若提供则必须是语言代码到字符串的对象，如 { "zh-cn": "标题" }');
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) c.warn('name', 'name 是空对象，建议至少提供一个语言版本');
  for (const [locale, title] of Object.entries(value)) {
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale)) {
      c.warn(`name.${locale}`, `语言代码 "${locale}" 建议使用 BCP 47 形式（如 zh-cn、ja、en）`);
    }
    if (!isNonEmptyString(title)) {
      c.error(`name.${locale}`, '标题必须是非空字符串');
    }
  }
}

/**
 * 校验单个攻略对象。
 *
 * @param {object} doc 解析后的 JSON
 * @param {object} [ctx] { file } 用于错误信息定位
 * @returns {{errors: Array, warnings: Array, vid: string|null, updatedAt: string|null, stats: object}}
 */
export function validateWalkthrough(doc, ctx = {}) {
  const c = new Collector(ctx.file ?? '<memory>');

  const emptyStats = { routes: 0, endings: 0, steps: 0 };
  if (!isPlainObject(doc)) {
    c.error('$', `攻略文件根节点必须是对象，实际为 ${JSON.stringify(doc)}`);
    return { errors: c.errors, warnings: c.warnings, vid: null, updatedAt: null, stats: emptyStats };
  }

  checkKnownKeys(c, '$', doc, TOP_KEYS);

  let vid = null;
  if (!isNonEmptyString(doc.vid)) {
    c.error('vid', 'vid 必填，且必须是 "v" + 数字，例如 "v184"');
  } else if (!/^v\d+$/i.test(doc.vid.trim())) {
    c.error('vid', `vid 必须形如 "v184"，实际为 ${JSON.stringify(doc.vid)}`);
  } else {
    vid = `v${Number(doc.vid.trim().slice(1))}`;
    if (vid !== doc.vid.trim()) c.warn('vid', `建议使用规范写法 ${vid}`);
  }

  if (doc.name !== undefined) validateName(c, doc.name);

  if (doc.level !== undefined) {
    const ok = typeof doc.level === 'number' && Number.isInteger(doc.level) && doc.level >= 0;
    if (!ok) c.error('level', 'level 若提供则必须是非负整数');
  }

  for (const key of ['author', 'contact']) {
    if (doc[key] !== undefined && !isNonEmptyString(doc[key])) {
      c.error(key, `${key} 若提供则必须是非空字符串`);
    }
  }

  let updatedAt = null;
  if (doc.updatedAt === undefined) {
    c.error('updatedAt', 'updatedAt 必填，格式 YYYY-MM-DD，例如 "2026-10-01"');
  } else if (!isIsoDate(doc.updatedAt)) {
    c.error('updatedAt', `updatedAt 必须是真实存在的 YYYY-MM-DD 日期，实际为 ${JSON.stringify(doc.updatedAt)}`);
  } else {
    updatedAt = doc.updatedAt;
    if (doc.updatedAt > todayUtc()) c.warn('updatedAt', `updatedAt ${doc.updatedAt} 晚于今天，请确认是否写错年份`);
  }

  if (doc.tips !== undefined) {
    if (!isStringArray(doc.tips)) c.error('tips', 'tips 若提供则必须是字符串数组');
    else if (doc.tips.length === 0) c.warn('tips', 'tips 是空数组，建议直接省略');
  }

  let stats = emptyStats;
  if (!Array.isArray(doc.routes)) {
    c.error('routes', 'routes 必填，且必须是数组');
  } else if (doc.routes.length === 0) {
    c.error('routes', 'routes 不能为空数组');
  } else {
    const seenRouteIds = new Set();
    const seenEndingIds = new Set();
    const seenStepIds = new Set();
    stats = { routes: 0, endings: 0, steps: 0 };
    doc.routes.forEach((route, i) => {
      const r = validateRoute(c, route, `routes[${i}]`, seenRouteIds, seenEndingIds, seenStepIds);
      stats.routes += r.routes;
      stats.endings += r.endings;
      stats.steps += r.steps;
    });
  }

  return { errors: c.errors, warnings: c.warnings, vid, updatedAt, stats };
}