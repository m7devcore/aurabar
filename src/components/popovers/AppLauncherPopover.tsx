import { useEffect, useRef, useState } from 'react';
import { AppWindow, Download, FolderPlus, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { t } from '../../i18n';
import type { InstalledApp, Language, PinnedApp, RunningWindow } from '../../types';
import { AppIconGlyph } from '../IconMapper';

interface Props {
  lang: Language;
  pinnedApps: PinnedApp[];
  runningWindows: RunningWindow[];
  onSavePinnedApps: (apps: PinnedApp[]) => void;
  onRefreshWindows: () => void;
}

export function AppLauncherPopover({
  lang,
  pinnedApps,
  runningWindows,
  onSavePinnedApps,
  onRefreshWindows
}: Props) {
  const dict = t(lang);
  const [search, setSearch] = useState('');
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [icon, setIcon] = useState('globe');
  const [lazyIcons, setLazyIcons] = useState<Record<string, string>>({});
  const requestedIconsRef = useRef(new Set<string>());

  useEffect(() => {
    void dockBridge
      .getInstalledApps()
      .then(setInstalledApps)
      .finally(() => setLoadingInstalled(false));
  }, []);

  const query = search.trim().toLowerCase();
  const filteredPinned = query
    ? pinnedApps.filter((a) => a.name.toLowerCase().includes(query))
    : pinnedApps;
  const filteredWindows = query
    ? runningWindows.filter(
        (w) =>
          w.title.toLowerCase().includes(query) ||
          w.processName.toLowerCase().includes(query)
      )
    : runningWindows;
  const filteredInstalled = (
    query
      ? installedApps.filter((a) => a.name.toLowerCase().includes(query))
      : installedApps
  ).slice(0, 24);

  // The installed list arrives without icons; fetch them only for the rows on screen
  const visibleIconKey = filteredInstalled
    .filter((a) => !a.iconDataUrl)
    .map((a) => a.target)
    .join('|');
  useEffect(() => {
    const targets = visibleIconKey ? visibleIconKey.split('|') : [];
    for (const target of targets) {
      if (requestedIconsRef.current.has(target)) continue;
      requestedIconsRef.current.add(target);
      // Results are kept even if the filter changed meanwhile; the row may scroll back into view
      void dockBridge.getAppIcon(target).then((url) => {
        if (url) setLazyIcons((prev) => ({ ...prev, [target]: url }));
      });
    }
  }, [visibleIconKey]);
  const iconFor = (app: InstalledApp) => app.iconDataUrl ?? lazyIcons[app.target];

  const isPinnedApp = (tPath: string, exeName?: string) => {
    const check = (p: PinnedApp): boolean =>
      p.target.toLowerCase() === tPath.toLowerCase() ||
      Boolean(exeName && p.exeName?.toLowerCase() === exeName.toLowerCase()) ||
      Boolean(p.children?.some(check));
    return pinnedApps.some(check);
  };

  const removePinnedByMatch = (tPath: string, exeName?: string) => {
    const matches = (p: PinnedApp) =>
      p.target.toLowerCase() === tPath.toLowerCase() ||
      Boolean(exeName && p.exeName?.toLowerCase() === exeName.toLowerCase());

    const next = pinnedApps.flatMap((p) => {
      if (p.kind === 'group') {
        const kids = (p.children ?? []).filter((c) => !matches(c));
        if (kids.length === 0) return [];
        if (kids.length === 1) return [kids[0]];
        return [{ ...p, children: kids }];
      }
      return matches(p) ? [] : [p];
    });
    onSavePinnedApps(next);
  };

  const togglePinInstalled = (app: InstalledApp) => {
    if (isPinnedApp(app.target, app.exeName)) {
      removePinnedByMatch(app.target, app.exeName);
      return;
    }
    const next: PinnedApp = {
      id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: app.name,
      target: app.target,
      kind: 'app',
      icon: 'app',
      color: '#38BDF8',
      iconDataUrl: iconFor(app),
      exeName: app.exeName
    };
    onSavePinnedApps([...pinnedApps, next]);
  };

  const handleBrowse = async () => {
    const picked = await dockBridge.pickAppFile();
    if (!picked) return;
    const next: PinnedApp = {
      id: `app-${Date.now()}`,
      name: picked.name,
      target: picked.path,
      kind: 'app',
      icon: 'app',
      color: '#38BDF8',
      iconDataUrl: picked.iconDataUrl,
      exeName: picked.exeName ?? picked.name.toLowerCase()
    };
    onSavePinnedApps([...pinnedApps, next]);
  };

  const handleImportWinTaskbar = async () => {
    const imported = await dockBridge.importTaskbarApps();
    if (imported.length === 0) return;
    const existingTargets = new Set(pinnedApps.map((p) => p.target.toLowerCase()));
    const fresh = imported.filter((item) => !existingTargets.has(item.target.toLowerCase()));
    if (fresh.length > 0) {
      onSavePinnedApps([...pinnedApps, ...fresh]);
    }
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !target.trim()) return;
    const trimmed = target.trim();
    const isUrl = /^https?:\/\//i.test(trimmed);
    const iconDataUrl = isUrl ? undefined : await dockBridge.getAppIcon(trimmed);
    const next: PinnedApp = {
      id: `app-${Date.now()}`,
      name: name.trim(),
      target: trimmed,
      kind: isUrl ? 'url' : 'app',
      icon,
      color: isUrl ? '#34D399' : '#38BDF8',
      iconDataUrl
    };
    onSavePinnedApps([...pinnedApps, next]);
    setName('');
    setTarget('');
  };

  const pinRunningWindow = (win: RunningWindow) => {
    const launchPath = win.aumid ? `shell:AppsFolder\\${win.aumid}` : win.executablePath;
    if (!launchPath) return;
    if (!win.aumid && win.processName.toLowerCase() === 'applicationframehost') return;
    if (isPinnedApp(launchPath, win.processName)) {
      removePinnedByMatch(launchPath, win.processName);
      return;
    }
    const next: PinnedApp = {
      id: `app-${Date.now()}`,
      name: win.processName,
      target: launchPath,
      kind: 'app',
      icon: 'app',
      color: '#38BDF8',
      iconDataUrl: win.iconDataUrl,
      exeName: win.processName.toLowerCase()
    };
    onSavePinnedApps([...pinnedApps, next]);
  };

  const handleRemove = (id: string) => {
    onSavePinnedApps(pinnedApps.filter((a) => a.id !== id));
  };

  return (
    <div className="stack-md">
      <div className="row-gap">
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)'
            }}
          />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder={
              lang === 'ar'
                ? 'ابحث عن أي برنامج لتثبيته أو فتحه...'
                : 'Search installed apps, pinned, or open windows...'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <button className="btn btn-primary" onClick={() => void handleImportWinTaskbar()}>
          <Download size={14} />
          {dict.importWinApps}
        </button>
        <button className="btn" onClick={() => void handleBrowse()}>
          <FolderPlus size={14} />
          {dict.browseExe}
        </button>
      </div>

      {/* Pinned Apps */}
      <div className="stack-sm">
        <span className="muted-sm">
          {dict.pinnedApps} ({filteredPinned.length}) —{' '}
          {lang === 'ar'
            ? 'أو اسحب أي اختصار للشريط أو اضغط كليك يمين على الأيقونة'
            : 'Drag shortcuts onto the bar or right-click any icon'}
        </span>
        <div className="grid-3">
          {filteredPinned.map((app) => (
            <div key={app.id} className="card row-between" style={{ padding: '7px 10px' }}>
              <button
                className="row-gap"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  minWidth: 0,
                  flex: 1,
                  textAlign: 'start'
                }}
                onClick={() => void dockBridge.launchTarget(app.target)}
              >
                {app.iconDataUrl ? (
                  <img className="app-icon-img" src={app.iconDataUrl} alt={app.name} />
                ) : (
                  <AppIconGlyph name={app.icon} color={app.color} size={16} />
                )}
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {app.name}
                </span>
              </button>
              <button
                className="btn btn-icon"
                style={{ width: 24, height: 24, borderColor: 'transparent' }}
                onClick={() => handleRemove(app.id)}
                title="Unpin"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Installed Windows Apps (1-click Pin / Unpin) */}
      <div className="stack-sm">
        <span className="muted-sm">
          {lang === 'ar'
            ? `التطبيقات المثبتة على جهازك (${installedApps.length})`
            : `Installed Apps (${installedApps.length})`}
        </span>
        {loadingInstalled ? (
          <div className="card muted-sm">{dict.scanningApps}</div>
        ) : (
          <div className="grid-3">
            {filteredInstalled.map((app) => {
              const pinned = isPinnedApp(app.target, app.exeName);
              const appIcon = iconFor(app);
              return (
                <div key={app.target} className="card row-between" style={{ padding: '7px 10px' }}>
                  <button
                    className="row-gap"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: 'pointer',
                      minWidth: 0,
                      flex: 1,
                      textAlign: 'start'
                    }}
                    onClick={() => void dockBridge.launchTarget(app.target)}
                  >
                    {appIcon ? (
                      <img className="app-icon-img" src={appIcon} alt={app.name} />
                    ) : (
                      <AppWindow size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    )}
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {app.name}
                    </span>
                  </button>
                  <button
                    className={`btn btn-icon ${pinned ? 'btn-primary' : ''}`}
                    style={{ width: 25, height: 25 }}
                    onClick={() => togglePinInstalled(app)}
                    title={pinned ? 'Unpin' : 'Pin to Taskbar'}
                  >
                    {pinned ? <PinOff size={12} /> : <Pin size={12} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Running Windows */}
      <div className="stack-sm">
        <div className="row-between">
          <span className="muted-sm">{dict.runningWindows}</span>
          <button
            className="btn"
            style={{ padding: '4px 9px', fontSize: 11.5 }}
            onClick={onRefreshWindows}
          >
            {dict.refresh}
          </button>
        </div>

        {filteredWindows.length === 0 ? (
          <div className="card muted-sm">{dict.noRunningWindows}</div>
        ) : (
          <div className="grid-2">
            {filteredWindows.map((win) => {
              const launchPath = win.aumid ? `shell:AppsFolder\\${win.aumid}` : win.executablePath;
              const pinned = launchPath
                ? isPinnedApp(launchPath, win.processName)
                : false;
              return (
                <div key={win.hwnd ?? win.pid} className="card row-between" style={{ padding: '8px 10px' }}>
                  <button
                    className="row-gap"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'start',
                      color: 'inherit',
                      minWidth: 0,
                      flex: 1
                    }}
                    onClick={() =>
                      void dockBridge.focusWindow(win.pid, win.hwnd).then((ok) => {
                        if (!ok) void dockBridge.openApp(win.pid, win.executablePath);
                      })
                    }
                  >
                    {win.iconDataUrl ? (
                      <img className="app-icon-img" src={win.iconDataUrl} alt={win.processName} />
                    ) : (
                      <AppWindow size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {win.title}
                      </div>
                      <div className="muted-sm" style={{ fontSize: 11 }}>
                        {win.processName}
                      </div>
                    </div>
                  </button>
                  {launchPath && (
                    <button
                      className={`btn btn-icon ${pinned ? 'btn-primary' : ''}`}
                      style={{ width: 26, height: 26 }}
                      onClick={() => pinRunningWindow(win)}
                      title={pinned ? 'Unpin' : 'Pin to Taskbar'}
                    >
                      {pinned ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add URL / Command manually */}
      <form className="row-gap" onSubmit={(e) => void handleAddManual(e)}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Name (e.g. YouTube)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input"
          style={{ flex: 1.6 }}
          placeholder="URL or command (e.g. https://youtube.com)"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <select
          className="select"
          style={{ width: 100 }}
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
        >
          <option value="globe">Web</option>
          <option value="terminal">Terminal</option>
          <option value="code">Code</option>
          <option value="folder">Folder</option>
          <option value="app">App</option>
        </select>
        <button className="btn btn-primary" type="submit">
          <Plus size={14} />
          {dict.addUrl}
        </button>
      </form>
    </div>
  );
}
