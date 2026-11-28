import { nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AdaptiveTint } from '../../src/types';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h / 6) * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(hn + 1 / 3) * 255),
    Math.round(hue2rgb(hn) * 255),
    Math.round(hue2rgb(hn - 1 / 3) * 255)
  ];
}

function toHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Computes a refined, non-neon Apple-grade accent pair (for dark & light glass themes)
 * from a downsampled BGRA bitmap.
 */
function extractRefinedTintFromBgra(buf: Buffer): AdaptiveTint | null {
  if (!buf || buf.length < 16) return null;
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));

  for (let i = 0; i + 3 < buf.length; i += 4) {
    const b = buf[i];
    const g = buf[i + 1];
    const r = buf[i + 2];
    const a = buf[i + 3];
    if (a < 180) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    // Skip near-black, near-white, and muted grays
    if (l < 0.14 || l > 0.88 || s < 0.16) continue;
    const weight = s * (1 - Math.abs(l - 0.52) * 1.15);
    if (weight <= 0.05) continue;
    const idx = Math.floor(((h % 360) + 360) % 360 / 30) % 12;
    buckets[idx].w += weight;
    buckets[idx].r += r * weight;
    buckets[idx].g += g * weight;
    buckets[idx].b += b * weight;
  }

  let best = buckets[0];
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i].w > best.w) best = buckets[i];
  }
  if (best.w < 1.2) return null;

  const avgR = best.r / best.w;
  const avgG = best.g / best.w;
  const avgB = best.b / best.w;
  const [h, s] = rgbToHsl(avgR, avgG, avgB);

  // Rich, jewel-toned saturation (58%-78%) — visibly alive without harsh neon
  const satDark = Math.max(0.58, Math.min(0.78, s * 1.05));
  const satLight = Math.max(0.56, Math.min(0.76, s * 1.02));
  const [dr, dg, db] = hslToRgb(h, satDark, 0.62);
  const [lr, lg, lb] = hslToRgb(h, satLight, 0.43);

  return {
    darkHex: toHex(dr, dg, db),
    lightHex: toHex(lr, lg, lb),
    softDark: `rgba(${dr}, ${dg}, ${db}, 0.22)`,
    softLight: `rgba(${lr}, ${lg}, ${lb}, 0.16)`,
    glowDark: `rgba(${dr}, ${dg}, ${db}, 0.16)`,
    glowLight: `rgba(${lr}, ${lg}, ${lb}, 0.11)`,
    borderDark: `rgba(${dr}, ${dg}, ${db}, 0.28)`,
    borderLight: `rgba(${lr}, ${lg}, ${lb}, 0.24)`
  };
}

let cachedWallpaperSig = '';
let cachedWallpaperTint: AdaptiveTint | null = null;

export function getWallpaperAdaptiveTint(): AdaptiveTint | null {
  const appData = process.env.APPDATA || '';
  const transcoded = path.join(appData, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
  try {
    if (!fs.existsSync(transcoded)) return cachedWallpaperTint;
    const stat = fs.statSync(transcoded);
    const sig = `v2:${stat.size}:${stat.mtimeMs}`;
    if (sig === cachedWallpaperSig) return cachedWallpaperTint;

    const img = nativeImage.createFromPath(transcoded);
    if (img.isEmpty()) return cachedWallpaperTint;
    const tiny = img.resize({ width: 24, height: 24, quality: 'good' });
    cachedWallpaperTint = extractRefinedTintFromBgra(tiny.toBitmap());
    cachedWallpaperSig = sig;
    return cachedWallpaperTint;
  } catch {
    return cachedWallpaperTint;
  }
}
