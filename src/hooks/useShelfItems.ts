import { useCallback, useEffect, useState } from 'react';
import { dockBridge } from './useDockBridge';
import type { ShelfItem } from '../types';

export const SHELF_STORAGE_KEY = 'glassy.shelfPaths';
export const MAX_SHELF_ITEMS = 16;

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : '');
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function loadSavedShelfPaths(): string[] {
  try {
    const raw = localStorage.getItem(SHELF_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function persistShelfPaths(items: ShelfItem[]): void {
  try {
    localStorage.setItem(SHELF_STORAGE_KEY, JSON.stringify(items.map((item) => item.path)));
  } catch {
    // Ignore storage quota issues
  }
}

export function useShelfItems(enabled: boolean) {
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>([]);

  const hydrateFromStorage = useCallback(async () => {
    const saved = loadSavedShelfPaths();
    if (saved.length === 0) {
      setShelfItems([]);
      return;
    }
    const items = await dockBridge.inspectShelfPaths(saved);
    const trimmed = items.slice(0, MAX_SHELF_ITEMS);
    setShelfItems(trimmed);
    persistShelfPaths(trimmed);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const saved = loadSavedShelfPaths();
    if (saved.length > 0) {
      void dockBridge.inspectShelfPaths(saved).then((items) => {
        if (!alive) return;
        const trimmed = items.slice(0, MAX_SHELF_ITEMS);
        setShelfItems(trimmed);
        persistShelfPaths(trimmed);
      });
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === SHELF_STORAGE_KEY) {
        void hydrateFromStorage();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      alive = false;
      window.removeEventListener('storage', onStorage);
    };
  }, [enabled, hydrateFromStorage]);

  const mergeShelfItems = useCallback((incoming: ShelfItem[]) => {
    if (incoming.length === 0) return;
    setShelfItems((prev) => {
      const map = new Map<string, ShelfItem>();
      for (const item of incoming) map.set(item.path.toLowerCase(), item);
      for (const item of prev) {
        const key = item.path.toLowerCase();
        if (!map.has(key)) map.set(key, item);
      }
      const next = Array.from(map.values()).slice(0, MAX_SHELF_ITEMS);
      persistShelfPaths(next);
      return next;
    });
  }, []);

  const removeShelfItem = useCallback((itemPath: string) => {
    setShelfItems((prev) => {
      const next = prev.filter((item) => item.path !== itemPath);
      persistShelfPaths(next);
      return next;
    });
  }, []);

  const clearShelf = useCallback(() => {
    setShelfItems([]);
    persistShelfPaths([]);
  }, []);

  const addFilesViaPicker = useCallback(async () => {
    const picked = await dockBridge.pickShelfFiles();
    mergeShelfItems(picked);
    return picked.length;
  }, [mergeShelfItems]);

  const ingestDataTransfer = useCallback(
    async (dt: DataTransfer): Promise<number> => {
      const files = Array.from(dt.files ?? []);
      const localPaths: string[] = [];
      const blobFiles: File[] = [];

      for (const f of files) {
        const p = dockBridge.getPathForFile(f);
        if (p) localPaths.push(p);
        else blobFiles.push(f);
      }

      const added: ShelfItem[] = [];
      if (localPaths.length > 0) {
        const inspected = await dockBridge.inspectShelfPaths(localPaths);
        added.push(...inspected);
      }
      for (const f of blobFiles.slice(0, 6)) {
        const b64 = await readFileAsBase64(f);
        if (b64) {
          const saved = await dockBridge.saveShelfBlob(f.name || 'image.png', b64, 'file');
          if (saved) added.push(saved);
        }
      }
      if (files.length === 0) {
        const text = dt.getData('text/plain')?.trim();
        if (text) {
          const previewTitle = text.slice(0, 28).replace(/\s+/g, ' ');
          const saved = await dockBridge.saveShelfBlob(
            `${previewTitle || 'snippet'}.txt`,
            text,
            'text'
          );
          if (saved) added.push(saved);
        }
      }
      if (added.length > 0) {
        mergeShelfItems(added);
      }
      return added.length;
    },
    [mergeShelfItems]
  );

  return {
    shelfItems,
    mergeShelfItems,
    removeShelfItem,
    clearShelf,
    addFilesViaPicker,
    ingestDataTransfer
  };
}
