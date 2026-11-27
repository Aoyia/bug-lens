export type Locale = "en" | "zh";

export const SITE_NAME = "Bug Lens";
export const SITE_ORIGIN = "https://aoyia.github.io";
export const SITE_BASE = "/bug-lens";

export const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/bug-lens/mjfoododejekngekcmidcfagmmgabmjc";
export const EDGE_STORE_URL =
  "https://microsoftedge.microsoft.com/addons/detail/cpkhddjakccclhdacmpiiajdlbfmldcj";

export const GITHUB_REPO_URL = "https://github.com/Aoyia/bug-lens";
export const GITHUB_RELEASES_LATEST_URL =
  "https://github.com/Aoyia/bug-lens/releases/latest";
export const GITHUB_RELEASES_URL = "https://github.com/Aoyia/bug-lens/releases";
export const GITHUB_PRIVACY_URL =
  "https://github.com/Aoyia/bug-lens/blob/main/PRIVACY.md";
export const GITHUB_DISCUSSIONS_URL =
  "https://github.com/Aoyia/bug-lens/discussions";
export const GITHUB_ISSUES_URL = "https://github.com/Aoyia/bug-lens/issues";
export const GITHUB_COMMUNITY_URL =
  "https://github.com/Aoyia/bug-lens/blob/main/README_zh.md#%E4%BA%A4%E6%B5%81%E7%BE%A4";
export const GITHUB_LICENSE_URL =
  "https://github.com/Aoyia/bug-lens/blob/main/LICENSE";

export const SKILL_INSTALL_CMD = "npx skills add Aoyia/bug-lens-skill -g -y";

export const IMAGE_DIMENSIONS = {
  logo: { width: 128, height: 128 },
  ogCover: { width: 1200, height: 630 },
  demoPoster: { width: 1280, height: 720 },
  screenshotAnnotation: { width: 1024, height: 566 },
  popupPanel: { width: 688, height: 880 },
  previewWorkspace: { width: 1024, height: 529 },
} as const;

export function withBase(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_BASE}${normalized}`;
}

export function getLocalePath(locale: Locale): string {
  return locale === "zh" ? withBase("/zh/") : withBase("/");
}

export function absoluteUrl(path: string): string {
  const basePath = path.startsWith(SITE_BASE) ? path : withBase(path);
  return `${SITE_ORIGIN}${basePath}`;
}

export function getLocaleUrl(locale: Locale): string {
  return `${SITE_ORIGIN}${getLocalePath(locale)}`;
}
