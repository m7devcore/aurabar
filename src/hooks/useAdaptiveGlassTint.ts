import { useEffect, useState } from 'react';
import { dockBridge } from '../hooks/useDockBridge';
import type { AdaptiveTint, ThemeId } from '../types';

const MEDIA_TINT_STORAGE_KEY = 'glassy.mediaTint.v2';
const artworkTintCache = new Map<string, AdaptiveTint | null>();

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
  const hn = (((h % 360) + 360) % 360) / 360;
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

function extractTintFromRgba(data: Uint8ClampedArray): AdaptiveTint | null {
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 180) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.14 || l > 0.88 || s < 0.16) continue;
    const weight = s * (1 - Math.abs(l - 0.52) * 1.15);
    if (weight <= 0.05) continue;
    const idx = Math.floor((((h % 360) + 360) % 360) / 30) % 12;
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

  const [h, s] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
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

function extractTintFromImageUrl(url: string): Promise<AdaptiveTint | null> {
  if (artworkTintCache.has(url)) {
    return Promise.resolve(artworkTintCache.get(url) ?? null);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, 24, 24);
        const pixels = ctx.getImageData(0, 0, 24, 24).data;
        const tint = extractTintFromRgba(pixels);
        if (artworkTintCache.size > 24) {
          const first = artworkTintCache.keys().next().value;
          if (first !== undefined) artworkTintCache.delete(first);
        }
        artworkTintCache.set(url, tint);
        resolve(tint);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function readStoredMediaTint(): AdaptiveTint | null {
  try {
    const raw = localStorage.getItem(MEDIA_TINT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AdaptiveTint;
  } catch {
    return null;
  }
}

export function publishMediaAdaptiveTint(artworkUrl: string | null): void {
  if (!artworkUrl) {
    try {
      localStorage.removeItem(MEDIA_TINT_STORAGE_KEY);
    } catch {
      // Ignore
    }
    return;
  }
  void extractTintFromImageUrl(artworkUrl).then((tint) => {
    try {
      if (tint) localStorage.setItem(MEDIA_TINT_STORAGE_KEY, JSON.stringify(tint));
      else localStorage.removeItem(MEDIA_TINT_STORAGE_KEY);
    } catch {
      // Ignore
    }
  });
}

/**
 * Applies Living Glass adaptive accent (--accent, --accent-soft, --adaptive-glow)
 * from active album art (preferred) or current desktop wallpaper (fallback).
 */
export function useAdaptiveGlassTint(
  enabled: boolean,
  theme: ThemeId,
  localArtworkUrl?: string | null
): void {
  const [wallpaperTint, setWallpaperTint] = useState<AdaptiveTint | null>(null);
  const [mediaTint, setMediaTint] = useState<AdaptiveTint | null>(() => readStoredMediaTint());

  // Fetch wallpaper tint on mount and refresh gently once a minute
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      void dockBridge.getWallpaperTint().then((tint) => {
        if (alive) setWallpaperTint(tint);
      });
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled]);

  // Extract from local artwork when this window hosts the active media player
  useEffect(() => {
    if (!enabled) return;
    if (localArtworkUrl === undefined) return;
    let alive = true;
    if (!localArtworkUrl) {
      setMediaTint(null);
      publishMediaAdaptiveTint(null);
      return;
    }
    void extractTintFromImageUrl(localArtworkUrl).then((tint) => {
      if (!alive) return;
      setMediaTint(tint);
      try {
        if (tint) localStorage.setItem(MEDIA_TINT_STORAGE_KEY, JSON.stringify(tint));
        else localStorage.removeItem(MEDIA_TINT_STORAGE_KEY);
      } catch {
        // Ignore
      }
    });
    return () => {
      alive = false;
    };
  }, [enabled, localArtworkUrl]);

  // Cross-window sync so Dock, Top Island, and Secondary monitors stay harmonized
  useEffect(() => {
    if (!enabled) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === MEDIA_TINT_STORAGE_KEY) {
        setMediaTint(readStoredMediaTint());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [enabled]);

  // Apply (or clear) CSS custom properties cleanly on :root
  useEffect(() => {
    const root = document.documentElement;
    const active = enabled ? (mediaTint ?? wallpaperTint) : null;
    if (!active) {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
      root.style.removeProperty('--adaptive-glow');
      root.style.removeProperty('--adaptive-border');
      return;
    }
    const isLight = theme === 'frost';
    root.style.setProperty('--accent', isLight ? active.lightHex : active.darkHex);
    root.style.setProperty('--accent-soft', isLight ? active.softLight : active.softDark);
    root.style.setProperty('--adaptive-glow', isLight ? active.glowLight : active.glowDark);
    const rim = isLight ? active.borderLight : active.borderDark;
    if (rim) root.style.setProperty('--adaptive-border', rim);
    else root.style.removeProperty('--adaptive-border');
  }, [enabled, theme, mediaTint, wallpaperTint]);
}
