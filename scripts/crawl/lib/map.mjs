/**
 * 源站数据 -> 本地攻略 schema 的字段映射。
 *
 * 源站（yjgalgame）与本库字段几乎同构，因此这里只做「筛选 + 规范化 + 兜底」，
 * 不搬运任何本地 schema 用不到的字段：
 *
 *   vndb_id  -> vid          name -> name           level -> level
 *   tips     -> tips         routes[].id/name -> routes[].id/name
 *   routes[].endings[]      -> routes[].endings[]
 *   endings[].id/name/type/requirements -> 同名字段
 *   endings[].steps[]       -> endings[].steps[]（id/type/content/prefix/subfix/group）
 *   updated_at -> updatedAt（只取日期部分）
 *
 * 源站额外字段（uid / cover / romaji / developer / releaseDate / tags /
 * show / nsfw_content / views / views / seoName / created_at 等）一律丢弃。
 * romaji 仅在标题表缺少日文标题时以 ja-Latn 形式补入 name（默认开启）。
 */

import { ENDING_TYPES, STEP_TYPES, isIsoDate } from '../../lib/rules.mjs';
import { parseVid } from '../../lib/paths.mjs';
import { SkipError } from './errors.mjs';

/** 源站 type 值与本地枚举不一致时按此表纠正，其余按默认值处理。 */
const TYPE_FALLBACK = { step: 'choice', ending: 'normal' };

const cleanText = (value) =>
  typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim() : '';

/** 源站 content 理论上已是纯文本；若含简单标签则降级为文本。 */
function cleanContent(value, sanitize) {
  const text = cleanText(value);
  if (!sanitize || !text.includes('<')) return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|li|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 源站 vndb_id 可能是 "v9125"、"9125"、"v9125,v9126" 等写法。 */
export function mapVndbIds(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return [];
  return String(raw)
    .split(/[,，\s/|]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseVid(part)?.vid)
    .filter(Boolean);
}

function mapName(game, { addRomaji }) {
  const name = {};
  const source = game.name && typeof game.name === 'object' && !Array.isArray(game.name) ? game.name : {};
  for (const [locale, title] of Object.entries(source)) {
    const value = cleanText(title);
    if (value) name[String(locale).toLowerCase()] = value;
  }
  if (addRomaji) {
    const romaji = cleanText(game.romaji);
    if (romaji && !name['ja-Latn'] && !Object.values(name).includes(romaji)) name['ja-Latn'] = romaji;
  }
  return Object.keys(name).length > 0 ? name : undefined;
}

function mapLevel(game) {
  const raw = game.level;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return undefined;
}

function mapTips(game) {
  const raw = game.tips;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('\n') : [];
  const tips = list.map(cleanText).filter(Boolean);
  return tips.length > 0 ? tips : undefined;
}

/** 依次尝试 updated_at / updatedAt / created_at / sitemap lastmod。 */
function resolveUpdatedAt(game, lastmod) {
  const toDate = (value) => {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
    }
    if (typeof value === 'string') {
      const head = value.trim().slice(0, 10);
      if (isIsoDate(head)) return head;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
    }
    return null;
  };

  for (const candidate of [game.updated_at, game.updatedAt, game.modified_at, game.created_at, lastmod]) {
    const date = toDate(candidate);
    if (date) return date;
  }
  throw new SkipError('缺少可用的更新日期（updated_at / lastmod 均为空）');
}

const stepSignature = (step) =>
  [step.type, step.content, step.prefix ?? '', step.subfix ?? '', step.group ?? ''].join('\u0000');

/**
 * 源站的 id 只是「行内序号」，并不唯一：常见情况是每个结局都从 step_01 重新编号，
 * 甚至同一结局内出现两个 step_end12_001。本库要求同级 id 唯一，因此重复时追加
 * 确定性后缀（step_01 -> step_01_2），既保留可追溯性，又保证多次抓取结果完全一致。
 *
 * @returns {string|undefined} 去重后的 id；原本无 id 则返回 undefined
 */
function claimId(rawId, seen, kind, renames) {
  const id = cleanText(rawId);
  if (!id) return undefined;
  if (!seen.has(id)) {
    seen.add(id);
    return id;
  }
  let n = 1;
  let candidate = `${id}_${n}`;
  while (seen.has(candidate)) {
    n += 1;
    candidate = `${id}_${n}`;
  }
  seen.add(candidate);
  renames.push(`${kind}: ${id} -> ${candidate}`);
  return candidate;
}

function mapStep(raw, ctx) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const content = cleanContent(source.content, true);
  if (!content) {
    ctx.warnings.push('步骤 content 为空，已跳过');
    return null;
  }

  const step = {};
  const id = claimId(source.id, ctx.ids.step, 'step', ctx.renamedIds);
  if (id) step.id = id;
  step.type = STEP_TYPES.includes(source.type) ? source.type : TYPE_FALLBACK.step;
  step.content = content;
  for (const key of ['prefix', 'subfix', 'group']) {
    const value = cleanContent(source[key], true);
    if (value) step[key] = value;
  }
  return step;
}

