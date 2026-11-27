function parseDelayMs(node: HTMLElement): number {
  const inlineDelay = node.style.getPropertyValue("--reveal-delay");
  const raw =
    inlineDelay ||
    window.getComputedStyle(node).getPropertyValue("--reveal-delay");
  const parsed = Number.parseFloat(raw || "0");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function scheduleSettle(node: HTMLElement): void {
  if (node.classList.contains("reveal-settled")) return;

  const isStep = node.classList.contains("tl-step");
  const listenTarget = isStep
    ? node.querySelector<HTMLElement>(".tl-step-content") || node
    : node;
  const delayMs = parseDelayMs(node) + (isStep ? 60 : 0);
  let settled = false;
  let timerId = 0;

  function finish(): void {
    if (settled) return;
    settled = true;
    node.classList.add("reveal-settled");
    listenTarget.removeEventListener("transitionend", onTransitionEnd);
    if (timerId) window.clearTimeout(timerId);
  }

  function onTransitionEnd(e: TransitionEvent): void {
    if (e.target !== listenTarget) return;
    if (
      e.propertyName === "filter" ||
      e.propertyName === "opacity" ||
      e.propertyName === "clip-path"
    ) {
      finish();
    }
  }

  listenTarget.addEventListener("transitionend", onTransitionEnd);
  timerId = window.setTimeout(finish, 1150 + delayMs);
}

export function initReveal(): void {
  const reveals = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
  const reducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reducedMotion || !("IntersectionObserver" in window)) {
    for (const node of reveals) {
      node.classList.add("visible", "reveal-settled");
    }
    document.documentElement.classList.add("js-ready");
    return;
  }

  // Mark elements already visible in the initial viewport as settled before activating js-ready
  const initialCutoff = window.innerHeight * 0.92;
  const deferred: HTMLElement[] = [];

  for (const node of reveals) {
    const rect = node.getBoundingClientRect();
    if (rect.top < initialCutoff) {
      node.classList.add("visible", "reveal-settled");
    } else {
      deferred.push(node);
    }
  }

  document.documentElement.classList.add("js-ready");

  if (!deferred.length) return;

  function triggerNode(node: HTMLElement): void {
    if (node.classList.contains("visible")) return;
    node.classList.add("visible");
    scheduleSettle(node);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = entry.target as HTMLElement;
        triggerNode(target);
        observer.unobserve(target);
      }
    },
    { threshold: [0.05, 0.12], rootMargin: "0px 0px -10% 0px" }
  );

  for (const node of deferred) {
    observer.observe(node);
  }

  function sweepOnScroll(): number {
    const fallbackCutoff = window.innerHeight * 0.88;
    let remaining = 0;
    for (const node of deferred) {
      if (node.classList.contains("visible")) continue;
      if (node.getBoundingClientRect().top <= fallbackCutoff) {
        triggerNode(node);
        observer.unobserve(node);
      } else {
        remaining++;
      }
    }
    return remaining;
  }

  const onScroll = () => {
    if (sweepOnScroll() === 0) {
      window.removeEventListener("scroll", onScroll);
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });
}
