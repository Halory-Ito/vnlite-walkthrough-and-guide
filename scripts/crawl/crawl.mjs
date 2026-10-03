#!/usr/bin/env node
/**
 * 从 https://www.yjgalgame.com 抓取攻略数据，转换成本库 schema 并写入 walkthroughs/。
 *
 * 数据源：站点每个游戏页都提供结构化 payload
 *   https://www.yjgalgame.com/gal/<slug>/_payload.json
 * 因此这里不做 HTML 解析，而是解码 payload 后按字段映射（见 lib/map.mjs），
 * 只保留本库 schema 需要的字段。
 *
 * 用法：node scripts/crawl/crawl.mjs [选项]，详见 --help
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { REPO_ROOT } from '../lib/store.mjs';
import { walkthroughPath } from '../lib/paths.mjs';
import { validateWalkthrough } from '../lib/rules.mjs';
import { c } from '../lib/cli.mjs';
import { SITEMAP_URL, payloadUrl, pageUrl } from './lib/site.mjs';
import { createFetcher, HttpError } from './lib/http.mjs';
import { SkipError } from './lib/errors.mjs';
import { parseSitemap } from './lib/sitemap.mjs';
import { unflatten, extractGame } from './lib/payload.mjs';
import { mapGameToWalkthrough } from './lib/map.mjs';

const CACHE_DIR = path.join(REPO_ROOT, '.cache', 'yjgalgame');
const REPORT_PATH = path.join(CACHE_DIR, 'last-run.json');
const SOURCES_PATH = path.join(REPO_ROOT, 'data', 'sources', 'yjgalgame.json');
const DEFAULT_VID_MAP = path.join(REPO_ROOT, 'data', 'yjgalgame-vid-map.json');

const HELP = `
从 yjgalgame 抓取攻略 -> 写入 walkthroughs/<分区>/<vid>.json -> 刷新 index.json

用法：
  node scripts/crawl/crawl.mjs [选项]

选择目标：
  --slug <slug>            只处理指定页面（可重复，如 --slug clannad）
  --limit <n>              本次最多处理多少个页面（按 sitemap 顺序）
  --no-sitemap             不读 sitemap，只用 --slug 指定的页面

抓取行为：
  --concurrency <n>        并发请求数（默认 2）
  --delay <ms>             两次请求最小间隔（默认 400）
  --retries <n>            失败重试次数（默认 3）
  --timeout <ms>           单请求超时（默认 30000）
  --max-age <hours>        原始 payload 缓存有效期（默认 24，0 = 永不过期）
  --no-cache               忽略本地缓存，强制重新请求源站
  --user-agent <ua>        自定义 User-Agent（也可用环境变量 CRAWLER_UA）

字段处理：
  --vid <vN>               手动指定 VNDB 编号（配合单个 --slug 使用）
  --vid-map <file>         slug -> vid 映射文件（默认 data/yjgalgame-vid-map.json）
  --author <name>          为导入的攻略统一写入 author
  --contact <text>         为导入的攻略统一写入 contact
  --no-romaji              不把 romaji 标题补进 name
  --keep-duplicate-steps   保留连续重复的步骤（默认去重）

写入行为：
  --force                  覆盖本地已存在的攻略文件
  --dry-run                只解析与校验，不写任何文件
  --no-sources             不更新 data/sources/yjgalgame.json 溯源清单
  --no-index               抓取后不自动执行 validate + build-index
  -h, --help               显示本帮助
`;

function parseArgs(argv) {
  const args = {
    slugs: [],
    limit: null,
    useSitemap: true,
    concurrency: 2,
    delay: 400,
    retries: 3,
    timeout: 30_000,
    maxAge: 24,
    cache: true,
    userAgent: null,
    vid: null,
    vidMap: DEFAULT_VID_MAP,
    author: null,
    contact: null,
    romaji: true,
    dedupeSteps: true,
    force: false,
    dryRun: false,
    sources: true,
    index: true,
    help: false,
  };

  const need = (flag, i) => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`选项 ${flag} 缺少取值`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--slug':
        args.slugs.push(need(flag, i));
        i += 1;
        break;
      case '--limit':
        args.limit = Number(need(flag, i));
        i += 1;
        break;
      case '--no-sitemap':
        args.useSitemap = false;
        break;
      case '--concurrency':
        args.concurrency = Math.max(1, Number(need(flag, i)));
        i += 1;
        break;
      case '--delay':
        args.delay = Math.max(0, Number(need(flag, i)));
        i += 1;
        break;
      case '--retries':
        args.retries = Math.max(0, Number(need(flag, i)));
        i += 1;
        break;
      case '--timeout':
        args.timeout = Number(need(flag, i));
        i += 1;
        break;
      case '--max-age':
        args.maxAge = Number(need(flag, i));
        i += 1;
        break;
      case '--no-cache':
        args.cache = false;
        break;
      case '--user-agent':
        args.userAgent = need(flag, i);
        i += 1;
        break;
      case '--vid':
        args.vid = need(flag, i);
        i += 1;
        break;
      case '--vid-map':
        args.vidMap = path.resolve(need(flag, i));
        i += 1;
        break;
      case '--author':
        args.author = need(flag, i);
        i += 1;
        break;
      case '--contact':
        args.contact = need(flag, i);
        i += 1;
        break;
      case '--no-romaji':
        args.romaji = false;
        break;
      case '--keep-duplicate-steps':
        args.dedupeSteps = false;
        break;
      case '--force':
        args.force = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--no-sources':
        args.sources = false;
        break;
      case '--no-index':
        args.index = false;
        break;
      default:
        throw new Error(`未知选项 ${flag}（用 --help 查看用法）`);
    }
  }
  return args;
}

async function loadVidMap(file) {
  if (!existsSync(file)) return {};
  try {
    const json = JSON.parse(await readFile(file, 'utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  } catch (err) {
    process.stderr.write(`${c.yellow('警告')}：vid 映射文件解析失败（${err.message}），已忽略\n`);
    return {};
  }
}

async function writeFileIfChanged(absPath, content) {
  if (existsSync(absPath)) {
    const current = await readFile(absPath, 'utf8');
    if (current === content) return false;
  }
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, content, 'utf8');
  return true;
}

async function updateSourcesManifest(records) {
  let existing = { games: {} };
  if (existsSync(SOURCES_PATH)) {
    try {
      existing = JSON.parse(await readFile(SOURCES_PATH, 'utf8'));
    } catch {
      existing = { games: {} };
    }
  }

  const games = { ...(existing.games ?? {}) };
  for (const record of records) {
    if (!record.vid) continue;
    games[record.vid] = {
      slug: record.slug,
      url: pageUrl(record.slug),
      vndbIds: record.source.vndbIds,
      updatedAt: record.source.updatedAt,
      routesCount: record.source.routesCount,
      endingsCount: record.source.endingsCount,
      stepsCount: record.source.stepsCount,
    };
  }

  const sorted = Object.fromEntries(
    Object.entries(games).sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1))),
  );

  const manifest = {
    source: 'https://www.yjgalgame.com',
    sitemap: SITEMAP_URL,
    note: '抓取溯源清单：vid -> 源页面。仅用于署名与核对，攻略内容以 walkthroughs/ 内的文件为准。',
    games: sorted,
  };

  await mkdir(path.dirname(SOURCES_PATH), { recursive: true });
  await writeFileIfChanged(SOURCES_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return Object.keys(sorted).length;
}

function runNode(script) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', script)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  return result.status === 0;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${c.red('参数错误')}：${err.message}\n`);
    process.exit(1);
  }
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const vidMap = await loadVidMap(args.vidMap);
  const fetcher = createFetcher({
    cacheDir: CACHE_DIR,
    cacheMaxAgeMs: args.maxAge * 3600 * 1000,
    userAgent: args.userAgent ?? undefined,
    timeoutMs: args.timeout,
    retries: args.retries,
    concurrency: args.concurrency,
    delayMs: args.delay,
    log: (msg) => process.stderr.write(`${c.gray(msg)}\n`),
  });

  // 1. 页面清单
  let items = [];
  if (args.useSitemap) {
    process.stdout.write(`${c.gray('读取 sitemap…')}\n`);
    const { text } = await fetcher.get(SITEMAP_URL, { useCache: false });
    items = parseSitemap(text, SITEMAP_URL);
    process.stdout.write(`sitemap 共 ${c.bold(String(items.length))} 个游戏页面\n`);
  }

  if (args.slugs.length > 0) {
    const known = new Map(items.map((it) => [it.slug, it]));
    const picked = [];
    for (const slug of args.slugs) {
      picked.push(known.get(slug) ?? { slug, url: pageUrl(slug), lastmod: null });
    }
    items = picked;
  }

  if (args.limit !== null) items = items.slice(0, Math.max(0, args.limit));

  if (items.length === 0) {
    process.stdout.write(`${c.yellow('没有待抓取的页面')}，用 --slug 指定页面可单独抓取\n`);
    return;
  }

  // 2. 逐页抓取 + 映射 + 写入
  const records = [];
  const unknownTags = new Set();
  const seenVids = new Map();
  const writeQueue = new Map();
  const total = items.length;
  let done = 0;

  // 卡死检测：源站偶尔会建立连接后不发送完整响应，若超过阈值没有任何进展就提醒
  let lastProgressAt = Date.now();
  const stallWatch = setInterval(() => {
    const idleSec = Math.round((Date.now() - lastProgressAt) / 1000);
    if (idleSec >= 45) {
      process.stderr.write(
        `${c.yellow(`已连续 ${idleSec} 秒没有进展`)}（已完成 ${done}/${total}）。` +
          `${c.gray('若持续无进展，可 Ctrl+C 后降低 --concurrency / 调大 --delay 重跑，已抓到的页面有缓存不会重复请求。')}\n`,
      );
      lastProgressAt = Date.now();
    }
  }, 15_000);
  stallWatch.unref?.();

  const symbol = { written: c.green('✓'), unchanged: c.gray('·'), skipped: c.yellow('-'), failed: c.red('!'), 'dry-run': c.blue('?') };

  const handle = async (item) => {
    const base = { slug: item.slug, vid: null, path: null, source: null, warnings: [] };
    try {
      const { text } = await fetcher.get(payloadUrl(item.slug), { useCache: args.cache });
      const { root, unknownTags: tags } = unflatten(JSON.parse(text));
      for (const tag of tags) unknownTags.add(tag);
      const game = extractGame(root, item.slug);

      const { doc, source } = mapGameToWalkthrough(game, {
        slug: item.slug,
        url: pageUrl(item.slug),
        lastmod: item.lastmod,
        author: args.author,
        contact: args.contact,
        vid: args.vid ?? vidMap[item.slug] ?? null,
        addRomaji: args.romaji,
        dedupeSteps: args.dedupeSteps,
      });

      const relPath = walkthroughPath(Number(doc.vid.slice(1)));
      const check = validateWalkthrough(doc, { file: relPath });
      if (check.errors.length > 0) {
        throw new Error(`转换结果未通过本地 schema：${check.errors.map((e) => `${e.where} ${e.message}`).join('；')}`);
      }

      if (seenVids.has(doc.vid)) {
        return { ...base, vid: doc.vid, path: relPath, status: 'skipped', reason: `与 ${seenVids.get(doc.vid)} 映射到同一 vid` };
      }

      const record = { ...base, vid: doc.vid, path: relPath, source, status: 'written', warnings: source.warnings };
      if (args.dryRun) {
        record.status = 'dry-run';
      } else {
        // 同一 vid 的并发写入串行化
        const previous = writeQueue.get(doc.vid) ?? Promise.resolve();
        const task = previous.then(async () => {
          const abs = path.join(REPO_ROOT, ...relPath.split('/'));
          if (existsSync(abs) && !args.force) {
            record.status = 'unchanged';
            record.reason = '本地已有该攻略（--force 可覆盖）';
            return;
          }
          record.changed = await writeFileIfChanged(abs, `${JSON.stringify(doc, null, 2)}\n`);
        });
        writeQueue.set(doc.vid, task.catch(() => {}));
        await task;
      }

      seenVids.set(doc.vid, item.slug);
      return record;
    } catch (err) {
      if (err instanceof SkipError) return { ...base, status: 'skipped', reason: err.reason };
      if (err instanceof HttpError) return { ...base, status: 'failed', reason: err.message };
      return { ...base, status: 'failed', reason: err.message };
    }
  };

  const results = await Promise.all(
    items.map(async (item) => {
      const record = await handle(item);
      done += 1;
      lastProgressAt = Date.now();
      const label = `${symbol[record.status]} ${String(done).padStart(3)}/${total} ${item.slug}`;
      const detail = record.vid ? ` -> ${record.vid}${record.reason ? `（${record.reason}）` : ''}` : record.reason ? `（${record.reason}）` : '';
      process.stdout.write(`${c.gray('  ')}${label}${c.gray(detail)}\n`);
      return record;
    }),
  );

  clearInterval(stallWatch);

  records.push(...results);

  // 3. 汇总
  const count = (status) => results.filter((r) => r.status === status).length;
  const written = results.filter((r) => r.status === 'written' || r.status === 'dry-run');
  // 溯源清单记录的是 vid -> 源页面的对应关系，凡是成功解析出 vid 的页面都应登记，
  // 否则重跑时全是「未变」会导致清单长期停留在首次导入的规模。
  const mapped = results.filter((r) => r.source && r.vid);
  const warnings = results.flatMap((r) => r.warnings.map((w) => `${r.slug}: ${w}`));

  process.stdout.write('\n');
  process.stdout.write(
    `${c.green('完成')}：写入 ${c.bold(String(count('written')))}，未变 ${count('unchanged')}，` +
      `跳过 ${count('skipped')}，失败 ${count('failed')}，试运行 ${count('dry-run')}\n`,
  );
  process.stdout.write(
    `${c.gray(`请求 ${fetcher.stats.fetched} 次 / 命中缓存 ${fetcher.stats.cached} 次 / ` +
      `重试 ${fetcher.stats.retried} 次 / 超时 ${fetcher.stats.timeout} 次 / ${(fetcher.stats.bytes / 1024).toFixed(0)} KB`)}\n`,
  );

  if (unknownTags.size > 0) {
    process.stdout.write(`${c.yellow('注意')}：payload 中出现未识别的类型标签：${[...unknownTags].join(', ')}\n`);
  }

  const groupBy = (list, key) => {
    const map = new Map();
    for (const item of list) {
      const k = key(item);
      map.set(k, [...(map.get(k) ?? []), item.slug]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  for (const [reason, slugs] of groupBy(results.filter((r) => r.status === 'skipped'), (r) => r.reason)) {
    process.stdout.write(`  ${c.yellow('跳过')} ${reason}：${slugs.length} 个（${slugs.slice(0, 5).join(', ')}${slugs.length > 5 ? ' …' : ''}）\n`);
  }
  for (const [reason, slugs] of groupBy(results.filter((r) => r.status === 'failed'), (r) => r.reason)) {
    process.stdout.write(`  ${c.red('失败')} ${reason}：${slugs.length} 个（${slugs.slice(0, 5).join(', ')}${slugs.length > 5 ? ' …' : ''}）\n`);
  }
  if (warnings.length > 0) {
    process.stdout.write(`  ${c.yellow('字段提示')} ${warnings.length} 条，前 5 条：\n`);
    for (const w of warnings.slice(0, 5)) process.stdout.write(`    ${c.gray(w)}\n`);
  }

  // 4. 溯源清单与索引
  if (args.sources && mapped.length > 0 && !args.dryRun) {
    const totalGames = await updateSourcesManifest(mapped);
    process.stdout.write(`${c.green('已更新溯源清单')}：data/sources/yjgalgame.json（共 ${totalGames} 个游戏）\n`);
  }

  if (!args.dryRun && args.index && (written.length > 0 || count('unchanged') > 0)) {
    const ok = runNode('validate.mjs');
    if (ok) runNode('build-index.mjs');
    else process.stdout.write(`${c.red('校验未通过')}，已跳过 index.json 生成\n`);
  }

  if (!args.dryRun) {
    const report = {
      finishedAt: new Date().toISOString(),
      options: { ...args, vidMap: path.relative(REPO_ROOT, args.vidMap) },
      stats: fetcher.stats,
      results,
    };
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(`${c.gray('运行报告：')}${path.relative(REPO_ROOT, REPORT_PATH)}\n`);
  }

  process.exit(count('failed') > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`${c.red('爬虫异常')}：${err.stack ?? err.message}\n`);
  process.exit(1);
});