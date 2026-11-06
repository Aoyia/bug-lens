---
name: bug-lens-release
description: >-
  Release Bug Lens extension to GitHub Releases, GitHub Pages, and Chrome Web Store.
  Use when the user asks to release a new version, bump version numbers, publish an
  update, or submit Bug Lens to the Chrome Developer Dashboard.
metadata:
  internal: true
---

# Bug Lens Release SOP

按顺序执行以下 5 个阶段。每个阶段必须满足其 **Completion Criterion** 后再进入下一阶段。

## Step 1: 同步 6 处版本元数据

运行版本同步脚本（先 `--dry-run` 预览，确认无误后正式写入）：

```bash
node scripts/release-bump.mjs <version> --dry-run
node scripts/release-bump.mjs <version>
```

同步范围：

- `package.json` (`version`)
- `src/manifest.json` (`version`)
- `src/components/options/OptionsApp.tsx` (`.sidebar-footer` 兜底版本号)
- `CHROMEWEBSTORE.md` (`Version Alignment` 与 `dist-zip/bug-lens-v<version>.zip`)
- `README.md` (`bug-lens-v<version>.zip` 下载链接)
- `README_zh.md` (`bug-lens-v<version>.zip` 下载链接)

**Completion Criterion**: `node scripts/release-bump.mjs <version>` 退出码为 `0`，且 `git grep` 校验 6 个文件中除 `CHROMEWEBSTORE.md` 历史版本表外无旧版本号残留。

## Step 2: 更新官网与商店 Changelog

1. **`CHROMEWEBSTORE.md` 第 6 节 (`## 6. 版本变更记录`)**：
   - 将上一版本行的状态由 `Ready for Submission` 改为 `Submitted`。
   - 在表头下方第一行插入新版本记录：
     `| \`v<version>\` | <YYYY-MM-DD> | <英文特性摘要> | Ready for Submission |`
2. **`site/index.html` 三处联动更新**（设 `<NN>` 为补丁号，如 `0.7.38` 对应 `v38`）：
   - **Hero 呼吸灯徽标**：將 `[data-l10n="heroVersionBadge"]` 文本更新为 `v<version> 现已上线 · 查看更新日志`。
   - **时间轴 (`div.changelog-timeline`)**：
     - 移除原首项 `<div class="changelog-item latest">` 上的 `latest` 类名及其内部的 `<span class="changelog-tag" data-l10n="tagLatest">Latest</span>`。
     - 在时间轴最上方插入新版本节点 `<div class="changelog-item latest">`，绑定 `data-l10n="v<NN>_f1_t"`、`data-l10n="v<NN>_f1_d"`、`data-l10n="v<NN>_f2_t"`、`data-l10n="v<NN>_f2_d"`。
   - **双语字典 (`dict.zh` 与 `dict.en`)**：
     - 更新 `dict.zh.heroVersionBadge` 为 `"v<version> 现已上线 · 查看更新日志"`。
     - 更新 `dict.en.heroVersionBadge` 为 `"v<version> is Live · See What's New"`。
     - 在 `dict.zh` 与 `dict.en` 中同步新增 `v<NN>_f1_t`、`v<NN>_f1_d`、`v<NN>_f2_t`、`v<NN>_f2_d` 词条。

**Completion Criterion**: `git grep -n "<oldVersion>" site/index.html` 仅命中历史时间轴节点（`<!-- v<oldVersion> -->` 与 `<span class="changelog-ver">v<oldVersion></span>`），`heroVersionBadge` 与新 `v<NN>_*` 词条在 `dict.zh` 和 `dict.en` 中成对存在。

## Step 3: 类型检查、单测与构建 Release 包

按顺序执行：

```bash
pnpm typecheck
pnpm test
pnpm package
```

**Completion Criterion**: 全部命令退出码为 `0`，且 `dist-zip/bug-lens-v<version>.zip` 已生成并包含最新 `dist/manifest.json`（`version` 为 `<version>`）。

## Step 4: Git Tag、GitHub Release 与 Pages 部署

仅在用户明确指令发布/推送时执行（遵循 Conventional Commits 英文规范）：

```bash
git add -A
git commit -m "chore(release): v<version>"
git tag v<version>
git push origin main --tags
gh release create v<version> "dist-zip/bug-lens-v<version>.zip" \
  --title "Bug Lens v<version>" \
  --notes "<Release Notes>"
```

验证 GitHub Pages 工作流状态并同步 Skill 镜像：

```bash
gh run list --limit 3
node scripts/publish-skill.mjs
```

**Completion Criterion**: `v<version>` Tag 与 GitHub Release（含 `bug-lens-v<version>.zip` 资产）已创建，GitHub Pages 部署工作流触发成功，且 `Aoyia/bug-lens-skill` 镜像仓库已同步更新。

## Step 5: Chrome Web Store 自动化提审 (`chrome-devtools` MCP)

严禁要求用户手动点击或拖拽上传，全程通过 `chrome-devtools` MCP 操作已打开的 Chrome Developer Dashboard：

1. **拷贝 ZIP 至系统 `os.tmpdir()`**（绕过 `chrome-devtools-mcp` 的 `roots()` 路径沙箱校验；工作区目录与 `/tmp` 软链会被拒绝，必须使用 Node `os.tmpdir()` 真实路径）：
   ```bash
   node -e '
     const fs = require("fs"), os = require("os"), path = require("path");
     const ver = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
     const dst = path.join(fs.realpathSync(os.tmpdir()), `bug-lens-v${ver}.zip`);
     fs.copyFileSync(`dist-zip/bug-lens-v${ver}.zip`, dst);
     console.log(dst);
   '
   ```
2. **定位开发者后台页面**：
   - 调用 `list_pages` 查找 URL 含 `chrome.google.com/webstore/devconsole` 的标签页 `pageId`。
   - 若停留在列表页，点击 `Bug Lens` 进入详情页，再点击左侧导航 `link "文件包"`（URL 结尾 `/mjfoododejekngekcmidcfagmmgabmjc/edit/package`）。
3. **打开上传弹窗并上传 ZIP**：
   - 先对 `button "上传新的软件包"` 调用 `click` 打开模态框 `dialog "上传新的软件包"`（直接对 `"上传新的软件包"` 按钮调用 `upload_file` 会报错 `The element could not accept the file directly`）。
   - 调用 `take_snapshot` 获取弹窗内 `button "选择文件"` 的 `uid`。
   - 对 `button "选择文件"` 的 `uid` 调用 `upload_file`，`filePaths` 传入第 1 步输出的 `/private/var/folders/.../T/bug-lens-v<version>.zip` 路径。
4. **确认草稿版本并提交审核**：
   - 上传完成后等待页面自动跳转或刷新，调用 `take_snapshot` 确认 `heading "草稿"` 下方的版本号已变为 `<version>`。
   - 点击左侧导航 `link "商品详情"`（`/edit/listing`），对右上角 `button "提请审核"` 调用 `click`。
   - 在弹出的 `dialog "提交“Bug Lens”以供审核？"` 中，确认 `checkbox "在“Bug Lens”通过审核后自动发布它"` 为 `checked`，然后对 `button "提交审核"` 调用 `click`。

**Completion Criterion**: `take_snapshot` 显示顶部状态变更为 `状态： 待审核`（且 `button "提请审核"` 变为 `disabled`）。
