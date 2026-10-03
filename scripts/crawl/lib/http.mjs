/**
 * 带缓存、限速与重试的抓取器。
 *
 * 礼貌抓取默认值：并发 2、请求间隔 400ms、UA 可识别、失败指数退避、
 * 429/503 遵循 Retry-After、原始响应落盘缓存（默认 24h 内不重复请求源站）。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_UA } from './site.mjs';

export class HttpError extends Error {
  constructor(status, url, retryAfter = null) {
    super(`HTTP ${status} ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retryable = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

/**
 * @param {object} options
 * @param {string} [options.cacheDir] 原始响应缓存目录
 * @param {number} [options.cacheMaxAgeMs] 缓存有效期，0 表示永久有效
 * @param {string} [options.userAgent]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries]
 * @param {number} [options.concurrency]
 * @param {number} [options.delayMs] 两次请求之间的最小间隔
 * @param {(msg: string) => void} [options.log]
 */
export function createFetcher(options = {}) {
  const {
    cacheDir = null,
    cacheMaxAgeMs = 24 * 60 * 60 * 1000,
    userAgent = process.env.CRAWLER_UA || DEFAULT_UA,
    timeoutMs = 30_000,
    retries = 3,
    concurrency = 2,
    delayMs = 400,
    log = () => {},
  } = options;

  const stats = { fetched: 0, cached: 0, retried: 0, failed: 0, bytes: 0 };

  let active = 0;
  const waiters = [];
  const release = () => {
    active -= 1;
    waiters.shift()?.();
  };
  const acquire = async () => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise((resolve) => waiters.push(resolve));
    active += 1;
  };

  // 串行化的最小间隔控制
  let lastStart = 0;
  let gateChain = Promise.resolve();
  const gate = () => {
    const run = gateChain.then(async () => {
      const wait = lastStart + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
    });
    gateChain = run.catch(() => {});
    return run;
  };

  const cachePath = (url) => path.join(cacheDir, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.txt`);

  async function readCache(url) {
    if (!cacheDir) return null;
    const file = cachePath(url);
    try {
      const info = await stat(file);
      if (cacheMaxAgeMs > 0 && Date.now() - info.mtimeMs > cacheMaxAgeMs) return null;
      const text = await readFile(file, 'utf8');
      if (text === '') return null;
      return text;
    } catch {
      return null;
    }
  }

  async function writeCache(url, text) {
    if (!cacheDir) return;
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath(url), text, 'utf8');
  }

  /** 抓取文本，失败时按指数退避重试。 */
  async function get(url, { useCache = true } = {}) {
    if (useCache) {
      const hit = await readCache(url);
      if (hit !== null) {
        stats.cached += 1;
        return { text: hit, fromCache: true };
      }
    }

    await acquire();
    try {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (attempt > 0) {
          stats.retried += 1;
          const backoff = Math.min(30_000, 800 * 2 ** (attempt - 1));
          const hint = lastError instanceof HttpError && lastError.retryAfter
            ? Number(lastError.retryAfter) * 1000
            : backoff;
          log(`重试 ${attempt}/${retries}（等待 ${Math.round(hint / 100) / 10}s）：${url}`);
          await sleep(hint);
          await gate();
        } else {
          await gate();
        }

        try {
          const res = await fetch(url, {
            headers: { 'user-agent': userAgent, accept: '*/*' },
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
          });

          if (!res.ok) {
            const retryAfter = res.headers.get('retry-after');
            const err = new HttpError(res.status, url, retryAfter ? Number(retryAfter) : null);
            if (retryable(res.status) && attempt < retries) {
              lastError = err;
              continue;
            }
            throw err;
          }

          const text = await res.text();
          stats.fetched += 1;
          stats.bytes += text.length;
          await writeCache(url, text);
          return { text, fromCache: false };
        } catch (err) {
          if (err instanceof HttpError && !retryable(err.status)) throw err;
          lastError = err;
          if (attempt === retries) break;
        }
      }

      stats.failed += 1;
      throw lastError instanceof Error ? lastError : new Error(`抓取失败: ${url}`);
    } finally {
      release();
    }
  }

  return { get, stats, options: { cacheDir, concurrency, delayMs, userAgent } };
}