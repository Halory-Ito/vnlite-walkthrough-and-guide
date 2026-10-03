#!/usr/bin/env node
/**
 * 扫描 walkthroughs/ 生成根目录 index.json（纯索引：只放元数据与文件路径，不含完整攻略内容）。
 *
 *   node scripts/build-index.mjs            写入 index.json
 *   node scripts/build-index.mjs --check    只比对是否已是最新（CI / pre-commit 用，不写文件）
 *
 * 输出完全由数据决定（不含构建时间戳），因此相同数据必然生成相同 index.json。
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { REPO_ROOT, listWalkthroughFiles, readJsonFile } from './lib/store.mjs';
import { INDEX_REL } from './lib/paths.mjs';
import { validateWalkthrough } from './lib/rules.mjs';
import { c } from './lib/cli.mjs';

export const SCHEMA_VERSION = 1;

/**
 * 由攻略文档生成一条索引记录。
 * 只保留列表页需要的元数据：tips / steps 等详细数据请按 path 拉取原始 json。
 */
export function toIndexEntry(doc, relPath) {
  const { vid, updatedAt, stats } = validateWalkthrough(doc, { file: relPath });
  const entry = {
    vid,
    path: relPath,
    updatedAt,
    routesCount: stats.routes,
    endingsCount: stats.endings,
    stepsCount: stats.steps,
  };
  if (doc.name !== undefined) entry.name = doc.name;
  if (doc.level !== undefined) entry.level = doc.level;
  if (doc.author !== undefined) entry.author = doc.author;
  if (doc.contact !== undefined) entry.contact = doc.contact;
  return entry;
}

/** 组装完整 index.json 内容；记录按 vid 数值升序，便于客户端二分 / 分页。 */
export function buildIndex(entries) {
  const sorted = [...entries].sort((a, b) => Number(a.vid.slice(1)) - Number(b.vid.slice(1)));
  return {
    schemaVersion: SCHEMA_VERSION,
    count: sorted.length,
    latestUpdatedAt: sorted.reduce((max, e) => (e.updatedAt && e.updatedAt > max ? e.updatedAt : max), ''),
    walkthroughs: sorted,
  };
}

export const serialize = (index) => `${JSON.stringify(index, null, 2)}\n`;

async function main() {
  const check = process.argv.includes('--check');
  const files = await listWalkthroughFiles(REPO_ROOT);

  const entries = [];
  const broken = [];
  for (const file of files) {
    let doc;
    try {
      ({ json: doc } = await readJsonFile(file, REPO_ROOT));
    } catch (err) {
      broken.push(`${file}: ${err.message}`);
      continue;
    }
    if (!validateWalkthrough(doc, { file }).vid) continue; // 非法文件交给 validate 报错
    entries.push(toIndexEntry(doc, file));
  }

  const index = buildIndex(entries);
  const content = serialize(index);
  const target = path.join(REPO_ROOT, INDEX_REL);

  if (check) {
    let current = null;
    try {
      current = (await readFile(target, 'utf8')).replace(/\r\n/g, '\n');
    } catch {
      current = null;
    }
    if (current !== content) {
      process.stderr.write(
        `${c.red('错误')}：${INDEX_REL} 与 walkthroughs/ 不同步，请先执行 ${c.bold('npm run build')}\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${c.green('通过')}：${INDEX_REL} 已是最新（${index.count} 条记录）\n`);
    return;
  }

  await writeFile(target, content, 'utf8');
  for (const msg of broken) process.stderr.write(`${c.red('错误')}：${msg}\n`);
  if (broken.length > 0) process.exit(1);

  process.stdout.write(
    `${c.green('已生成')} ${INDEX_REL}：${c.bold(String(index.count))} 条攻略，` +
      `最新更新 ${index.latestUpdatedAt || '—'}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${c.red('构建索引异常')}：${err.stack ?? err.message}\n`);
  process.exit(1);
});