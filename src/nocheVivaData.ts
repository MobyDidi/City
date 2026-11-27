export const SOURCE_URLS = {
  day: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261125_123040_f513c6f7-07d8-410f-a6de-4545268d7e1f.png',
  night: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261125_123132_feb5ca9b-fc48-4930-80a0-a8f2fb824330.png',
  facade: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261125_063353_1267b8e6-3e85-4dde-b424-1647f0a4de2e.png',
  band: 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261125_063406_591aa9e3-ad36-4e74-9aa7-01de368920f9.png',
} as const;

const WIDTH_CANDIDATES = [1280, 1600, 1920, 2496] as const;

export function selectProxyWidth(cssWidth: number, dpr: number, cap2048 = false): number {
  const target = cssWidth * Math.min(dpr || 1, 2);
  let chosen: number = WIDTH_CANDIDATES[WIDTH_CANDIDATES.length - 1];
  for (const w of WIDTH_CANDIDATES) {
    if (w >= target) {
      chosen = w;
      break;
    }
  }
  return cap2048 ? Math.min(chosen, 2048) : chosen;
}

export function buildProxyUrl(sourceUrl: string, width: number): string {
  return `https://images.higgs.ai/?default=1&output=webp&url=${encodeURIComponent(sourceUrl)}&q=85&w=${width}`;
}

export interface StreetPieceDef {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  u0: number;
  u1: number;
  meshU0: number;
  meshU1: number;
  side: -1 | 0 | 1;
  drawOrder: number;
}

// Ordered inner -> outer by |midU - 0.5| so outer pieces always draw on top
export const STREET_PIECES: readonly StreetPieceDef[] = [
  { id: 'A', u0: 0, u1: 0.2045, meshU0: -0.09, meshU1: 0.2045, side: -1, drawOrder: 6 },
  { id: 'B', u0: 0.2045, u1: 0.325, meshU0: 0.2045, meshU1: 0.325, side: -1, drawOrder: 4 },
  { id: 'C', u0: 0.325, u1: 0.35, meshU0: 0.325, meshU1: 0.35, side: -1, drawOrder: 2 },
  { id: 'D', u0: 0.35, u1: 0.372, meshU0: 0.35, meshU1: 0.372, side: -1, drawOrder: 1 },
  { id: 'E', u0: 0.372, u1: 0.628, meshU0: 0.372, meshU1: 0.628, side: 0, drawOrder: 0 },
  { id: 'F', u0: 0.628, u1: 0.76, meshU0: 0.628, meshU1: 0.76, side: 1, drawOrder: 3 },
  { id: 'G', u0: 0.76, u1: 0.805, meshU0: 0.76, meshU1: 0.805, side: 1, drawOrder: 5 },
  { id: 'H', u0: 0.805, u1: 1, meshU0: 0.805, meshU1: 1.09, side: 1, drawOrder: 7 },
];

export const DRAW_ORDER_PIECES: readonly StreetPieceDef[] = [...STREET_PIECES].sort(
  (a, b) => a.drawOrder - b.drawOrder,
);

// 30 fps lookup tables measured frame by frame from the reference reel (664 px wide)
export const FACADE_S_LUT: readonly number[] = [
  0, 0, 1, 2, 3, 6, 10, 15, 22, 30, 40, 51, 64, 79, 95, 112, 129, 148,
  166.5, 185, 203.5, 222, 240.5, 259, 277.5, 296, 314.5, 333, 351.5,
].map((v) => v / 664);

export const PIECE_P_LUT: readonly number[] = [
  0, 0.005, 0.012, 0.019, 0.021, 0.03, 0.043, 0.061, 0.082, 0.109,
  0.141, 0.176, 0.216, 0.261, 0.308, 0.358, 0.41, 0.464, 0.518, 0.573,
  0.626, 0.678, 0.727, 0.773, 0.814, 0.852, 0.885, 0.915, 0.938, 0.958,
  0.972, 0.983, 0.992, 0.996, 0.999, 1,
];

// Frame 113..136
export const NIGHT_AMOUNT_LUT: readonly number[] = [
  0, 0.02, 0.04, 0.05, 0.07, 0.09, 0.11, 0.14, 0.18, 0.21, 0.26, 0.3,
  0.36, 0.41, 0.48, 0.54, 0.6, 0.67, 0.74, 0.79, 0.85, 0.91, 0.98, 1,
];

// Frame 116..147 (÷ 139.75)
export const PAN_LUT: readonly number[] = [
  0, 0.25, 0.5, 1.25, 2.5, 4.25, 6.5, 9.5, 13.25, 17.5, 22.5, 28.25,
  34.25, 40.75, 47.75, 55.25, 62.75, 70.5, 78.5, 86.5, 94.25, 101.5,
  108.5, 114.75, 120.75, 125.75, 130.25, 133.75, 136.5, 138.5, 139.5, 139.75,
].map((v) => v / 139.75);

// Frame 137..148 (fraction of H)
export const LEDGE_TOP_LUT: readonly number[] = [
  1.02, 0.978, 0.95, 0.921, 0.895, 0.871, 0.851, 0.834, 0.818, 0.807, 0.801, 0.799,
];

export function sampleLut(lut: readonly number[], indexFloat: number): number {
  if (indexFloat <= 0) return lut[0];
  const last = lut.length - 1;
  if (indexFloat >= last) return lut[last];
  const i = Math.floor(indexFloat);
  const f = indexFloat - i;
  return lut[i] + (lut[i + 1] - lut[i]) * f;
}

export interface HeroGeometry {
  W: number;
  H: number;
  ph: number;
  pw: number;
  px: number;
  fw: number;
  fh: number;
  gap: number;
  bandHeight: number;
  titleFontSize: number;
  titleTop: number;
  travels: Record<StreetPieceDef['id'], number>;
  leads: Record<StreetPieceDef['id'], number>;
}

export function computeHeroGeometry(W: number, H: number): HeroGeometry {
  const ph = Math.max(W / 1.506, 1.26 * H);
  const pw = 1.506 * ph;
  const px = (W - pw) / 2;

  const fw = Math.max(W, 1.5 * H);
  const fh = fw / 1.5;
  const gap = (8.5 / 664) * W;

  const bandHeight = (1 - 0.799 + 0.03) * H;
  const titleFontSize = Math.min(0.118 * H, 0.105 * W);
  const titleTop = (1 - 0.799) * H * 0.56 - titleFontSize / 2;

  const travels = {} as Record<StreetPieceDef['id'], number>;
  const leads = {} as Record<StreetPieceDef['id'], number>;

  for (const piece of STREET_PIECES) {
    if (piece.side === 0) {
      travels[piece.id] = 0;
      leads[piece.id] = 0;
      continue;
    }
    const rawX0 = px + piece.u0 * pw;
    const rawX1 = px + piece.u1 * pw;
    const visX0 = Math.max(0, Math.min(W, rawX0));
    const visX1 = Math.max(0, Math.min(W, rawX1));
    const c = (visX0 + visX1) / (2 * W);
    const travel = 0.93 * Math.abs(c - 0.5) * W;
    travels[piece.id] = travel;
    leads[piece.id] = Math.max(0, 0.25 * (0.41 - travel / W));
  }

  return {
    W,
    H,
    ph,
    pw,
    px,
    fw,
    fh,
    gap,
    bandHeight,
    titleFontSize,
    titleTop,
    travels,
    leads,
  };
}
