/** 解析 sitemap.xml，取出 /gal/<slug> 页面清单。 */

import { SITEMAP_URL } from './site.mjs';

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const LASTMOD_RE = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i;

/**
 * @param {string} xml sitemap 文本
 * @param {string} base sitemap 地址（用于解析相对 loc）
 * @returns {Array<{url: string, slug: string, lastmod: string|null}>}
 */
export function parseSitemap(xml, base = SITEMAP_URL) {
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/gi) ?? [];
  const items = [];

  for (const block of blocks) {
    LOC_RE.lastIndex = 0;
    LASTMOD_RE.lastIndex = 0;
    const loc = LOC_RE.exec(block)?.[1];
    if (!loc) continue;
    const slug = slugFromUrl(loc, base);
    if (!slug) continue;
    const lastmod = LASTMOD_RE.exec(block)?.[1] ?? null;
    items.push({ url: new URL(loc, base).toString(), slug, lastmod });
  }

  // 有些站点输出不带 <url> 包裹的裸 <loc>，兜底再扫一遍
  if (items.length === 0) {
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const slug = slugFromUrl(m[1], base);
      if (slug) items.push({ url: new URL(m[1], base).toString(), slug, lastmod: null });
    }
  }

  return items.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** 从 /gal/<slug> 形式的 URL 中取出 slug；非游戏页返回 null。 */
export function slugFromUrl(url, base = SITEMAP_URL) {
  let pathname;
  try {
    pathname = new URL(url, base).pathname;
  } catch {
    return null;
  }
  const m = pathname.match(/^\/gal\/([^/]+)\/?$/);
  return m ? m[1] : null;
}