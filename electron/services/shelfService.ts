import { app, dialog, nativeImage, shell } from 'electron';
import type { BrowserWindow, WebContents } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ShelfItem } from '../../src/types';
import { getIconDataUrl } from './windowsManager';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico']);
const MAX_THUMB_BYTES = 18 * 1024 * 1024;
const MAX_BLOB_BYTES = 15 * 1024 * 1024;

function getShelfTempDir(): string {
  const dir = path.join(os.tmpdir(), 'GlassyShelf');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore
  }
  return dir;
}

function sanitizeFileName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function buildFallbackDragIcon(): Electron.NativeImage {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
      <rect x="6" y="4" width="36" height="40" rx="8" fill="#1C1C20" stroke="#4CB3F0" stroke-width="2"/>
      <path d="M16 20h16M16 27h16M16 34h10" stroke="#E8E8EE" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
  `.trim();
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

let cachedFallbackDragIcon: Electron.NativeImage | null = null;

function getFallbackDragIcon(): Electron.NativeImage {
  if (!cachedFallbackDragIcon || cachedFallbackDragIcon.isEmpty()) {
    cachedFallbackDragIcon = buildFallbackDragIcon();
  }
  return cachedFallbackDragIcon;
}

async function resolvePreviewDataUrl(filePath: string, isImage: boolean, size: number): Promise<string | undefined> {
  if (isImage && size > 0 && size <= MAX_THUMB_BYTES) {
    try {
      const img = nativeImage.createFromPath(filePath);
      if (!img.isEmpty()) {
        const sz = img.getSize();
        const resized =
          sz.width > 96 || sz.height > 96
            ? img.resize(sz.width >= sz.height ? { width: 96 } : { height: 96 })
            : img;
        return resized.toDataURL();
      }
    } catch {
      // Fall through to file icon
    }
  }
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' });
    if (!icon.isEmpty()) return icon.toDataURL();
  } catch {
    // Fall through to Win32Bridge icon extraction
  }
  return getIconDataUrl(filePath);
}

export async function inspectShelfPaths(paths: string[]): Promise<ShelfItem[]> {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const seen = new Set<string>();
  const results: ShelfItem[] = [];

  for (const raw of paths.slice(0, 24)) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const stat = fs.statSync(trimmed);
      const isDir = stat.isDirectory();
      const name = path.basename(trimmed) || trimmed;
      const ext = isDir ? '' : path.extname(name).toLowerCase();
      const isImage = !isDir && IMAGE_EXTS.has(ext);
      const size = isDir ? 0 : stat.size;
      const previewDataUrl = await resolvePreviewDataUrl(trimmed, isImage, size);
      results.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        path: trimmed,
        name,
        ext,
        size,
        isDir,
        isImage,
        previewDataUrl
      });
    } catch {
      // File missing or inaccessible — skip silently
    }
  }

  return results;
}

export async function saveShelfBlob(
  name: string,
  base64Data: string,
  kind: 'file' | 'text' = 'file'
): Promise<ShelfItem | null> {
  if (typeof base64Data !== 'string' || !base64Data) return null;
  try {
    const buf = kind === 'text' ? Buffer.from(base64Data, 'utf-8') : Buffer.from(base64Data, 'base64');
    if (buf.length === 0 || buf.length > MAX_BLOB_BYTES) return null;

    const dir = getShelfTempDir();
    const safe = sanitizeFileName(name, kind === 'text' ? 'snippet.txt' : 'dropped-item.bin');
    const parsed = path.parse(safe);
    let target = path.join(dir, safe);
    let idx = 1;
    while (fs.existsSync(target) && idx < 99) {
      target = path.join(dir, `${parsed.name}-${idx}${parsed.ext}`);
      idx += 1;
    }
    fs.writeFileSync(target, buf);
    const items = await inspectShelfPaths([target]);
    return items[0] ?? null;
  } catch {
    return null;
  }
}

export async function pickShelfFiles(parent: BrowserWindow | null): Promise<ShelfItem[]> {
  const opts: Electron.OpenDialogOptions = {
    title: 'Add files to Glassy Tray',
    properties: ['openFile', 'multiSelections']
  };
  const res = parent && !parent.isDestroyed() ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || res.filePaths.length === 0) return [];
  return inspectShelfPaths(res.filePaths);
}

export function startNativeShelfDrag(
  sender: WebContents,
  filePaths: string[],
  iconDataUrl?: string
): void {
  const existing = (Array.isArray(filePaths) ? filePaths : [])
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0 && fs.existsSync(p));
  if (existing.length === 0) return;

  let dragIcon = getFallbackDragIcon();
  if (typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:image/')) {
    try {
      const parsed = nativeImage.createFromDataURL(iconDataUrl);
      if (!parsed.isEmpty()) {
        const sz = parsed.getSize();
        dragIcon = sz.width > 48 || sz.height > 48 ? parsed.resize({ width: 48 }) : parsed;
      }
    } catch {
      // Keep fallback icon
    }
  }
  if (dragIcon.isEmpty()) {
    dragIcon = getFallbackDragIcon();
  }

  try {
    sender.startDrag({
      file: existing[0],
      files: existing,
      icon: dragIcon
    });
  } catch {
    // Ignore canceled or rejected OS drag
  }
}

export async function openShelfItem(filePath: string): Promise<boolean> {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const err = await shell.openPath(filePath);
  return err === '';
}

export function revealShelfItem(filePath: string): boolean {
  if (!filePath || !fs.existsSync(filePath)) return false;
  shell.showItemInFolder(filePath);
  return true;
}
