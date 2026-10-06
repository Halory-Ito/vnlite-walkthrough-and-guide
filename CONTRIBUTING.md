# 贡献指南（CONTRIBUTING）

感谢你愿意参与！本仓库是一个**由社区共同维护**的静态视觉小说攻略数据库：每个游戏一个 JSON 文件，根目录 `index.json` 作为统一索引，纯静态、无后端。

攻略数量很大，靠少数人整理不完，所以**任何形式的贡献都欢迎**，哪怕只是修一个错别字。

---

## 一、你可以贡献什么

- **新增游戏攻略**：为某个 `vid` 补充攻略。
- **修正 / 补全**：改错别字、补漏掉的选项、补全结局或通关条件。
- **完善元数据**：补 `name`（多语言标题）、`tips`、`routes[].description`、`endings[].requirements` 等。
- **改进工具与文档**：`scripts/`、`schema/`、README、CI 等。

## 二、基本原则

1. **一个游戏一个文件**，文件名与 `vid` 一致。
2. **忠实原文**：按原文顺序整理，不臆造原文没有的选项 / 存档点 / 条件；不要顺手翻译（除非原文本身包含多语言标题）。
3. **`index.json` 是派生文件**，由脚本生成，**不要手工编辑**（自动同步的提交也不要手动改）。
4. **尊重版权**：只提交你有权转载的内容，注明来源（见「数据来源与授权」）。

## 三、环境准备

- **Node.js ≥ 18**（只在本地生成索引 / 校验时需要；如果交给 CI 自动补索引，可以完全不装）。
- 仓库**零第三方依赖**，克隆后直接 `node scripts/validate.mjs` 即可。
- 可选：安装提交前钩子，防止把不同步的索引提交上去：
  ```bash
  npm run hooks:install
  ```
- 用 VS Code 打开仓库即可获得 JSON Schema 实时校验（`.vscode/settings.json` 已配置）。

## 四、贡献流程（新增攻略）

### 第 1 步：确定 `vid`

