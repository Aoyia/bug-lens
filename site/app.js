(function () {
  var ns = window.BUG_LENS_SITE || {};
  var RELEASES = Array.isArray(ns.RELEASES) ? ns.RELEASES : [];
  var I18N = ns.I18N || {};
  var PROMPTS = ns.PROMPTS || {};

  var CHROME_STORE_URL =
    "https://chromewebstore.google.com/detail/bug-lens/mjfoododejekngekcmidcfagmmgabmjc";
  var EDGE_STORE_URL =
    "https://microsoftedge.microsoft.com/addons/detail/cpkhddjakccclhdacmpiiajdlbfmldcj";

  document.documentElement.classList.add("js-ready");

  function isEdgeBrowser() {
    return /\bEdg\//.test(navigator.userAgent || "");
  }

  var state = {
    lang: getSavedLang(),
    promptMode: "compact",
    shotTab: "annotation",
    osTab: "unix",
    lastFocusedEl: null,
  };

  function detectBrowserLang() {
    var lang = (navigator.language || "").toLowerCase();
    return lang.indexOf("zh") === 0 ? "zh" : "en";
  }

  function getSavedLang() {
    try {
      return (
        localStorage.getItem("bl_lang") ||
        localStorage.getItem("bl-lang") ||
        detectBrowserLang()
      );
    } catch (e) {
      return detectBrowserLang();
    }
  }

  function saveLang(lang) {
    try {
      localStorage.setItem("bl_lang", lang);
      localStorage.setItem("bl-lang", lang);
    } catch (e) {
      // Ignore storage failures in restricted contexts
    }
  }

  function copyText(text, onDone) {
    function legacyCopy() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      onDone(ok);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          onDone(true);
        },
        function () {
          legacyCopy();
        }
      );
    } else {
      legacyCopy();
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function renderFeatureList(container, items) {
    for (var i = 0; i < items.length; i++) {
      var row = el("div", "changelog-feature");
      var strong = el("strong", "", items[i].title);
      var span = el("span", "", " " + items[i].desc);
      row.appendChild(strong);
      row.appendChild(span);
      container.appendChild(row);
    }
  }

  function renderChangelog() {
    if (!RELEASES.length) return;
    var d = I18N[state.lang] || I18N.en;
    var latest = RELEASES[0];
    var oldest = RELEASES[RELEASES.length - 1];
    var prev = RELEASES[1];

    // Hero badge
    var heroTag = document.getElementById("heroVersionTag");
    var heroText = document.getElementById("heroVersionText");
    if (heroTag) heroTag.textContent = "v" + latest.version;
    if (heroText && d.heroVersionBadgePrefix) {
      heroText.textContent =
        "v" + latest.version + " " + d.heroVersionBadgePrefix;
    }

    // View all button range
    var viewAllBtn = document.getElementById("changelogViewAllBtn");
    if (viewAllBtn && d.changelogViewAllPrefix) {
      viewAllBtn.textContent =
        d.changelogViewAllPrefix +
        " (v" +
        oldest.version +
        " ~ v" +
        latest.version +
        ") →";
    }

    // Main summary card
    var summaryCard = document.getElementById("changelogSummaryCard");
    if (summaryCard) {
      summaryCard.textContent = "";
      var header = el("div", "changelog-header");
      var meta = el("div", "changelog-meta");
      meta.appendChild(el("span", "changelog-ver", "v" + latest.version));
      meta.appendChild(el("span", "changelog-tag", d.tagLatest || "Latest"));
      meta.appendChild(el("span", "changelog-date", latest.date));

      var moreBtn = el(
        "button",
        "changelog-summary-more-btn",
        d.changelogHistoryText || "View All"
      );
      moreBtn.type = "button";
      moreBtn.addEventListener("click", openChangelogDrawer);

      header.appendChild(meta);
      header.appendChild(moreBtn);
      summaryCard.appendChild(header);

      var content = el("div", "changelog-content");
      var highlights =
        (latest.highlights && latest.highlights[state.lang]) || [];
      renderFeatureList(content, highlights);
      summaryCard.appendChild(content);
    }

    // Drawer spotlight card
    var spotlightMount = document.getElementById("drawerSpotlightMount");
    if (spotlightMount) {
      spotlightMount.textContent = "";
      var spot = el("div", "drawer-spotlight-card");
      var sHeader = el("div", "drawer-spotlight-header");
      sHeader.appendChild(
        el("span", "drawer-spotlight-ver", "v" + latest.version)
      );
      sHeader.appendChild(el("span", "changelog-tag", d.tagLatest || "Latest"));
      sHeader.appendChild(el("span", "changelog-date", latest.date));
      spot.appendChild(sHeader);

      var sContent = el("div", "drawer-spotlight-content");
      var sHighlights =
        (latest.highlights && latest.highlights[state.lang]) || [];
      for (var j = 0; j < sHighlights.length; j++) {
        var feat = el("div", "drawer-spotlight-feature");
        feat.appendChild(el("strong", "", sHighlights[j].title));
        feat.appendChild(el("span", "", " " + sHighlights[j].desc));
        sContent.appendChild(feat);
      }

      if (latest.cliCommand) {
        var capsule = el("div", "cli-capsule");
        var code = el("code", "cli-code");
        code.appendChild(el("span", "cli-prefix", "$"));
        code.appendChild(el("span", "", latest.cliCommand));

        var copyBtn = el("button", "cli-copy-btn");
        copyBtn.type = "button";
        copyBtn.setAttribute("data-copy-text", latest.cliCommand);
        copyBtn.appendChild(el("span", "", d.cliCopy || "Copy"));
        bindCliCopy(copyBtn);

        capsule.appendChild(code);
        capsule.appendChild(copyBtn);
        sContent.appendChild(capsule);
      }

      spot.appendChild(sContent);
      spotlightMount.appendChild(spot);
    }

    // Drawer history divider & timeline
    var historyTitle = document.getElementById("drawerHistoryTitle");
    if (historyTitle && prev) {
      historyTitle.textContent =
        (d.drawerHistoryLabel || "History") +
        " (v" +
        prev.version +
        " ~ v" +
        oldest.version +
        ")";
    }

    var timelineMount = document.getElementById("drawerTimelineMount");
    if (timelineMount) {
      timelineMount.textContent = "";
      for (var r = 1; r < RELEASES.length; r++) {
        var rel = RELEASES[r];
        var item = el("div", "changelog-item");
        var marker = el("div", "changelog-marker");
        marker.appendChild(el("span", "changelog-dot"));
        item.appendChild(marker);

        var card = el("div", "changelog-card");
        var cHeader = el("div", "changelog-header");
        var cMeta = el("div", "changelog-meta");
        cMeta.appendChild(el("span", "changelog-ver", "v" + rel.version));
        cMeta.appendChild(el("span", "changelog-date", rel.date));
        cHeader.appendChild(cMeta);
        card.appendChild(cHeader);

        var cContent = el("div", "changelog-content");
        var rHighlights = (rel.highlights && rel.highlights[state.lang]) || [];
        renderFeatureList(cContent, rHighlights);
        card.appendChild(cContent);

        item.appendChild(card);
        timelineMount.appendChild(item);
      }
    }
  }

  function renderPrompt() {
    var display = document.getElementById("rawPromptDisplay");
    if (!display) return;
    var bucket = PROMPTS[state.promptMode] || PROMPTS.compact || {};
    display.textContent = bucket[state.lang] || bucket.en || "";
  }

  function applyInstallChannels() {
    var d = I18N[state.lang] || I18N.en;
    var edge = isEdgeBrowser();
    var primaryBtn = document.getElementById("primaryInstallBtn");
    var primaryLabel = document.getElementById("primaryInstallLabel");
    var iconChrome = document.getElementById("installIconChrome");
    var iconEdge = document.getElementById("installIconEdge");
    var altLink = document.getElementById("altStoreLink");

    if (primaryBtn) {
      primaryBtn.href = edge ? EDGE_STORE_URL : CHROME_STORE_URL;
    }
    if (primaryLabel) {
      primaryLabel.textContent = edge
        ? d.ctaStoreEdge || "Install for Edge"
        : d.ctaStore || "Install for Chrome";
    }
    if (iconChrome) {
      if (edge) iconChrome.setAttribute("hidden", "");
      else iconChrome.removeAttribute("hidden");
    }
    if (iconEdge) {
      if (edge) iconEdge.removeAttribute("hidden");
      else iconEdge.setAttribute("hidden", "");
    }
    if (altLink) {
      altLink.href = edge ? CHROME_STORE_URL : EDGE_STORE_URL;
      altLink.textContent = edge
        ? d.altChromeStore || "Chrome Web Store"
        : d.altEdgeStore || "Microsoft Edge Add-ons";
    }
  }

  function applyLanguage(lang) {
    state.lang = lang === "zh" ? "zh" : "en";
    var d = I18N[state.lang] || I18N.en;

    if (d.pageTitle) {
      document.title = d.pageTitle;
    }

    var nodes = document.querySelectorAll("[data-l10n]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-l10n");
      if (!d[key]) continue;
      if (d[key].indexOf("<") !== -1) {
        nodes[i].innerHTML = d[key];
      } else {
        nodes[i].textContent = d[key];
      }
    }

    var ariaNodes = document.querySelectorAll("[data-l10n-aria]");
    for (var j = 0; j < ariaNodes.length; j++) {
      var ariaKey = ariaNodes[j].getAttribute("data-l10n-aria");
      if (d[ariaKey]) {
        ariaNodes[j].setAttribute("aria-label", d[ariaKey]);
      }
    }

    document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
    var switchBtn = document.getElementById("langSwitch");
    if (switchBtn) {
      switchBtn.textContent = state.lang === "zh" ? "EN" : "中文";
    }

    applyInstallChannels();
    renderPrompt();
    renderChangelog();
  }

  function bindTabs(attrName, panelAttrName, onSelect) {
    var tabs = document.querySelectorAll("[" + attrName + "]");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        var target = this.getAttribute(attrName);
        for (var k = 0; k < tabs.length; k++) {
          var isSelected = tabs[k].getAttribute(attrName) === target;
          tabs[k].classList.toggle("active", isSelected);
          tabs[k].setAttribute("aria-selected", isSelected ? "true" : "false");
        }
        if (panelAttrName) {
          var panels = document.querySelectorAll("[" + panelAttrName + "]");
          for (var p = 0; p < panels.length; p++) {
            panels[p].hidden = panels[p].getAttribute(panelAttrName) !== target;
          }
        }
        if (onSelect) onSelect(target);
      });
    }
  }

  function bindCliCopy(btn) {
    if (btn.dataset.copyBound === "1") return;
    btn.dataset.copyBound = "1";
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy-text") || "";
      var span = btn.querySelector("span");
      var d = I18N[state.lang] || I18N.en;
      copyText(text, function (ok) {
        if (!ok || !span) return;
        span.textContent = d.cliCopied || "Copied";
        btn.classList.add("copied");
        setTimeout(function () {
          var latestDict = I18N[state.lang] || I18N.en;
          span.textContent = latestDict.cliCopy || "Copy";
          btn.classList.remove("copied");
        }, 1800);
      });
    });
  }

  function openChangelogDrawer() {
    var drawer = document.getElementById("changelogDrawer");
    var overlay = document.getElementById("changelogDrawerOverlay");
    if (!drawer || !overlay) return;
    state.lastFocusedEl = document.activeElement;
    drawer.classList.add("open");
    overlay.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    closeMobileNav();

    var closeBtn = document.getElementById("changelogDrawerClose");
    if (closeBtn) {
      setTimeout(function () {
        closeBtn.focus();
      }, 60);
    }
  }

  function closeChangelogDrawer() {
    var drawer = document.getElementById("changelogDrawer");
    var overlay = document.getElementById("changelogDrawerOverlay");
    if (!drawer || !overlay) return;
    if (!drawer.classList.contains("open")) return;
    drawer.classList.remove("open");
    overlay.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (
      state.lastFocusedEl &&
      typeof state.lastFocusedEl.focus === "function"
    ) {
      state.lastFocusedEl.focus();
      state.lastFocusedEl = null;
    }
  }

  function closeMobileNav() {
    var btn = document.getElementById("mobileMenuBtn");
    var panel = document.getElementById("mobileNavPanel");
    if (!btn || !panel) return;
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function initNavigation() {
    var langSwitch = document.getElementById("langSwitch");
    if (langSwitch) {
      langSwitch.addEventListener("click", function () {
        var next = state.lang === "zh" ? "en" : "zh";
        saveLang(next);
        applyLanguage(next);
      });
    }

    var menuBtn = document.getElementById("mobileMenuBtn");
    var menuPanel = document.getElementById("mobileNavPanel");
    if (menuBtn && menuPanel) {
      menuBtn.addEventListener("click", function () {
        var nextOpen = menuPanel.hidden;
        menuPanel.hidden = !nextOpen;
        menuBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      });

      var mobileLinks = menuPanel.querySelectorAll("a");
      for (var i = 0; i < mobileLinks.length; i++) {
        mobileLinks[i].addEventListener("click", closeMobileNav);
      }
    }

    var changelogTriggers = document.querySelectorAll("[data-open-changelog]");
    for (var j = 0; j < changelogTriggers.length; j++) {
      changelogTriggers[j].addEventListener("click", function (e) {
        e.preventDefault();
        openChangelogDrawer();
      });
    }

    var overlay = document.getElementById("changelogDrawerOverlay");
    var closeBtn = document.getElementById("changelogDrawerClose");
    if (overlay) overlay.addEventListener("click", closeChangelogDrawer);
    if (closeBtn) closeBtn.addEventListener("click", closeChangelogDrawer);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeChangelogDrawer();
        closeMobileNav();
      }
    });
  }

  function initPromptCopy() {
    var copyBtn = document.getElementById("copyPromptBtn");
    var copyLabel = document.getElementById("copyPromptBtnText");
    if (!copyBtn || !copyLabel) return;

    copyBtn.addEventListener("click", function () {
      var bucket = PROMPTS[state.promptMode] || PROMPTS.compact || {};
      var text = bucket[state.lang] || bucket.en || "";
      copyText(text, function (ok) {
        var d = I18N[state.lang] || I18N.en;
        copyLabel.textContent = ok
          ? d.btnCopied || "Copied!"
          : d.btnCopyFailed || "Copy failed";
        copyBtn.classList.toggle("copied", ok);
        setTimeout(function () {
          var latestDict = I18N[state.lang] || I18N.en;
          copyLabel.textContent = latestDict.btnCopyPrompt || "Copy Prompt";
          copyBtn.classList.remove("copied");
        }, 2000);
      });
    });
  }

  function initReveal() {
    var reveals = document.querySelectorAll(".reveal");

    function revealInOrAboveViewport() {
      var thresholdY = window.innerHeight + 120;
      var remaining = 0;
      for (var i = 0; i < reveals.length; i++) {
        var node = reveals[i];
        if (node.classList.contains("visible")) continue;
        var rect = node.getBoundingClientRect();
        if (rect.top <= thresholdY) {
          node.classList.add("visible");
        } else {
          remaining++;
        }
      }
      return remaining;
    }

    revealInOrAboveViewport();

    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < reveals.length; i++) {
        reveals[i].classList.add("visible");
      }
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            entries[i].target.classList.add("visible");
            observer.unobserve(entries[i].target);
          }
        }
      },
      { threshold: 0, rootMargin: "100px 0px 100px 0px" }
    );

    for (var j = 0; j < reveals.length; j++) {
      if (!reveals[j].classList.contains("visible")) {
        observer.observe(reveals[j]);
      }
    }

    var onScroll = function () {
      if (revealInOrAboveViewport() === 0) {
        window.removeEventListener("scroll", onScroll);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function initPerfBenchAnimation() {
    var wrap = document.querySelector(".perf-bench-wrap");
    if (!wrap) return;

    var reducedMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      wrap.classList.add("perf-animated");
      return;
    }

    var counterEls = wrap.querySelectorAll("[data-count-to]");
    var isActive = false;
    var enterRaf1 = 0;
    var enterRaf2 = 0;
    var kpiRafId = 0;

    function formatCounter(el, ratio) {
      var target = parseFloat(el.getAttribute("data-count-to")) || 0;
      var decimals = parseInt(
        el.getAttribute("data-count-decimals") || "0",
        10
      );
      var prefix = el.getAttribute("data-count-prefix") || "";
      var suffix = el.getAttribute("data-count-suffix") || "";
      var val = (target * ratio).toFixed(decimals);
      el.textContent = prefix + val + suffix;
    }

    function cancelPendingFrames() {
      if (enterRaf1) cancelAnimationFrame(enterRaf1);
      if (enterRaf2) cancelAnimationFrame(enterRaf2);
      if (kpiRafId) cancelAnimationFrame(kpiRafId);
      enterRaf1 = 0;
      enterRaf2 = 0;
      kpiRafId = 0;
    }

    function runCountUp() {
      if (!counterEls.length) return;
      var duration = 850;
      var startTime = null;

      for (var c = 0; c < counterEls.length; c++) {
        formatCounter(counterEls[c], 0);
      }

      function tick(now) {
        if (!isActive) return;
        if (startTime === null) startTime = now;
        var progress = Math.min((now - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        for (var i = 0; i < counterEls.length; i++) {
          formatCounter(counterEls[i], eased);
        }
        if (progress < 1) {
          kpiRafId = requestAnimationFrame(tick);
        } else {
          for (var j = 0; j < counterEls.length; j++) {
            formatCounter(counterEls[j], 1);
          }
          kpiRafId = 0;
        }
      }

      kpiRafId = requestAnimationFrame(tick);
    }

    function trigger() {
      if (isActive) return;
      isActive = true;
      cancelPendingFrames();
      enterRaf1 = requestAnimationFrame(function () {
        if (!isActive) return;
        enterRaf2 = requestAnimationFrame(function () {
          if (!isActive) return;
          wrap.classList.add("perf-animated");
          runCountUp();
        });
      });
    }

    function resetOffscreen() {
      if (!isActive && !wrap.classList.contains("perf-animated")) return;
      isActive = false;
      cancelPendingFrames();
      wrap.classList.remove("perf-animated");
      for (var i = 0; i < counterEls.length; i++) {
        formatCounter(counterEls[i], 0);
      }
    }

    var observer = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.isIntersecting || entry.intersectionRatio === 0) {
            resetOffscreen();
            continue;
          }
          var tallContainer =
            entry.boundingClientRect.height > window.innerHeight * 0.85;
          var minRatio = tallContainer ? 0.12 : 0.25;
          if (!isActive && entry.intersectionRatio >= minRatio) {
            trigger();
          }
        }
      },
      { threshold: [0, 0.12, 0.25], rootMargin: "0px" }
    );

    observer.observe(wrap);
  }

  function init() {
    applyLanguage(state.lang);
    initNavigation();
    initPromptCopy();
    bindTabs("data-shot-tab", "data-shot-panel", function (tab) {
      state.shotTab = tab;
    });
    bindTabs("data-prompt-mode", null, function (mode) {
      state.promptMode = mode;
      renderPrompt();
    });
    bindTabs("data-os-tab", "data-os-panel", function (os) {
      state.osTab = os;
    });

    var cliButtons = document.querySelectorAll(".cli-copy-btn");
    for (var i = 0; i < cliButtons.length; i++) {
      bindCliCopy(cliButtons[i]);
    }

    initReveal();
    initPerfBenchAnimation();

    if (window.location.hash === "#changelog") {
      setTimeout(openChangelogDrawer, 250);
    }
  }

  init();
})();
