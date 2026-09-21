import "./footer.js";

/**
 * Assets Studio download site
 * Release URLs stay on GitHub until installer assets are uploaded.
 * Update RELEASES.windows / RELEASES.mac to direct asset links when ready.
 */

const RELEASES = {
  all: "https://github.com/SanXiaoXing/tools-studio/releases",
  latest: "https://github.com/SanXiaoXing/tools-studio/releases/latest",
  // Direct installer links — replace after packages are published
  windows: "https://github.com/SanXiaoXing/tools-studio/releases/latest",
  mac: "https://github.com/SanXiaoXing/tools-studio/releases/latest",
};

const THEME_KEY = "assets-studio-theme";
const THEME_DURATION_MS = 600;
const THEME_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

let themeTransitionBusy = false;

function detectPlatform() {
  const ua = `${navigator.userAgentData?.platform || ""} ${
    navigator.platform || ""
  } ${navigator.userAgent || ""}`.toLowerCase();

  if (/win/.test(ua)) return "windows";
  if (/mac|darwin|iphone|ipad/.test(ua)) return "mac";
  return null;
}

function applyDownloads() {
  const platform = detectPlatform();
  const urlFor = {
    windows: RELEASES.windows,
    mac: RELEASES.mac,
  };

  document.querySelectorAll("[data-download]").forEach((el) => {
    const key = el.getAttribute("data-download");
    if (urlFor[key]) el.setAttribute("href", urlFor[key]);

    if (platform && key === platform) {
      el.classList.add("is-recommended");
      const label = el.querySelector("[data-download-label]");
      if (label) label.textContent = key === "windows" ? "Windows 下载" : "macOS 下载";
    }
  });

  const card = document.querySelector(`[data-platform="${platform}"]`);
  if (card) card.classList.add("is-recommended");
}

function applyNavScroll() {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;

  const onScroll = () => {
    const solid = window.scrollY > 8;
    nav.classList.toggle("is-solid", solid);
    document.body.classList.toggle("is-scrolled", solid);
  };

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function applyReveal() {
  const nodes = document.querySelectorAll(".reveal");
  if (!nodes.length) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    nodes.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );

  nodes.forEach((el) => io.observe(el));
}

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function persistTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — theme still applies for this session */
  }
}

function resolveSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const toggle = document.querySelector("[data-theme-toggle]");
  if (!toggle) return;

  const nextLabel = theme === "dark" ? "浅色" : "深色";
  toggle.setAttribute("aria-label", `切换到${nextLabel}模式`);
  toggle.setAttribute("title", `切换到${nextLabel}模式`);
}

/** Exact center of the toggle + radius that covers the full viewport. */
function getRevealOrigin(el) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const r = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );
  return { x, y, r };
}

function clearRevealOrigin() {
  document.documentElement.style.removeProperty("--theme-x");
  document.documentElement.style.removeProperty("--theme-y");
  document.documentElement.style.removeProperty("--theme-r");
}

function supportsViewTransitions() {
  return typeof document.startViewTransition === "function";
}

/**
 * Primary path: View Transitions API + circular clip-path from the click origin.
 * New theme snapshot expands over the old one — no flash, no full-page fade.
 */
function runViewTransitionReveal(nextTheme, origin) {
  const style = document.createElement("style");
  style.setAttribute("data-theme-reveal", "");
  style.textContent = `
    ::view-transition-old(root),
    ::view-transition-new(root) {
      animation: none !important;
      mix-blend-mode: normal !important;
    }
    ::view-transition-old(root) { z-index: 1 !important; }
    ::view-transition-new(root) {
      z-index: 2 !important;
      animation: as-theme-circle ${THEME_DURATION_MS}ms ${THEME_EASE} both !important;
    }
    @keyframes as-theme-circle {
      from { clip-path: circle(0px at ${origin.x}px ${origin.y}px); }
      to { clip-path: circle(${origin.r}px at ${origin.x}px ${origin.y}px); }
    }
  `;
  document.head.appendChild(style);

  const transition = document.startViewTransition(() => {
    setTheme(nextTheme);
  });

  return transition.finished.finally(() => {
    style.remove();
  });
}