`vid` 是 VNDB 编号。去 [vndb.org](https://vndb.org) 搜索游戏，页面地址形如 `https://vndb.org/v184`，其中的 `v184` 就是 `vid`。

### 第 2 步：准备攻略 JSON

不想手写、或者整理量很大？把**原始攻略文字**（网页 / 论坛 / 文档里直接复制，不用排版）交给 LLM 自动转换：

- 提示词见 **[docs/walkthrough-generation-prompt.md](docs/walkthrough-generation-prompt.md)**。
- 复制提示词给任意 LLM，再提供两样东西：`vid` + 非格式化攻略正文。
- 输出即为符合本仓库 schema 的 JSON。

也可以手写，参考 `schema/walkthrough.schema.json`、README「数据格式」一节，以及 `walkthroughs/` 下的现成文件。

### 第 3 步：按 `vid` 放到正确路径

路径由 `vid` 推导，三级分区：

```
v11    -> walkthroughs/1-10000/1-1000/1-100/v11.json
v184   -> walkthroughs/1-10000/1-1000/101-200/v184.json
v18437 -> walkthroughs/10001-20000/18001-19000/18401-18500/v18437.json
```

不确定就运行：

```bash
node -e "import('./scripts/lib/paths.mjs').then(m=>console.log(m.walkthroughPath(184)))"
```

### 第 4 步：更新索引并校验

**方式 A（推荐给会装 Node 的贡献者）**：本地生成索引再提交。

```bash
npm run build       # 扫描 walkthroughs/ 重新生成 index.json
npm run check       # 校验数据 + 确认索引已同步
git add walkthroughs index.json
```

> ⚠️ 注意：`npm run check` 里的 `build-index` 是 `--check`（只比对、不刷新）。一定要先 `npm run build`。

**方式 B（最省事）**：仓库的 GitHub Actions 会在**推送到 `main`** 时**自动生成并回提交 `index.json`**（使用内置 `GITHUB_TOKEN`，无需手动配置密钥）。你只需提交 `walkthroughs/` 下的攻略文件即可：

```bash
git add walkthroughs
```

注意：**PR 只会严格校验、不会回提交**，所以通过 PR 贡献时仍需用方式 A 在本地生成 `index.json`。如果 CI 因为「索引不同步」失败，也是这个原因。

## 五、JSON 格式要求（必看）

完整字段说明见 README「数据格式」，Schema 见 `schema/walkthrough.schema.json`。要点：

| 层级 | 必填 | 说明 |
| --- | --- | --- |
| 顶层 | `vid`、`updatedAt`、`routes` | `updatedAt` 为 `YYYY-MM-DD` 真实日期 |
| `name` | | 语言代码到标题的映射，键用 BCP 47（`zh-cn`、`ja-jp`、`ja-Latn`、`en-us`…） |
| `routes[]` | `name`、`endings` | `endings` 至少 1 个 |
| `endings[]` | `name`、`steps` | `type` ∈ `normal` / `bad` / `good` / `true`；`true` 必须写 `requirements` |
| `steps[]` | `content` | `type` ∈ `choice` / `save` / `load` / `note` |

约束：

- `routes`、`endings`、`steps` **都不能是空数组**。
- 每个 step 的 `content` **非空**。
- **不得出现 schema 之外的字段**（多写会导致校验失败）。
- `id` 可省略；若填写，则同一文件内 **route / ending / step 三个命名空间各自全局唯一**，且只含字母数字与 `. _ : -`。
- `save` / `load` 步骤通常不需要 `prefix`。
- 同一处多个候选选项用 `/` 连接，例如 `"去散步好了/回家"`。

## 六、校验

```bash
npm run validate                      # 全部文件
node scripts/validate.mjs v184        # 只校验指定 vid
node scripts/validate.mjs --strict    # 警告也视为失败
```

- **错误**（会让 CI 失败）：缺必填字段、`type` 非法、`updatedAt` 不是真实日期、id 重复、`vid` 与文件名 / 分区目录不一致、两个文件用了同一个 `vid` 等。
- **警告**（不阻断）：未知字段、id 命名不规范、真结局未写 `requirements`、语言代码不规范等。

### 常见错误排查

| 现象 | 原因 / 解决 |
| --- | --- |
| `vid 应存放于 walkthroughs/...` | 文件放错分区目录，按路径规则移动 |
| `id "..." 重复` | 同一文件内 id 必须全文唯一，换一个 id |
| `未知字段 "xxx"` | 写了 schema 之外的字段，删掉 |
| `steps 不能为空数组` | 补齐步骤，或确认该结局确实存在 |
| `updatedAt 必须是真实存在的 YYYY-MM-DD` | 检查月份 / 天数，别写未来日期 |
| CI 提示索引不同步 | 本地 `npm run build` 后提交 `index.json`，或开启 CI 自动同步 |

## 七、批量抓取（可选）

`scripts/crawl/` 能从 [yjgalgame](https://www.yjgalgame.com) 抓取攻略并转换成本库格式（详见 README「抓取攻略」）。运行抓取前请先阅读 README 里的「抓取礼仪与缓存」，注意对源站的请求频率。

## 八、提交与 Pull Request 规范

- 一个 PR 尽量聚焦：建议一次处理一个游戏，或一小组相关修改。
- **不要手工修改 `index.json`**；它由脚本 / CI 生成。若 CI 自动回提交了 `index.json`，属正常现象，不要再去「纠正」它。
- 提交信息建议使用如下前缀（不强制）：
  - `feat(walkthroughs): 新增 v184 <游戏名> 攻略`
  - `fix(walkthroughs): 修正 v184 <结局名> 的选项`
  - `docs: 更新贡献指南`
  - `chore: 更新 CI`
- 在 PR 描述里说明：`vid`、数据来源链接、以及是否已确认过转载授权。

## 九、数据来源与授权（重要）

- 攻略内容版权归**原作者与源站**所有；本仓库只是整理与索引。
- 提交时请尽量在 `routes[].description` 或 PR 里**注明来源**（原帖 / 站点链接、作者）。
- **不确定是否允许转载时，先开 Issue 询问**，不要直接提交。
- 不要提交付费内容、明确禁止转载的内容，或涉及隐私的内容。
- 完整授权范围：代码见 [LICENSE](LICENSE)（MIT），数据与文档见 [DATA-LICENSE.md](DATA-LICENSE.md)。

## 十、报告问题

- **数据有误**：提 Issue，附上 `vid`、具体位置（route / ending / step）与正确内容。
- **脚本或 CI 异常**：附上命令、报错输出、系统与 Node 版本。
- **版权或安全问题**：请通过 Issue 说明，我们会尽快处理。

## 十一、行为准则

请保持友善、尊重与就事论事。我们欢迎新手提问，也欢迎指出问题；对内容有分歧时，以「忠于来源、方便玩家」为准绳沟通解决。

再次感谢你的贡献！
