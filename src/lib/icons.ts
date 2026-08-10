/** 内联 SVG 图标（统一 1.7 描边，DESIGN-SPEC §8.2），供模板与 JS 复用 */
const ICON = (paths: string, size = 18): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icon = {
  upload: ICON('<path d="M12 15V4"/><path d="M7 9l5-5 5 5"/><path d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2"/>', 18),
  image: ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-9 9"/>', 19),
  sliders: ICON('<path d="M21 4h-7M10 4H3"/><path d="M21 12h-9M8 12H3"/><path d="M21 20h-5M12 20H3"/><path d="M14 2v4M8 10v4M16 18v4"/>', 19),
  panel: ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>', 17),
  copy: ICON('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>', 14),
  check: ICON('<path d="M20 6L9 17l-5-5"/>', 14),
  eye: ICON('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>', 16),
  trash: ICON('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M10 11v6M14 11v6"/>', 16),
  x: ICON('<path d="M18 6L6 18M6 6l12 12"/>', 16),
  brand:
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<rect x="3" y="3" width="8" height="8" rx="2" fill="var(--color-accent)"/>' +
    '<rect x="13" y="3" width="8" height="8" rx="2" fill="var(--color-ink3)"/>' +
    '<rect x="3" y="13" width="8" height="8" rx="2" fill="var(--color-ink3)"/>' +
    '<rect x="13" y="13" width="8" height="8" rx="2" fill="none" stroke="var(--color-ink3)"/></svg>',
} as const;

export type IconName = keyof typeof icon;
