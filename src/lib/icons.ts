/** 图标 path（统一 stroke 1.7，DESIGN-SPEC §8.2） */
const PATHS = {
  upload: '<path d="M12 15V4"/><path d="M7 9l5-5 5 5"/><path d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-9 9"/>',
  sliders: '<path d="M21 4h-7M10 4H3"/><path d="M21 12h-9M8 12H3"/><path d="M21 20h-5M12 20H3"/><path d="M14 2v4M8 10v4M16 18v4"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  sortAsc: '<path d="M8 20V4M4 8l4-4 4 4M14 6h3M14 12h5M14 18h7"/>',
  sortDesc: '<path d="M8 4v16M4 16l4 4 4-4M14 6h7M14 12h5M14 18h3"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
  file: '<path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h5M8 13h8M8 17h6"/>',
  qr: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/>',
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
  chevron: svg(PATHS.chevron, 14),
  eye: svg(PATHS.eye, 16),
  trash: svg(PATHS.trash, 16),
  x: svg(PATHS.x, 16),
  code: svg(PATHS.code, 18),
  arrow: svg(PATHS.arrow, 15),
  refresh: svg(PATHS.refresh, 17),
  sortAsc: svg(PATHS.sortAsc, 17),
  sortDesc: svg(PATHS.sortDesc, 17),
  github: svg(PATHS.github, 17),
  folder: svg(PATHS.folder, 14),
  file: svg(PATHS.file, 20),
  qr: svg(PATHS.qr, 20),
} as const;
