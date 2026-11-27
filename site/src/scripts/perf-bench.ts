export function initPerfBenchAnimation(): void {
  const wrap = document.querySelector<HTMLElement>(".perf-bench-wrap");
  if (!wrap) return;

  const reducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion || !("IntersectionObserver" in window)) {
    wrap.classList.add("perf-animated");
    return;
  }

  const counterEls = Array.from(
    wrap.querySelectorAll<HTMLElement>("[data-count-to]")
  );
  let isActive = false;
  let enterRaf1 = 0;
  let enterRaf2 = 0;
  let kpiRafId = 0;

  function formatCounter(el: HTMLElement, ratio: number): void {
    const target = Number.parseFloat(el.dataset.countTo || "0") || 0;
    const decimals = Number.parseInt(el.dataset.countDecimals || "0", 10) || 0;
    const prefix = el.dataset.countPrefix || "";
    const suffix = el.dataset.countSuffix || "";
    const val = (target * ratio).toFixed(decimals);
    el.textContent = prefix + val + suffix;
  }

  function cancelPendingFrames(): void {
    if (enterRaf1) window.cancelAnimationFrame(enterRaf1);
    if (enterRaf2) window.cancelAnimationFrame(enterRaf2);
    if (kpiRafId) window.cancelAnimationFrame(kpiRafId);
    enterRaf1 = 0;
    enterRaf2 = 0;
    kpiRafId = 0;
  }

  function runCountUp(): void {
    if (!counterEls.length) return;
    const duration = 850;
    let startTime: number | null = null;

    for (const el of counterEls) {
      formatCounter(el, 0);
    }

    function tick(now: number): void {
      if (!isActive) return;
      if (startTime === null) startTime = now;
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      for (const el of counterEls) {
        formatCounter(el, eased);
      }
      if (progress < 1) {
        kpiRafId = window.requestAnimationFrame(tick);
      } else {
        for (const el of counterEls) {
          formatCounter(el, 1);
        }
        kpiRafId = 0;
      }
    }

    kpiRafId = window.requestAnimationFrame(tick);
  }

  function trigger(): void {
    if (isActive) return;
    isActive = true;
    cancelPendingFrames();
    enterRaf1 = window.requestAnimationFrame(() => {
      if (!isActive) return;
      enterRaf2 = window.requestAnimationFrame(() => {
        if (!isActive) return;
        wrap!.classList.add("perf-animated");
        runCountUp();
      });
    });
  }

  function resetOffscreen(): void {
    if (!isActive && !wrap!.classList.contains("perf-animated")) return;
    isActive = false;
    cancelPendingFrames();
    wrap!.classList.remove("perf-animated");
    for (const el of counterEls) {
      formatCounter(el, 0);
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio === 0) {
          resetOffscreen();
          continue;
        }
        const tallContainer =
          entry.boundingClientRect.height > window.innerHeight * 0.85;
        const minRatio = tallContainer ? 0.12 : 0.25;
        if (!isActive && entry.intersectionRatio >= minRatio) {
          trigger();
        }
      }
    },
    { threshold: [0, 0.12, 0.25], rootMargin: "0px" }
  );

  observer.observe(wrap);
}
