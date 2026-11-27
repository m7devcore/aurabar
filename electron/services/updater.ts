import { app, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from '../../src/types';

// Updates come from the GitHub Releases of this repo (see "publish" in package.json). Only the
// installed build can update itself; running from source (npm start / dev) does nothing.
const FIRST_CHECK_DELAY_MS = 20_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'upToDate' }
  | { state: 'error' };

let status: UpdateStatus = { state: 'idle' };
let onChange: (s: UpdateStatus) => void = () => undefined;
let beforeInstall: () => Promise<void> = async () => undefined;
let started = false;
let manualCheck = false;
let timer: ReturnType<typeof setInterval> | null = null;

function set(next: UpdateStatus): void {
  status = next;
  onChange(next);
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  if (onClick) n.on('click', onClick);
  n.show();
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function getUpdateInfo(): UpdateInfo {
  const base = { available: app.isPackaged, currentVersion: app.getVersion() };
  switch (status.state) {
    case 'downloading':
      return { ...base, state: 'downloading', version: status.version, percent: status.percent };
    case 'ready':
      return { ...base, state: 'ready', version: status.version };
    default:
      return { ...base, state: status.state };
  }
}

export function isUpdaterAvailable(): boolean {
  return app.isPackaged;
}

export function checkForUpdates(manual = false): void {
  if (!app.isPackaged) return;
  if (status.state === 'checking' || status.state === 'downloading') return;
  manualCheck = manual;
  set({ state: 'checking' });
  autoUpdater.checkForUpdates().catch(() => {
    // The 'error' event normally handled this already; only cover a rejection without one
    if (status.state === 'checking') {
      set({ state: 'error' });
      if (manualCheck) notify('Glassy', "Couldn't check for updates. Try again later.");
      manualCheck = false;
    }
  });
}

/** Closes AuraBar, runs the installer silently and starts the new version. */
export function installUpdateNow(): void {
  if (status.state !== 'ready') return;
  // Let the app put things back first (e.g. show the Windows taskbar again) so the installer
  // closing it can never leave the desktop without a taskbar
  beforeInstall()
    .catch(() => undefined)
    .finally(() => autoUpdater.quitAndInstall(true, true));
}

export function startUpdater(
  listener: (s: UpdateStatus) => void,
  prepareForInstall: () => Promise<void>
): void {
  onChange = listener;
  beforeInstall = prepareForInstall;
  if (started || !app.isPackaged) return;
  started = true;

  autoUpdater.autoDownload = true;
  // The taskbar-replacement shutdown path exits with app.exit(), which skips the quit event
  // this option relies on, so installing is done explicitly through installUpdateNow()
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => {
    set({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => {
    if (status.state === 'downloading') {
      set({ ...status, percent: Math.round(p.percent) });
    }
  });
  autoUpdater.on('update-not-available', () => {
    set({ state: 'upToDate' });
    if (manualCheck) notify('Glassy', `You're on the latest version (${app.getVersion()}).`);
    manualCheck = false;
  });
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', version: info.version });
    manualCheck = false;
    notify(
      'Glassy update ready',
      `Version ${info.version} is downloaded. Click to restart and update.`,
      () => installUpdateNow()
    );
  });
  autoUpdater.on('error', () => {
    // Offline or rate-limited: stay quiet, the next scheduled check tries again
    if (status.state !== 'ready') set({ state: 'error' });
    if (manualCheck) notify('Glassy', "Couldn't check for updates. Try again later.");
    manualCheck = false;
  });

  setTimeout(() => checkForUpdates(false), FIRST_CHECK_DELAY_MS);
  timer = setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
