import { LATEST_RELEASE } from "./releases";
import {
  CHROME_STORE_URL,
  GITHUB_LICENSE_URL,
  GITHUB_REPO_URL,
  SITE_NAME,
  absoluteUrl,
  getLocaleUrl,
  type Locale,
} from "./site";
import { getSiteCopy } from "./i18n";

export function buildJsonLd(locale: Locale): Record<string, unknown> {
  const copy = getSiteCopy(locale);
  const pageUrl = getLocaleUrl(locale);
  const ogImageUrl = absoluteUrl("/assets/og-cover.jpg");
  const screenshotUrl = absoluteUrl(
    "/assets/showcase/evidence-preview-workspace.png"
  );

  const howToSteps = [
    {
      name: copy.t1Title,
      text: copy.t1Desc,
      image: absoluteUrl("/assets/showcase/screenshot-annotation.png"),
      url: `${pageUrl}#workflow`,
    },
    {
      name: copy.t2Title,
      text: copy.t2Desc,
      image: screenshotUrl,
      url: `${pageUrl}#workflow`,
    },
    {
      name: copy.t3Title,
      text: copy.t3Desc,
      url: `${pageUrl}#workflow`,
    },
    {
      name: copy.t4Title,
      text: copy.t4Desc,
      url: `${pageUrl}#workflow`,
    },
  ];

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${pageUrl}#website`,
        name: SITE_NAME,
        url: pageUrl,
        inLanguage: copy.htmlLang,
        description: copy.metaDescription,
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${pageUrl}#app`,
        name: SITE_NAME,
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "Browser Debugging Extension",
        operatingSystem: "Chrome 125+, Edge 125+, macOS, Linux, Windows",
        softwareVersion: LATEST_RELEASE.version,
        dateModified: LATEST_RELEASE.date,
        url: pageUrl,
        downloadUrl: CHROME_STORE_URL,
        installUrl: CHROME_STORE_URL,
        codeRepository: GITHUB_REPO_URL,
        license: GITHUB_LICENSE_URL,
        inLanguage: copy.htmlLang,
        description: copy.metaDescription,
        image: ogImageUrl,
        screenshot: screenshotUrl,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        featureList: copy.capabilities.map((c) => `${c.title}: ${c.desc}`),
      },
      {
        "@type": "HowTo",
        "@id": `${pageUrl}#workflow`,
        name: copy.wfTitle,
        description: copy.wfSubtitle,
        inLanguage: copy.htmlLang,
        step: howToSteps.map((s, idx) => ({
          "@type": "HowToStep",
          position: idx + 1,
          name: s.name,
          text: s.text,
          url: s.url,
          ...(s.image ? { image: s.image } : {}),
        })),
      },
      {
        "@type": "FAQPage",
        "@id": `${pageUrl}#faq`,
        inLanguage: copy.htmlLang,
        mainEntity: copy.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
    ],
  };
}
