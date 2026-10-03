/**
 * 带缓存、限速与重试的抓取器。
 *
 * 礼貌抓取默认值：并发 2、请求间隔 400ms、UA 可识别、失败指数退避、
 * 429/503 遵循 Retry-After、原始响应落盘缓存（默认 24h 内不重复请求源站）。
 *
 * 两个容易被忽略的细节：
 * 1. 超时必须覆盖「响应体读取」。只给 fetch 传 AbortSignal.timeout 不够 ——
 *    服务端建立连接后不发送完整响应时，连接会一直挂着，占满并发槽位导致整体卡死。
 *    这里用 AbortController + 定时器包住 fetch 与 res.text() 全过程。
 * 2. 并发限流用「队列 + 活动计数」实现，计数只在任务真正结束时变化，
 *    避免自增/自减交错导致活动数虚高、进而永久阻塞。
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

/** 队列式并发限流器：同一时刻最多 limit 个任务在执行。 */
function createLimiter(limit) {
  let active = 0;
  const queue = [];

  const pump = () => {
    while (active < limit && queue.length > 0) {
      active += 1;
      queue.shift()();
    }
  };

  return async function limited(job) {
    await new Promise((resolve) => {
      queue.push(resolve);
      pump();
    });
    try {
      return await job();
    } finally {
      active -= 1;
      pump();
    }
  };
}

/**
 * @param {object} options
 * @param {string} [options.cacheDir] 原始响应缓存目录
 * @param {number} [options.cacheMaxAgeMs] 缓存有效期，0 表示永久有效
 * @param {string} [options.userAgent]
 * @param {number} [options.timeoutMs] 单个请求（含响应体读取）的硬超时
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

  const stats = { fetched: 0, cached: 0, retried: 0, failed: 0, timeout: 0, bytes: 0 };
  const limit = createLimiter(Math.max(1, concurrency));

  // 串行化的最小间隔控制 + 全局冷却（源站返回 503/429 或连接挂起时，整条流水线一起退避）
  let lastStart = 0;
  let cooldownUntil = 0;
  const noteCooldown = (ms) => {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
  };
  let gateChain = Promise.resolve();
  const gate = () => {
    const run = gateChain.then(async () => {
      const earliest = Math.max(lastStart + delayMs, cooldownUntil);
      const wait = earliest - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
    });
    gateChain = run.catch(() => {});
    return run;
  };

  const cachePath = (url) =>
    path.join(cacheDir, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.txt`);

  async function readCache(url) {
    if (!cacheDir) return null;
    try {
      const file = cachePath(url);
      const info = await stat(file);
      if (cacheMaxAgeMs > 0 && Date.now() - info.mtimeMs > cacheMaxAgeMs) return null;
      const text = await readFile(file, 'utf8');
      return text === '' ? null : text;
    } catch {
      return null;
    }
  }

  async function writeCache(url, text) {
    if (!cacheDir) return;
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath(url), text, 'utf8');
  }

  /** 单次尝试：超时同时覆盖 fetch 与响应体读取。 */
  async function attempt(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      stats.timeout += 1;
      controller.abort(new Error(`请求超时（${timeoutMs}ms）`));
    }, timeoutMs);

    try {
      const res = await fetch(url, {
        headers: { 'user-agent': userAgent, accept: '*/*' },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!res.ok) {
        const retryAfter = res.headers.get('retry-after');
        res.body?.cancel().catch(() => {});
        throw new HttpError(res.status, url, retryAfter ? Number(retryAfter) : null);
      }

      return await res.text();
    } finally {
      clearTimeout(timer);
    }
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

    return limit(async () => {
      let lastError;
      for (let attemptNo = 0; attemptNo <= retries; attemptNo += 1) {
        if (attemptNo > 0) {
          stats.retried += 1;
          const backoff = Math.min(30_000, 800 * 2 ** (attemptNo - 1));
          const waitMs = Math.min(
            60_000,
            lastError instanceof HttpError && lastError.retryAfter
              ? Math.max(backoff, Number(lastError.retryAfter) * 1000)
              : backoff,
          );
          log(
            `重试 ${attemptNo}/${retries}：${lastError?.message ?? '未知错误'}；` +
              `${Math.round(waitMs / 100) / 10}s 后重试 ${url}`,
          );
          await sleep(waitMs);
        }

        await gate();
        try {
          const text = await attempt(url);
          stats.fetched += 1;
          stats.bytes += text.length;
          await writeCache(url, text);
          return { text, fromCache: false };
        } catch (err) {
          lastError = err;

          if (err instanceof HttpError && !retryable(err.status)) throw err;

          // 源站明确表示「扛不住」时，除了本次退避，还让后续所有请求一起等
          if (err instanceof HttpError && (err.status === 503 || err.status === 429)) {
            noteCooldown(Math.max(5_000, Math.min(60_000, 5_000 * (attemptNo + 1))));
            log(`${'源站返回 ' + err.status + '，全局冷却'}（后续请求一起退避以免继续加压）`);
          } else if (err?.name === 'AbortError' || /超时/.test(String(err?.message))) {
            noteCooldown(2_000);
          }
        }
      }

      stats.failed += 1;
      throw lastError instanceof Error ? lastError : new Error(`抓取失败: ${url}`);
    });
  }

  return { get, stats, options: { cacheDir, concurrency, delayMs, userAgent, timeoutMs }, cooldown: () => cooldownUntil };
}