/**
 * Nuxt / devalue 扁平 payload 解码器。
 *
 * 源站每个游戏页面都能取到结构化数据：
 *   https://www.yjgalgame.com/gal/<slug>/_payload.json
 *
 * 它是 devalue「扁平数组」格式：数组第 i 项是第 i 个「槽位」，
 * 对象/数组里存放的整数都是对槽位的引用（第 0 项为根值）。
 * 特殊值编码：
 *   -1 undefined  -2 空洞  -3 NaN  -4 +Infinity  -5 -Infinity  -6 -0
 *   ["Date","2026-07-13T05:39:51.160Z"]、["Set",...]、["Map",...]、
 *   ["RegExp",src,flags]、["BigInt","..."]、["Object",...] 等以字符串开头的数组
 *   Nuxt 响应式包装：["ShallowReactive",ref] / ["ShallowRef",ref] / ["Ref",ref] / ["Reactive",ref]
 */

export const UNDEFINED = -1;
export const HOLE = -2;
export const NAN = -3;
export const POSITIVE_INFINITY = -4;
export const NEGATIVE_INFINITY = -5;
export const NEGATIVE_ZERO = -6;

/** 已知的字符串标签 -> 处理方式。 */
const WRAPPER_TAGS = new Set([
  'ShallowReactive',
  'ShallowRef',
  'Reactive',
  'Ref',
  'EmptyRef',
  'Raw',
  'ShallowRaw',
]);

/**
 * @param {unknown} payload `JSON.parse` 后的扁平数组
 * @returns {{root: unknown, unknownTags: Set<string>, refCount: number}}
 */
export function unflatten(payload) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('payload 不是非空数组，无法解码');
  }

  const slots = payload;
  const cache = new Array(slots.length);
  const done = new Array(slots.length).fill(false);
  const visiting = new Set();
  const unknownTags = new Set();
  let refCount = 0;

  const special = (index) => {
    switch (index) {
      case UNDEFINED:
      case HOLE:
        return undefined;
      case NAN:
        return NaN;
      case POSITIVE_INFINITY:
        return Infinity;
      case NEGATIVE_INFINITY:
        return -Infinity;
      case NEGATIVE_ZERO:
        return -0;
      default:
        throw new Error(`未知特殊值 ${index}`);
    }
  };

  function decode(index) {
    if (typeof index === 'number') {
      if (index < 0) return special(index);
      if (!Number.isInteger(index) || index >= slots.length) {
        throw new Error(`引用越界: ${index}（共 ${slots.length} 个槽位）`);
      }
      refCount += 1;
      if (done[index]) return cache[index];
      if (visiting.has(index)) throw new Error(`检测到循环引用（槽位 ${index}）`);
      visiting.add(index);
      const out = materialize(slots[index]);
      visiting.delete(index);
      done[index] = true;
      cache[index] = out;
      return out;
    }
    // 非数字引用：字面量直接返回
    return index;
  }

  function materialize(value) {
    if (value === null || typeof value !== 'object') return value;

    if (Array.isArray(value)) {
      const tag = value[0];
      if (typeof tag === 'string') {
        switch (tag) {
          case 'Date':
            return new Date(value[1]);
          case 'Set':
            return new Set(value.slice(1).map(decode));
          case 'Map':
            return new Map(value.slice(1).map(decode));
          case 'RegExp':
            return new RegExp(value[1], value[2] ?? '');
          case 'BigInt':
            return BigInt(value[1]);
          case 'Object': {
            const obj = Object.create(null);
            for (let i = 1; i < value.length; i += 2) obj[value[i]] = decode(value[i + 1]);
            return obj;
          }
          case 'null': {
            const obj = Object.create(null);
            for (let i = 1; i < value.length; i += 2) obj[value[i]] = decode(value[i + 1]);
            return obj;
          }
          default:
            if (WRAPPER_TAGS.has(tag)) return decode(value[1]);
            unknownTags.add(tag);
            return decode(value[1]);
        }
      }
      return value.map((ref) => decode(ref));
    }

    const obj = {};
    for (const [key, ref] of Object.entries(value)) {
      const decoded = decode(ref);
      if (decoded !== undefined) obj[key] = decoded; // 丢弃 undefined 字段，保持数据干净
    }
    return obj;
  }

  const root = decode(0);
  return { root, unknownTags, refCount };
}

/**
 * 从页面 payload 中取出游戏对象。
 * 结构：root.data["gal-<slug>"] ，兼容 root.data 直接就是对象的写法。
 */
export function extractGame(root, slug) {
  const data = root?.data ?? root;
  if (data === null || typeof data !== 'object') {
    throw new Error('payload 中找不到 data 节点');
  }

  if (slug && data[`gal-${slug}`]) return data[`gal-${slug}`];

  const galKey = Object.keys(data).find((k) => k.startsWith('gal-'));
  if (galKey) return data[galKey];

  const first = Object.values(data).find((v) => v !== null && typeof v === 'object' && !Array.isArray(v));
  if (first) return first;

  throw new Error(`payload 中找不到 slug "${slug}" 对应的数据`);
}