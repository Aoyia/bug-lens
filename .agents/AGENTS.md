# Project Rules

1. Git commit 信息必须使用英文（遵循 Conventional Commits 规范）。
2. 发布新版本必须全量同步线上资源与自动化提审：
   - **官网更新动态 (site/data/releases.js & site/index.html)**：必须在 `site/data/releases.js` 的 `RELEASES` 数组顶部新增当前版本的双语特性摘要对象（Hero 徽标、主屏摘要卡与抽屉历史将自动渲染），并同步更新 `site/index.html` 中最新版静态兜底版本号；
   - **版本元数据与文档**：同步递增 `package.json`、`src/manifest.json` 与 `src/components/options/OptionsApp.tsx` 侧边栏版本，并更新 `CHROMEWEBSTORE.md`、`README.md`、`README_zh.md` 中的版本号与发布包引用；
   - **线上构建与 Release**：执行 `pnpm package` 生成 release zip，测试通过后推送 Git Tag，创建 GitHub Release 挂载安装包产物，并确保 GitHub Pages 自动部署工作流顺利触发；
   - **应用商店自动化提审**：直接通过 Chrome DevTools 驱动已打开的 Chrome Developer Dashboard 开发者后台，自动完成新版软件包上传并提交审核（勾选通过后自动发布），严禁让用户手动点击或拖拽上传。
