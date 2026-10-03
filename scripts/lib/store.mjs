/** 仓库文件遍历与 JSON 读取工具。 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR_NAME } from './paths.mjs';

/** 仓库根目录（本文件位于 <root>/scripts/lib/）。 */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * 递归列出 walkthroughs/ 下所有 .json 文件，返回仓库相对路径（POSIX 分隔），
 * 结果按字典序稳定排序，保证 build-index 输出可复现。
 */
export async function listWalkthroughFiles(root = REPO_ROOT) {
  const base = path.join(root, ROOT_DIR_NAME);
  const found = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        found.push(toPosix(path.relative(root, full)));
      }
    }
  }

  await walk(base);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 读取并解析 JSON 文件。 */
export async function readJsonFile(relPath, root = REPO_ROOT) {
  const text = await readFile(path.join(root, relPath), 'utf8');
  return { text, json: JSON.parse(text) };
}