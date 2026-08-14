/** 图标 path（统一 stroke 1.7，DESIGN-SPEC §8.2） */
const PATHS = {
  upload: '<path d="M12 15V4"/><path d="M7 9l5-5 5 5"/><path d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-9 9"/>',
  sliders: '<path d="M21 4h-7M10 4H3"/><path d="M21 12h-9M8 12H3"/><path d="M21 20h-5M12 20H3"/><path d="M14 2v4M8 10v4M16 18v4"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
} as const;

const svg = (paths: string, size = 18): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** 图标（innerHTML 模板场景用） */
export const icon = {
  upload: svg(PATHS.upload, 18),
  image: svg(PATHS.image, 19),
  sliders: svg(PATHS.sliders, 19),
  panel: svg(PATHS.panel, 17),
  copy: svg(PATHS.copy, 14),
  check: svg(PATHS.check, 14),
  eye: svg(PATHS.eye, 16),
  trash: svg(PATHS.trash, 16),
  x: svg(PATHS.x, 16),
  code: svg(PATHS.code, 18),
  arrow: svg(PATHS.arrow, 15),
} as const;
