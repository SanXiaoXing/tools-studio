/**
 * Footer: year stamp + reveal when in view.
 * Background type is pure CSS (no SVG / no pointer mask).
 */

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function initHoverFooter() {
  const footer = document.querySelector("[data-hover-footer]");
  if (!footer) return;

  const year = footer.querySelector("[data-footer-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  const show = () => footer.classList.add("is-visible");

  if (prefersReducedMotion()) {
    show();
    return;
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          show();
          io.disconnect();
        });
      },
      { threshold: 0.2 }
    );
    io.observe(footer);
    return;
  }

  show();
}

initHoverFooter();
