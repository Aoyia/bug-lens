export function initScrollInteractions(): void {
  const navBar = document.querySelector<HTMLElement>(".nav-bar");
  const desktopLinks = document.querySelectorAll<HTMLAnchorElement>(
    '.nav-links a[href^="#"]'
  );
  const mobileLinks = document.querySelectorAll<HTMLAnchorElement>(
    '.mobile-nav-inner a[href^="#"]'
  );

  const trackedLinks: HTMLAnchorElement[] = [];
  const sections: Array<{ id: string; el: HTMLElement }> = [];
  const seenIds = new Set<string>();

  function collectLinks(nodeList: NodeListOf<HTMLAnchorElement>): void {
    nodeList.forEach((link) => {
      const href = link.getAttribute("href") || "";
      const id = href.slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      trackedLinks.push(link);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        sections.push({ id, el: target });
      }
    });
  }

  collectLinks(desktopLinks);
  collectLinks(mobileLinks);

  const tlBody = document.querySelector<HTMLElement>("#workflow .tl-body");
  const tlSpine = document.getElementById("tlSpine");
  const tlSpineFill = document.getElementById("tlSpineFill");
  const tlSteps = tlBody
    ? Array.from(tlBody.querySelectorAll<HTMLElement>(".tl-step"))
    : [];
  let spineSpan = 0;

  function measureSpine(): void {
    if (!tlBody || !tlSpine || tlSteps.length < 2) return;
    const firstNum = tlSteps[0].querySelector<HTMLElement>(".tl-num");
    const lastNum =
      tlSteps[tlSteps.length - 1].querySelector<HTMLElement>(".tl-num");
    if (!firstNum || !lastNum) return;

    const bodyRect = tlBody.getBoundingClientRect();
    const firstRect = firstNum.getBoundingClientRect();
    const lastRect = lastNum.getBoundingClientRect();

    const left = firstRect.left - bodyRect.left + firstRect.width / 2 - 1;
    const top = firstRect.top - bodyRect.top + firstRect.height / 2;
    const bottom = lastRect.top - bodyRect.top + lastRect.height / 2;
    spineSpan = Math.max(1, bottom - top);

    tlSpine.style.left = left.toFixed(1) + "px";
    tlSpine.style.top = top.toFixed(1) + "px";
    tlSpine.style.height = spineSpan.toFixed(1) + "px";
  }

  function updateFrame(): void {
    const docEl = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const maxScroll = Math.max(0, docEl.scrollHeight - window.innerHeight);

    if (sections.length) {
      const navHeight = navBar ? navBar.getBoundingClientRect().height : 64;
      const probeY =
        navHeight + Math.min(120, Math.round(window.innerHeight * 0.22));
      let activeId = "";
      const firstTop = sections[0].el.getBoundingClientRect().top;

      if (scrollY >= 40 && firstTop <= probeY) {
        for (const section of sections) {
          if (section.el.getBoundingClientRect().top <= probeY) {
            activeId = section.id;
          }
        }
        if (maxScroll > 0 && maxScroll - scrollY <= 8) {
          activeId = sections[sections.length - 1].id;
        }
      }

      for (const link of trackedLinks) {
        const isMatch =
          activeId !== "" && link.getAttribute("href") === `#${activeId}`;
        link.classList.toggle("is-active", isMatch);
        if (isMatch) {
          link.setAttribute("aria-current", "location");
        } else {
          link.removeAttribute("aria-current");
        }
      }
    }

    if (tlSpine && tlSpineFill && tlSteps.length >= 2 && spineSpan > 0) {
      const triggerY = window.innerHeight * 0.62;
      const spineRect = tlSpine.getBoundingClientRect();
      const fillRatio = Math.min(
        1,
        Math.max(0, (triggerY - spineRect.top) / spineSpan)
      );
      tlSpineFill.style.transform = `scaleY(${fillRatio.toFixed(4)})`;

      let currentIdx = -1;
      for (let i = 0; i < tlSteps.length; i++) {
        const numEl = tlSteps[i].querySelector<HTMLElement>(".tl-num");
        let reached = false;
        if (numEl) {
          const numRect = numEl.getBoundingClientRect();
          const numCenter = numRect.top + numRect.height / 2;
          reached = numCenter <= triggerY || fillRatio >= 0.995;
        }
        tlSteps[i].classList.toggle("is-reached", reached);
        if (reached) currentIdx = i;
      }

      for (let i = 0; i < tlSteps.length; i++) {
        tlSteps[i].classList.toggle("is-current", i === currentIdx);
      }
    }
  }

  let rafPending = false;
  function scheduleUpdate(): void {
    if (rafPending) return;
    rafPending = true;
    window.requestAnimationFrame(() => {
      rafPending = false;
      updateFrame();
    });
  }

  measureSpine();
  updateFrame();

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", () => {
    measureSpine();
    scheduleUpdate();
  });

  if (typeof ResizeObserver !== "undefined" && tlBody) {
    const ro = new ResizeObserver(() => {
      measureSpine();
      scheduleUpdate();
    });
    ro.observe(tlBody);
  }

  if (document.fonts && document.fonts.ready) {
    void document.fonts.ready.then(() => {
      measureSpine();
      scheduleUpdate();
    });
  }
}
