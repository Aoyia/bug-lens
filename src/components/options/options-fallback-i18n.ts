import { registerFallbackMessages } from "../../shared/i18n";

export const OPTIONS_FALLBACK_MESSAGES: Record<
  string,
  { zh: string; en: string }
> = {
  autoSaveActive: { zh: "实时保存中", en: "Auto-save active" },
  savedSuccess: { zh: "已自动保存", en: "Auto-saved" },
  settingsTitle: { zh: "全局设置", en: "Settings" },
  searchSettingsPlaceholder: {
    zh: "搜索设置项...",
    en: "Search settings...",
  },
  navWorkflow: { zh: "工作流偏好", en: "Workflow" },
  navAi: { zh: "AI 与导出定制", en: "AI & Export" },
  navRecording: { zh: "默认录制通道", en: "Default Streams" },
  navPrivacy: { zh: "安全与脱敏", en: "Privacy & Security" },
  navStorage: { zh: "存储与配额", en: "Storage & Retention" },
  navShortcuts: { zh: "快捷键指南", en: "Shortcuts" },
  settingLanguage: { zh: "界面语言", en: "Interface Language" },
  settingLanguageDesc: {
    zh: "选择插件界面的展示语言",
    en: "Choose the display language for the extension",
  },
  settingStopAction: { zh: "录制停止后行为", en: "Stop Recording Action" },
  settingStopActionDesc: {
    zh: "点击结束录制后的默认处理流程",
    en: "Default workflow after stopping a recording",
  },
  stopActionPreview: {
    zh: "打开审查预览页",
    en: "Open Preview",
  },
  stopActionSilentExport: {
    zh: "静默导出下载 ZIP（不打开预览）",
    en: "Silent Export ZIP (Skip Preview)",
  },
  settingAutoCopyPrompt: {
    zh: "自动复制 AI Prompt",
    en: "Auto-copy AI Prompt",
  },
  settingAutoCopyPromptDesc: {
    zh: "证据包导出完成后自动将分析提示词写入系统剪贴板",
    en: "Automatically copy AI_PROMPT.md to clipboard on export",
  },
  settingShowGuide: { zh: "显示工作流引导", en: "Show Workflow Guide" },
  settingShowGuideDesc: {
    zh: "是否在面板中展示 3 步工作流认知卡片",
    en: "Display the 3-step workflow guide in the popup panel",
  },
  settingTargetAssistant: {
    zh: "目标 AI 编程助手",
    en: "Target AI Assistant",
  },
  settingTargetAssistantDesc: {
    zh: "为特定 AI 助手优化导出的 AI_PROMPT.md 提示词引导格式",
    en: "Optimize AI_PROMPT.md structure for your preferred AI tool",
  },
  assistantGeneric: { zh: "通用 (Generic)", en: "Generic" },
  assistantCursor: { zh: "Cursor", en: "Cursor" },
  assistantClaudeCode: { zh: "Claude Code", en: "Claude Code" },
  assistantAntigravity: { zh: "Antigravity", en: "Antigravity" },
  settingPromptLanguage: { zh: "Prompt 输出语言", en: "Prompt Language" },
  settingPromptLanguageDesc: {
    zh: "导出的诊断提示词所使用的语言",
    en: "Language used for generated AI diagnosis prompts",
  },
  settingCustomInstructions: {
    zh: "自定义诊断排查指引",
    en: "Custom Diagnostic Instructions",
  },
  settingCustomInstructionsDesc: {
    zh: "追加到 AI_PROMPT.md 中的团队技术栈规范或专属排查指引（最多 4000 字符）",
    en: "Custom directives appended to AI_PROMPT.md (up to 4000 characters)",
  },
  settingPromptTemplate: {
    zh: "剪贴板提示词模板",
    en: "Clipboard Prompt Template",
  },
  settingPromptTemplateDesc: {
    zh: "精简模板仅保留包路径、摘要、Skill 自动安装路由与底线约束；包内 AI_PROMPT.md 始终为完整模板",
    en: "Compact keeps only pack path, summary, Skill auto-install routing and core rules; AI_PROMPT.md in the ZIP always uses the full template",
  },
  promptTemplateStandard: { zh: "标准", en: "Standard" },
  promptTemplateCompact: { zh: "精简（试用）", en: "Compact (Beta)" },
  settingCustomSensitiveKeys: {
    zh: "自定义敏感键名",
    en: "Custom Sensitive Keys",
  },
  settingCustomSensitiveKeysDesc: {
    zh: "额外的敏感 Header 或 JSON 字段名（用英文逗号分隔，如：auth_token, user_pin）",
    en: "Extra header or JSON property names to redact (comma-separated, e.g. auth_token, user_pin)",
  },
  settingExcludeUrls: { zh: "网络抓取排除规则", en: "URL Exclusion Rules" },
  settingExcludeUrlsDesc: {
    zh: "忽略特定内部域名或 URL 的网络请求抓取（每行一个）",
    en: "Ignore network requests matching these domains or patterns (one per line)",
  },
  settingVideoQuality: { zh: "视频录制码率", en: "Video Bitrate" },
  settingVideoQualityDesc: {
    zh: "平衡视频体积与排查清晰度",
    en: "Balance recording video file size and visual clarity",
  },
  qualityBalanced: { zh: "平衡 (2.5 Mbps)", en: "Balanced (2.5 Mbps)" },
  qualityHigh: { zh: "画质优先 (4.0 Mbps)", en: "High Quality (4.0 Mbps)" },
  qualitySmall: { zh: "体积优先 (1.2 Mbps)", en: "Compact (1.2 Mbps)" },
  settingRetention: { zh: "历史会话保留期限", en: "Session Retention Period" },
  settingRetentionDesc: {
    zh: "超过保留期限的历史录制将在扩展启动时自动清理",
    en: "Expired sessions will be cleaned up on extension startup",
  },
  retentionDays7: { zh: "7 天", en: "7 Days" },
  retentionDays14: { zh: "14 天（默认）", en: "14 Days (Default)" },
  retentionDays30: { zh: "30 天", en: "30 Days" },
  retentionDays90: { zh: "90 天", en: "90 Days" },
  settingMaxSessionBytes: {
    zh: "单会话存储上限",
    en: "Max Session Budget",
  },
  settingMaxSessionBytesDesc: {
    zh: "单次录制的最大存储预算",
    en: "Maximum storage budget allocated for a single recording",
  },
  clearAllData: { zh: "清空所有历史数据", en: "Clear All Historical Data" },
  clearAllDataDesc: {
    zh: "彻底清理本地 IndexedDB 中存储的所有历史录制与现场截图（不可恢复）",
    en: "Purge all historical recordings and screenshots in local IndexedDB (irreversible)",
  },
  clearAllDataSuccess: {
    zh: "本地历史数据已清空",
    en: "Historical data cleared successfully",
  },
  shortcutStartRecording: {
    zh: "开始/停止录制",
    en: "Start/Stop Recording",
  },
  shortcutTakeScreenshot: {
    zh: "截屏标记现场",
    en: "Capture Screenshot Scene",
  },
  shortcutOpenPopup: { zh: "唤起插件面板", en: "Open Extension Popup" },
  openChromeShortcuts: {
    zh: "前往 Chrome 快捷键设置",
    en: "Open Chrome Shortcuts Settings",
  },
  saveSettings: { zh: "保存设置", en: "Save Settings" },
  resetDefaults: { zh: "恢复默认值", en: "Reset to Defaults" },
};

registerFallbackMessages(OPTIONS_FALLBACK_MESSAGES);
