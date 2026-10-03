/** 站点 URL 与常量。 */

export const SITE = 'https://www.yjgalgame.com';
export const SITEMAP_URL = `${SITE}/sitemap.xml`;
export const GUIDES_INDEX = `${SITE}/guides`;

/** 游戏页 slug（/gal/<slug>）以及其结构化数据地址。 */
export const pageUrl = (slug) => `${SITE}/gal/${slug}`;
export const payloadUrl = (slug) => `${SITE}/gal/${slug}/_payload.json`;

/**
 * 默认 User-Agent 必须是纯 ASCII（HTTP 头不允许非 Latin-1 字符）。
 * 正式抓取前请用 --user-agent 或环境变量 CRAWLER_UA 换成带联系方式的字符串，
 * 例如：vnlite-walkthrough-crawler/1.0 (+https://github.com/<owner>/<repo>)
 */
export const DEFAULT_UA = 'vnlite-walkthrough-crawler/1.0 (+set-your-repo-url-here)';