/**
 * Fallback: full-viewport layer carrying the new theme, expanding via clip-path
 * from the toggle center, then commit the real theme and remove the layer.
 */
function runClipPathFallbackReveal(button, nextTheme, origin) {
  return new Promise((resolve) => {
    const layer = document.createElement("div");
    layer.className = "theme-reveal-layer";
    layer.setAttribute("data-theme", nextTheme);
    layer.setAttribute("aria-hidden", "true");
    layer.style.setProperty("--theme-x", `${origin.x}px`);
    layer.style.setProperty("--theme-y", `${origin.y}px`);

    const page = document.createElement("div");
    page.className = "theme-reveal-layer__page";
    if (document.body.className) page.classList.add(document.body.className);
    page.style.transform = `translateY(${-window.scrollY}px)`;

    const bodyNodes = Array.from(document.body.childNodes);
    for (const node of bodyNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = /** @type {Element} */ (node);
        if (el.tagName === "SCRIPT") continue;
        if (el.classList.contains("theme-reveal-layer")) continue;
      }
      if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue;
      page.appendChild(node.cloneNode(true));
    }

    // Strip interactive bits from the inert snapshot
    page.querySelectorAll("script").forEach((s) => s.remove());
    page.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.setAttribute("tabindex", "-1");
      btn.setAttribute("aria-hidden", "true");
    });

    layer.appendChild(page);
    document.body.appendChild(layer);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      setTheme(nextTheme);
      layer.remove();
      clearRevealOrigin();
      resolve();
    };

    // Double rAF so the initial circle(0) paints before expanding
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        layer.classList.add("is-expanding");
        layer.style.clipPath = `circle(${origin.r}px at ${origin.x}px ${origin.y}px)`;
      });
    });

    layer.addEventListener("transitionend", (event) => {
      if (event.propertyName === "clip-path") finish();
    });

    // Safety net if transitionend never fires
    window.setTimeout(finish, THEME_DURATION_MS + 80);

    // Keep reference used for debugging layout if needed
    void button;
  });
}

function runThemeTransition(button, nextTheme) {
  if (themeTransitionBusy) return Promise.resolve();
  themeTransitionBusy = true;

  const origin = getRevealOrigin(button);
  document.documentElement.style.setProperty("--theme-x", `${origin.x}px`);
  document.documentElement.style.setProperty("--theme-y", `${origin.y}px`);
  document.documentElement.style.setProperty("--theme-r", `${origin.r}px`);

  const commit = () => {
    setTheme(nextTheme);
    persistTheme(nextTheme);
  };

  if (prefersReducedMotion()) {
    commit();
    clearRevealOrigin();
    themeTransitionBusy = false;
    return Promise.resolve();
  }

  const run = supportsViewTransitions()
    ? runViewTransitionReveal(nextTheme, origin)
    : runClipPathFallbackReveal(button, nextTheme, origin);

  return run
    .then(() => {
      // Snapshot path already applied setTheme; persist after the reveal lands
      setTheme(nextTheme);
      persistTheme(nextTheme);
    })
    .catch(() => {
      // If VT fails mid-flight, land on a clean theme state
      setTheme(nextTheme);
      persistTheme(nextTheme);
    })
    .finally(() => {
      clearRevealOrigin();
      themeTransitionBusy = false;
    });
}

function applyThemeToggle() {
  const toggle = document.querySelector("[data-theme-toggle]");
  if (!toggle) return;

  const stored = readStoredTheme();
  setTheme(stored || resolveSystemTheme());

  toggle.addEventListener("click", () => {
    const current =
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light";
    const next = current === "dark" ? "light" : "dark";
    void runThemeTransition(toggle, next);
  });

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = (event) => {
    if (readStoredTheme()) return;
    setTheme(event.matches ? "dark" : "light");
  };

  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onSystemChange);
  } else if (typeof media.addListener === "function") {
    media.addListener(onSystemChange);
  }
}

applyDownloads();
applyNavScroll();
applyReveal();
applyThemeToggle();

export { RELEASES };