function mapSteps(rawSteps, ctx, scopeLabel) {
  const warn = (msg) => ctx.warnings.push(`${scopeLabel}: ${msg}`);
  if (!Array.isArray(rawSteps)) {
    warn('steps 缺失或不是数组，已补一个空步骤占位');
    return [{ type: 'choice', content: '（源站缺少步骤数据）' }];
  }

  const steps = [];
  for (const raw of rawSteps) {
    const step = mapStep(raw, ctx);
    if (!step) continue;
    const previous = steps[steps.length - 1];
    if (ctx.dedupeSteps && previous && stepSignature(previous) === stepSignature(step)) {
      ctx.duplicatedSteps += 1;
      continue;
    }
    steps.push(step);
  }

  if (steps.length === 0) {
    warn('所有步骤都为空，已补一个占位步骤');
    return [{ type: 'choice', content: '（源站步骤均为空）' }];
  }
  return steps;
}

function mapEnding(raw, ctx, index, scopeLabel) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawName = cleanContent(source.name, true);
  const name = rawName || `未命名结局 ${index + 1}`;
  if (!rawName) ctx.warnings.push(`${scopeLabel}: 结局缺少名称，已使用占位名`);

  const ending = {};
  const id = claimId(source.id, ctx.ids.ending, 'ending', ctx.renamedIds);
  if (id) ending.id = id;
  ending.name = name;
  ending.type = ENDING_TYPES.includes(source.type) ? source.type : TYPE_FALLBACK.ending;
  const requirements = cleanContent(source.requirements, true);
  if (requirements) ending.requirements = requirements;
  ending.steps = mapSteps(source.steps, ctx, `${scopeLabel}「${name}」`);
  return ending;
}

function mapRoute(raw, ctx, index) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawName = cleanContent(source.name, true);
  const name = rawName || `未命名路线 ${index + 1}`;
  if (!rawName) ctx.warnings.push(`routes[${index}]: 路线缺少名称，已使用占位名`);

  const rawEndings = Array.isArray(source.endings) ? source.endings : [];
  const endings = rawEndings.map((e, i) => mapEnding(e, ctx, i, `routes[${index}]「${name}」`));

  if (endings.length === 0) {
    ctx.warnings.push(`routes[${index}]「${name}」: 没有结局，已补占位结局`);
    endings.push(mapEnding({ name: `${name} END`, steps: [] }, ctx, 0, `routes[${index}]「${name}」`));
  }

  const route = {};
  const id = claimId(source.id, ctx.ids.route, 'route', ctx.renamedIds);
  if (id) route.id = id;
  route.name = name;
  route.endings = endings;
  return route;
}

/**
 * 把源站游戏对象映射为本地攻略对象。
 *
 * @param {object} game extractGame() 的结果
 * @param {object} ctx { slug, url, lastmod, author, contact, vid, addRomaji, dedupeSteps }
 * @returns {{doc: object, source: object}} doc 通过 schema 校验，source 用于溯源清单
 * @throws {SkipError} 数据不足以生成攻略时抛出
 */
export function mapGameToWalkthrough(game, ctx) {
  const {
    slug,
    url,
    lastmod = null,
    author = null,
    contact = null,
    vid: vidOverride = null,
    addRomaji = true,
    dedupeSteps = true,
  } = ctx;

  if (game.show === false) throw new SkipError('源站标记为未发布（show=false）');

  const vndbIds = mapVndbIds(game.vndb_id);
  const vid = vidOverride ?? vndbIds[0] ?? null;
  if (!vid) throw new SkipError('缺少 vndb_id，无法确定 VNDB 编号（可用 --vid vN 手动指定）');

  const state = {
    warnings: [],
    dedupeSteps,
    duplicatedSteps: 0,
    renamedIds: [],
    ids: { route: new Set(), ending: new Set(), step: new Set() },
  };
  const routes = (Array.isArray(game.routes) ? game.routes : []).map((r, i) => mapRoute(r, state, i));

  if (routes.length === 0) throw new SkipError('源站没有 routes 数据');

  const doc = { vid };
  const name = mapName(game, { addRomaji });
  if (name) doc.name = name;
  const level = mapLevel(game);
  if (level !== undefined) doc.level = level;
  if (author) doc.author = author;
  if (contact) doc.contact = contact;
  doc.updatedAt = resolveUpdatedAt(game, lastmod);
  const tips = mapTips(game);
  if (tips) doc.tips = tips;
  doc.routes = routes;

  const stats = {
    routesCount: routes.length,
    endingsCount: routes.reduce((n, r) => n + r.endings.length, 0),
    stepsCount: routes.reduce((n, r) => n + r.endings.reduce((m, e) => m + e.steps.length, 0), 0),
  };

  if (state.renamedIds.length > 0) {
    state.warnings.push(
      `源站 id 重复，已自动追加后缀 ${state.renamedIds.length} 处（例：${state.renamedIds.slice(0, 3).join('；')}）`,
    );
  }

  return {
    doc,
    source: {
      slug,
      url,
      vndbIds,
      updatedAt: doc.updatedAt,
      ...stats,
      warnings: state.warnings,
      duplicatedSteps: state.duplicatedSteps,
      renamedIds: state.renamedIds.length,
    },
  };
}