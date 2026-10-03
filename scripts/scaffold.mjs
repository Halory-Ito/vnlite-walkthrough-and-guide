#!/usr/bin/env node
/**
 * 可选工具：批量创建空的分区目录（用于本地浏览 / 补齐目录树）。
 *
 *   node scripts/scaffold.mjs            按当前最大 vid 创建分区目录
 *   node scripts/scaffold.mjs 20000      创建到 1-20000 的完整目录树（本地生成，空目录不入 git）
 *
 * 说明：git 不记录空目录，所以正常情况下无需运行本脚本 —— 攻略文件按 vid 路径
 * 写入时会自动带上需要的分区目录（见 npm run build / 手动 mkdir）。
 */

import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { REPO_ROOT, listWalkthroughFiles } from './lib/store.mjs';
import { ROOT_DIR_NAME, walkthroughDirs, parseVid } from './lib/paths.mjs';
import { c } from './lib/cli.mjs';

async function maxVidNum() {
  const files = await listWalkthroughFiles(REPO_ROOT);
  let max = 0;
  for (const f of files) {
    const parsed = parseVid(path.basename(f, '.json'));
    if (parsed && parsed.num > max) max = parsed.num;
  }
  return max;
}

async function existingDirs(root) {
  const out = new Set();
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      out.add(r);
      await walk(path.join(dir, e.name), r);
    }
  }
  await walk(root, '');
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const explicit = argv.find((a) => /^\d+$/.test(a));
  const maxNum = explicit ? Number(explicit) : await maxVidNum();

  if (!Number.isSafeInteger(maxNum) || maxNum < 1) {
    process.stdout.write(`${c.gray('没有可用的 vid，跳过目录生成。')}\n`);
    return;
  }

  const root = path.join(REPO_ROOT, ROOT_DIR_NAME);
  const have = await existingDirs(root);
  const wanted = new Set();

  // 每个整数都映射到唯一的三级分区；按分区起点枚举即可，无需遍历 1..maxNum。
  for (let start = 1; start <= maxNum; start += 100) {
    const [l1, l2, l3] = walkthroughDirs(start);
    wanted.add(`${l1}/${l2}/${l3}`);
  }

  let created = 0;
  for (const rel of [...wanted].sort()) {
    if (have.has(rel)) continue;
    await mkdir(path.join(root, ...rel.split('/')), { recursive: true });
    created += 1;
  }

  process.stdout.write(
    `${c.green('已创建')} ${created} 个分区目录（1-${maxNum}，共 ${wanted.size} 个）` +
      `${c.gray('  空目录不会被 git 跟踪，仅本地可见')}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${c.red('生成目录异常')}：${err.stack ?? err.message}\n`);
  process.exit(1);
});