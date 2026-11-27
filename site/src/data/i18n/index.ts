import type { Locale } from "../site";
import type { SiteCopy } from "./types";
import { EN_COPY } from "./en";
import { ZH_COPY } from "./zh";

export const SITE_COPY: Record<Locale, SiteCopy> = {
  en: EN_COPY,
  zh: ZH_COPY,
};

export function getSiteCopy(locale: Locale): SiteCopy {
  return SITE_COPY[locale];
}

export type {
  SiteCopy,
  CapabilityItem,
  CapabilityIcon,
  FaqItem,
  FileTreeItem,
} from "./types";
