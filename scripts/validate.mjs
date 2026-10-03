#!/usr/bin/env node
/**
 * 校验 walkthroughs/ 下所有攻略文件是否符合字段规范，并检查文件路径是否与 vid 匹配。
 *
 *   node scripts/validate.mjs            校验全部文件
 *   node scripts/validate.mjs --strict   警告也视为失败
 *   node scripts/validate.mjs v11 v184   只校验指定 vid（按 vid 或文件名匹配）
 */

import path from 'node:path';
import process from 'node:process';
import { REPO_ROOT, listWalkthroughFiles, readJsonFile } from './lib/store.mjs';
import { INDEX_REL, parseVid, walkthroughPath } from './lib/paths.mjs';
import { validateWalkthrough } from './lib/rules.mjs';
import { c } from './lib/cli.mjs';

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const filters = argv.filter((a) => !a.startsWith('--')).map((a) => a.replace(/\.json$/i, '').toLowerCase());

function printIssue(issue, color, label) {
  const where = issue.where === '$' ? '' : ` ${c.gray(issue.where)}`;
  process.stdout.write(`${color(`${label}${where}: ${issue.message}`)}\n`);
}

async function main() {
  const files = await listWalkthroughFiles(REPO_ROOT);
  const selected = files.filter((f) => {
    if (filters.length === 0) return true;
    return filters.includes(path.basename(f, '.json').toLowerCase());
  });

  if (filters.length > 0 && selected.length === 0) {
    process.stderr.write(`${c.red('错误')}：没有匹配到 ${filters.join(', ')} 对应的攻略文件\n`);
    process.exit(1);
  }

  if (selected.length === 0) {
    process.stdout.write(`${c.yellow('警告')}：walkthroughs/ 下还没有任何攻略文件，跳过校验\n`);
    return;
  }

  let errorCount = 0;
  let warningCount = 0;
  const seenVids = new Map();

  for (const file of selected) {
    let doc;
    try {
      ({ json: doc } = await readJsonFile(file, REPO_ROOT));
    } catch (err) {
      process.stdout.write(`${c.red('错误')} ${file}: JSON 解析失败 -> ${err.message}\n`);
      errorCount += 1;
      continue;
    }

    const result = validateWalkthrough(doc, { file });
    errorCount += result.errors.length;
    warningCount += result.warnings.length;

    for (const e of result.errors) printIssue(e, c.red, '错误');
    for (const w of result.warnings) printIssue(w, c.yellow, '警告');

    if (result.vid) {
      const expected = walkthroughPath(Number(result.vid.slice(1)));
      if (expected !== file) {
        process.stdout.write(
          `${c.red('错误')} ${file}: vid ${result.vid} 应存放于 ${c.bold(expected)}\n`,
        );
        errorCount += 1;
      }
      if (seenVids.has(result.vid)) {
        process.stdout.write(
          `${c.red('错误')} ${file}: vid ${result.vid} 与 ${seenVids.get(result.vid)} 重复\n`,
        );
        errorCount += 1;
      } else {
        seenVids.set(result.vid, file);
      }
    }
  }

  const stats = `校验 ${c.bold(String(selected.length))} 个攻略文件：${c.red(`${errorCount} 个错误`)}，${c.yellow(`${warningCount} 个警告`)}`;
  if (errorCount > 0) {
    process.stdout.write(`${stats}\n`);
    process.exit(1);
  }
  if (warningCount > 0 && strict) {
    process.stdout.write(`${stats}（--strict：警告视为失败）\n`);
    process.exit(1);
  }
  process.stdout.write(`${stats}，${INDEX_REL} 校验通过\n`);
}

main().catch((err) => {
  process.stderr.write(`${c.red('校验器异常')}：${err.stack ?? err.message}\n`);
  process.exit(1);
});