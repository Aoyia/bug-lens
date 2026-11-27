export type CapabilityIcon =
  "timeline" | "code" | "annotate" | "mobile" | "report" | "lock";

export interface CapabilityItem {
  tag: string;
  title: string;
  desc: string;
  icon: CapabilityIcon;
  highlight?: boolean;
}

export interface FileTreeItem {
  name: string;
  desc: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface SiteCopy {
  htmlLang: string;
  ogLocale: string;
  ogLocaleAlt: string;
  pageTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  twitterTitle: string;
  twitterDescription: string;

  navAria: string;
  navWorkflow: string;
  navCapabilities: string;
  navAgentSkill: string;
  navChangelog: string;
  navFaq: string;
  navMenuAria: string;
  langSwitchLabel: string;
  langSwitchAria: string;

  heroVersionBadgePrefix: string;
  heroTitleHtml: string;
  heroTitlePlain: string;
  heroSub: string;
  effOldLabel: string;
  effOldTime: string;
  effOldDesc: string;
  effNewLabel: string;
  effNewTime: string;
  effNewDesc: string;
  ctaStore: string;
  ctaStoreEdge: string;
  ctaSource: string;
  altChromeStore: string;
  altEdgeStore: string;
  altOfflineZip: string;
  demoPlayerTag: string;
  demoFallback: string;

  wfEyebrow: string;
  wfTitle: string;
  wfSubtitle: string;
  bmTagPrefix: string;
  captureTabsAria: string;
  t1Title: string;
  t1Badge: string;
  t1Desc: string;
  tabShotAnnotation: string;
  tabShotPopup: string;
  shotAltAnnotation: string;
  shotCaptionAnnotation: string;
  shotAltPopup: string;
  shotCaptionPopup: string;
  t2Title: string;
  t2Badge: string;
  t2Desc: string;
  t2ImgAlt: string;
  t2Caption: string;
  archiveSampleName: string;
  treeLabel: string;
  fileTree: FileTreeItem[];
  t3Title: string;
  t3Badge: string;
  t3Desc: string;
  promptTabsAria: string;
  tabPromptCompact: string;
  tabPromptFull: string;
  btnCopyPrompt: string;
  btnCopied: string;
  btnCopyFailed: string;
  t4Title: string;
  t4Badge: string;
  t4Desc: string;

  capEyebrow: string;
  capTitle: string;
  capSubtitle: string;
  capabilities: CapabilityItem[];

  skillEyebrow: string;
  skillTitle: string;
  skillDesc: string;
  skillPoints: string[];
  osTabsAria: string;
  skillOsMac: string;
  skillOsWin: string;
  skillStep1Label: string;
  skillStep2Label: string;
  cliCopy: string;
  cliCopied: string;

  perfStatusBadge: string;
  perfFootnote: string;
  perfKpiTitles: Record<"kpi1" | "kpi2" | "kpi3" | "kpi4", string>;
  perfRuntimeTitle: string;
  perfLegendRust: string;
  perfLegendJs: string;
  perfMetrics: Record<
    "m1" | "m2" | "m3" | "m4",
    { name: string; gain: string }
  >;
  perfContextTitle: string;
  perfRingSub: string;
  perfStepLabels: Record<"open" | "timeline" | "net", string>;
  perfCtxBefore: string;
  perfCtxAfter: string;

  changelogEyebrow: string;
  changelogTitle: string;
  changelogDesc: string;
  changelogViewAllPrefix: string;
  changelogHistoryText: string;
  tagLatest: string;
  drawerEyebrow: string;
  drawerTitle: string;
  drawerHistoryLabel: string;
  closeAria: string;
  changelogMore: string;

  faqEyebrow: string;
  faqTitle: string;
  faqs: FaqItem[];

  footerSource: string;
  footerPrivacy: string;
  footerDiscussions: string;
  footerIssues: string;
  footerCommunity: string;
  footerLicense: string;
  footerLangLinkLabel: string;
}
