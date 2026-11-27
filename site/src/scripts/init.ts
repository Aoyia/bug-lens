import { initCopyButtons } from "./clipboard";
import {
  initInstallChannels,
  initNavigationAndDrawer,
  initTabs,
} from "./controls";
import { initPerfBenchAnimation } from "./perf-bench";
import { initReveal } from "./reveal";
import { initScrollInteractions } from "./scroll-sync";

function bootstrap(): void {
  initReveal();
  initInstallChannels();
  initTabs();
  initNavigationAndDrawer();
  initCopyButtons();
  initPerfBenchAnimation();
  initScrollInteractions();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
