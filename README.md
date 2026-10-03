# 视觉小说攻略静态数据库

纯静态的视觉小说（GalGame）攻略数据库：**所有数据都是仓库里的 JSON 文件**，根目录的 `index.json` 作为统一索引，外部无需后端、无需构建服务，直接用 `raw.githubusercontent.com` 拉取即可。

- 数据即文件：每个游戏一个 `walkthroughs/<分区>/<vid>.json`
- 统一出口：`index.json` 列出全部攻略的 `vid`、路径与元数据
- 三级分区目录：按 VNDB 编号分段存放，避免单目录堆积上万文件
- 零依赖工具链：只用 Node 内置模块，校验与索引生成均可离线运行
- 可选爬虫：可从 `https://www.yjgalgame.com` 抓取攻略并转换成本库格式（见 [抓取攻略](#抓取攻略)）

## 目录结构

```
.
├── index.json                     # 索引（由 npm run build 生成，勿手改）
├── walkthroughs/                  # 攻略数据，按 VNDB 编号三级分区
│   ├── 1-10000/
│   │   ├── 1-1000/
│   │   │   ├── 1-100/
│   │   │   │   ├── v11.json
│   │   │   │   └── v100.json
│   │   │   └── 101-200/
│   │   │       └── v184.json
│   │   └── 1001-2000/
│   │       └── 1201-1300/
│   │           └── v1234.json
│   └── 10001-20000/
│       ├── 10001-11000/
│       │   └── 10001-10100/
│       │       └── v10001.json
│       └── 18001-19000/
│           └── 18401-18500/
│               └── v18437.json
├── schema/
│   ├── walkthrough.schema.json    # 攻略文件 JSON Schema（编辑器实时校验）
│   └── index.schema.json          # 索引 JSON Schema
├── scripts/
│   ├── validate.mjs               # 校验全部攻略
│   ├── build-index.mjs            # 生成 / 比对 index.json
│   ├── scaffold.mjs               # 可选：批量补建空的分区目录
│   ├── lib/                       # 公共模块（路径规则、字段规则、终端输出）
│   └── crawl/                     # 可选：抓取 yjgalgame 攻略
├── data/
│   ├── sources/yjgalgame.json     # 抓取溯源清单：vid -> 源页面
│   └── yjgalgame-vid-map.json     # 手动指定 slug -> vid 的补丁
├── .github/workflows/validate.yml # CI：校验数据 + 索引一致性
└── .githooks/pre-commit           # 本地提交前校验（npm run hooks:install）
```

## 存储路径规则

分区按编号区间**逐级对齐**，所以「上级目录一定包含下级目录」自动成立：

| 层级 | 区间宽度 | 规则 |
| --- | --- | --- |
| 一级 | 10000 | `1-10000`、`10001-20000`、`20001-30000` …（按需扩展） |
| 二级 | 1000 | `1-1000`、`1001-2000` … |
| 三级 | 100 | `1-100`、`101-200` … |

文件路径由 vid 直接推导（`scripts/lib/paths.mjs`）：

```
v11    -> walkthroughs/1-10000/1-1000/1-100/v11.json
v184   -> walkthroughs/1-10000/1-1000/101-200/v184.json
v1234  -> walkthroughs/1-10000/1001-2000/1201-1300/v1234.json
v18437 -> walkthroughs/10001-20000/18001-19000/18401-18500/v18437.json
```

规则：`n` 在宽度 `w` 的层级上落在 `floor((n-1)/w)*w+1 ~ +w-1`。

目录**按需创建**：只有真正存在攻略的分区才会出现在仓库里（git 不跟踪空目录）。想本地补齐整棵目录树可用 `npm run scaffold`（空目录不入 git，不影响 raw 访问）。

## 数据格式

### 顶层字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `vid` | ✅ | VNDB 编号，如 `"v184"`；必须与文件名、所在分区一致 |
| `name` | | 标题多语言映射，如 `{ "zh-cn": "美好的每一天～不连续存在～" }`，键用 BCP 47 语言代码 |
| `level` | | 分级/难度等数值标识（沿用数据源原值），非负整数 |
| `author` | | 攻略作者 |
| `contact` | | 作者联系方式：邮箱、社交账号或主页 |
| `updatedAt` | ✅ | 最后更新日期，`YYYY-MM-DD` |
| `tips` | | 全局提示，字符串数组 |
| `routes` | ✅ | 路线数组，不能为空 |

### `routes[]`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | | 路线唯一标识 |
| `name` | ✅ | 路线名称，通常是角色名或章节名 |
| `endings` | ✅ | 结局数组，不能为空 |

### `endings[]`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | | 结局唯一标识 |
| `name` | ✅ | 结局名称 |
| `type` | | `normal`（默认）/ `bad` / `good` / `true` |
| `requirements` | | 开启条件说明 |
| `steps` | ✅ | 步骤数组，不能为空 |

### `steps[]`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | | 步骤唯一标识 |
| `type` | | `choice`（默认，选项）/ `save` / `load` / `note` |
| `content` | ✅ | 步骤内容 |
| `prefix` | | 前缀标记，如 `"※"`、`"★"`、`"◆"` |
| `subfix` | | 后缀说明，如 `"CG回收"` |
| `group` | | 日期或章节分组，如 `"7月25日"` |

`id` 建议写成 `<kind>_<timestamp>`（如 `step_1755094701246`），并要求**同一文件内同级 id 唯一**（route / ending / step 三个命名空间各自唯一）。

示例（`walkthroughs/1-10000/1-1000/1-100/v11.json`）：

```json
{
  "vid": "v11",
  "name": {
    "zh-cn": "美好的每一天～不连续存在～"
  },
  "level": 0,
  "updatedAt": "2026-10-03",
  "tips": ["★为二周目会出现的选项"],
  "routes": [
    {
      "name": "由岐视点",
      "endings": [
        {
          "name": "由岐视点 END2",
          "type": "normal",
          "steps": [
            { "type": "choice", "content": "去散步好了/海事快去做自己该做的事情吧……", "prefix": "★", "group": "7月2日" },
            { "type": "save", "content": "SAVE 2", "group": "7月2日" },
            { "type": "load", "content": "LOAD 2" },
            { "id": "step_1755094701246", "type": "note", "content": "END2后 选择 It's my own Invention 开始" }
          ]
        }
      ]
    }
  ]
}
```

## index.json 与外部访问

`index.json` **只做索引**：不放攻略正文，客户端按 `path` 再去拉原始文件。

```json
{
  "schemaVersion": 1,
  "count": 2,
  "latestUpdatedAt": "2026-10-03",
  "walkthroughs": [
    {
      "vid": "v11",
      "path": "walkthroughs/1-10000/1-1000/1-100/v11.json",
      "updatedAt": "2026-10-03",
      "routesCount": 1,
      "endingsCount": 1,
      "stepsCount": 4,
      "name": { "zh-cn": "美好的每一天～不连续存在～" },
      "level": 0
    }
  ]
}
```

- `count`：攻略总数
- `latestUpdatedAt`：所有攻略中最新的 `updatedAt`（由数据推导，不含构建时间 → 同样的数据必然生成同样的 `index.json`）
- 条目按 vid 数值升序，方便二分查找 / 分页
- 条目里的 `author`、`contact`、`level`、`name` 仅在攻略文件里存在时出现；`tips`、步骤正文等请按 `path` 拉取

索引内容完全由 `walkthroughs/` 推导，**由脚本生成，请勿手工编辑**。

### 客户端用法

```js
const RAW = 'https://raw.githubusercontent.com/<owner>/<repo>/main';

// 1. 先取索引
const index = await fetch(`${RAW}/index.json`).then((r) => r.json());

// 2. 按 vid 找到条目，拼 raw 地址拉攻略
const entry = index.walkthroughs.find((w) => w.vid === 'v11');
const guide = await fetch(`${RAW}/${entry.path}`).then((r) => r.json());

// 3. 也可以直接按规则算路径，不需要索引
const rawOf = (vid) => {
  const n = Number(vid.slice(1));
  const dir = (w) => `${Math.floor((n - 1) / w) * w + 1}-${Math.floor((n - 1) / w) * w + w}`;
  return `${RAW}/walkthroughs/${dir(10000)}/${dir(1000)}/${dir(100)}/${vid}.json`;
};
```

命令行：

```bash
curl https://raw.githubusercontent.com/<owner>/<repo>/main/index.json
curl https://raw.githubusercontent.com/<owner>/<repo>/main/walkthroughs/1-10000/1-1000/1-100/v11.json
```

如果想要 CDN 缓存与国内可访问性，jsDelivr 同样可用（把 `<owner>/<repo>` 换成实际仓库）：

```
https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/index.json
```

## 本地脚本

```bash
npm run validate    # 校验所有攻略文件（必填字段、枚举、id 唯一性、日期、vid 与路径一致性）
npm run build       # 扫描 walkthroughs/ 重新生成 index.json
npm run check       # validate + build-index --check（CI / 提交前用）
npm run scaffold    # 可选：按最大 vid 补建空的分区目录
npm run hooks:install   # 安装 git pre-commit 钩子
npm run crawl      # 抓取 yjgalgame 攻略（见下）
```

仓库无第三方依赖，克隆后直接 `node scripts/validate.mjs` 即可（Node ≥ 18）。

校验分级：

- **错误**（退出码非 0，CI 失败）：缺必填字段、`type` 非法、`updatedAt` 不是真实日期、id 重复、`vid` 与文件名/分区目录不一致、两个文件用了同一个 vid 等。
- **警告**（不阻断）：未知字段、id 命名不规范、真结局未写 `requirements`、语言代码不规范等。用 `--strict` 可让警告也失败。

编辑器已内置 schema（`.vscode/settings.json`），保存 `walkthroughs/**/*.json` 时会实时提示字段错误。

### 新增一份攻略

```bash
# 1. 按 vid 算出目标路径并创建目录
node -e "import('./scripts/lib/paths.mjs').then(m=>{const p=m.walkthroughPath(184);console.log(p);})"
mkdir -p walkthroughs/1-10000/1-1000/101-200

# 2. 写入 walkthroughs/1-10000/1-1000/101-200/v184.json（可参考 schema/walkthrough.schema.json）

# 3. 校验 + 刷新索引，然后一起提交
npm run check && git add walkthroughs index.json
```

## 抓取攻略

`scripts/crawl/crawl.mjs` 会从 [yjgalgame](https://www.yjgalgame.com) 抓取攻略，转换成本库格式后写入 `walkthroughs/`，并自动刷新 `index.json`。

### 工作方式

1. 读 `https://www.yjgalgame.com/sitemap.xml`，取出全部 `/gal/<slug>` 页面（约 500 个）。
2. 逐页请求 `https://www.yjgalgame.com/gal/<slug>/_payload.json`。这是站点为 Nuxt 生成的**结构化数据**，因此**不做 HTML 解析**，而是解码 devalue 扁平 payload（`scripts/crawl/lib/payload.mjs`），字段稳定、不受页面样式影响。
3. 按字段映射表转换成本库 schema，转换结果立即过一遍本地校验，不通过就记为失败而不落盘。
4. 写入 `walkthroughs/<分区>/<vid>.json`（默认不覆盖已有文件），更新溯源清单 `data/sources/yjgalgame.json`，最后执行 `validate` + `build`。

### 字段映射（只取本库需要的字段）

| 源站字段 | 本库字段 | 处理 |
| --- | --- | --- |
| `vndb_id` | `vid` | 支持 `v9125` / `9125` / 多值（取第一个，其余记入溯源清单）；缺失则跳过该页 |
| `name` | `name` | 按小写语言代码保留非空项 |
| `romaji` | `name["ja-Latn"]` | 仅当标题里没有日文标题且与已有标题不重复时补入（`--no-romaji` 关闭） |
| `level` | `level` | 保留原值 |
| `tips` | `tips` | 逐行清理空行，全空则省略 |
| `routes[].id/name` | `routes[].id/name` | 原样保留；缺名时用「未命名路线 N」占位并记警告 |
| `routes[].endings[]` | `routes[].endings[]` | `id`/`name`/`type`/`requirements` 原样保留；非法 `type` 回落 `normal` |
| `endings[].steps[]` | `endings[].steps[]` | `id`/`type`/`content`/`prefix`/`subfix`/`group` 原样保留；空内容步骤丢弃；非法 `type` 回落 `choice` |
| `updated_at` | `updatedAt` | 取日期部分；缺失时依次回退 `updatedAt` → `created_at` → sitemap `lastmod` |
| `uid` `cover` `developer` `releaseDate` `tags` `show` `nsfw_content` `views` `seoName` `created_at` … | — | 全部丢弃（`show=false` 的页面直接跳过） |

### 常用命令

```bash
# 试跑单个页面，不写任何文件
npm run crawl -- --slug kamipani --dry-run

# 抓取前 20 个页面
npm run crawl -- --limit 20

# 抓某个页面并覆盖已有文件
npm run crawl -- --slug clover-days --force

# 慢速长跑：并发 1、间隔 2s（对源站更友好）
npm run crawl -- --concurrency 1 --delay 2000
```

`node scripts/crawl/crawl.mjs --help` 可查看全部选项，常用项：

| 选项 | 说明 |
| --- | --- |
| `--slug <slug>` | 只处理指定页面，可重复 |
| `--limit <n>` | 本次最多处理多少页 |
| `--concurrency <n>` / `--delay <ms>` | 并发数（默认 2）与请求最小间隔（默认 400ms） |
| `--max-age <hours>` / `--no-cache` | 原始 payload 缓存有效期（默认 24h）/ 强制重新抓 |
| `--retries <n>` / `--timeout <ms>` | 重试次数与单请求超时 |
| `--user-agent <ua>` / `CRAWLER_UA` | 自定义 UA（**必须是纯 ASCII**，建议带联系方式） |
| `--vid <vN>` / `--vid-map <file>` | 手动指定编号 / 批量补丁（`data/yjgalgame-vid-map.json`，形如 `{ "slug": "v123" }`） |
| `--author <name>` / `--contact <text>` | 为导入的数据统一补作者与联系方式 |
| `--no-romaji` / `--keep-duplicate-steps` | 关闭 romaji 补入 / 保留连续重复步骤 |
| `--force` / `--dry-run` / `--no-index` / `--no-sources` | 覆盖已有文件 / 只解析不落盘 / 不刷新索引 / 不更新溯源清单 |

### 抓取礼仪与缓存

- 遵守 `robots.txt`：该站 `Allow: /`，仅 `/search` 禁止抓取。
- 默认并发 2、请求间隔 400ms，失败指数退避，`429/503` 遵循 `Retry-After`；长跑建议 `--concurrency 1 --delay 2000`。
- 原始响应缓存在 `.cache/yjgalgame/`（不入库），默认 24h 内不重复请求源站；调参、试跑优先用缓存，加 `--no-cache` 才强制刷新。
- 每次运行的完整报告写在 `.cache/yjgalgame/last-run.json`（含每个页面的状态、失败原因与字段警告）。

### 溯源与合规

- `data/sources/yjgalgame.json` 记录 `vid → 源页面 URL / slug / 源站更新时间`，用于署名与核对；攻略正文仍以 `walkthroughs/` 内的文件为准。
- 抓取内容版权归原作者与源站所有。公开发布前请自行确认源站条款与授权范围，仓库根目录也建议补上 `LICENSE` 与数据来源声明。
- 若源站改版（payload 结构变化），解码器需要同步调整：`scripts/crawl/lib/payload.mjs`。解析失败会被记为失败并打印原因，不会写入半成品文件。

## 常见问题

**raw 打开某个路径 404？** 先确认 vid 与分区规则匹配（`node -e "import('./scripts/lib/paths.mjs').then(m=>console.log(m.walkthroughPath(184)))"`），再确认 `index.json` 已包含该条（漏生成索引是常见原因，跑一次 `npm run build`）。

**JSON 字段写错了会被拦下吗？** 会。`npm run validate`、pre-commit 钩子与 GitHub Actions 三处都会检查字段规范；编辑器保存时也会即时提示。

**可以只索引不改正文吗？** 可以，`index.json` 只存元数据与路径，正文按需拉取；`--no-index` 可让爬虫不自动刷新索引。