using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace AuraBarNative {
  public class Win32Bridge {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
      public int left, top, right, bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
      public int X, Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT {
      public int length;
      public int flags;
      public int showCmd;
      public POINT ptMinPosition;
      public POINT ptMaxPosition;
      public RECT rcNormalPosition;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct APPBARDATA {
      public int cbSize;
      public IntPtr hWnd;
      public uint uCallbackMessage;
      public uint uEdge;
      public RECT rc;
      public IntPtr lParam;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct SHFILEINFO {
      public IntPtr hIcon;
      public int iIcon;
      public uint dwAttributes;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
      public string szDisplayName;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
      public string szTypeName;
    }

    [DllImport("shell32.dll")]
    private static extern uint SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref RECT pvParam, uint fWinIni);

    [DllImport("user32.dll")]
    private static extern bool IsZoomed(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")]
    private static extern IntPtr GetClassLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int dwProcessId);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(IntPtr hProcess, int dwFlags, StringBuilder lpExeName, ref int lpdwSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetApplicationUserModelId(IntPtr hProcess, ref uint applicationUserModelIdLength, StringBuilder applicationUserModelId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(uint idThread);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")]
    private static extern int DwmGetWindowRect(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    private static extern bool IsHungAppWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorComObject { }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
      int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
      int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
      int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    }

    [ComImport]
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume {
      int RegisterControlChangeNotify(IntPtr pNotify);
      int UnregisterControlChangeNotify(IntPtr pNotify);
      int GetChannelCount(out uint pnChannelCount);
      int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
      int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
      int GetMasterVolumeLevel(out float pfLevelDB);
      int GetMasterVolumeLevelScalar(out float pfLevel);
      int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
      int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
      int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
      int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
      int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
      int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
    }

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_APPWINDOW = 0x00040000;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TOPMOST = 0x00000008;
    private const uint WM_CLOSE = 0x0010;
    private const uint GW_HWNDPREV = 3;
    private const uint GW_OWNER = 4;
    private const int DWMWA_CLOAKED = 14;
    private const uint PROCESS_TERMINATE = 0x0001;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    private static IntPtr lastExternalForeground = IntPtr.Zero;
    private static IntPtr dockHwnd = IntPtr.Zero;
    private static IntPtr islandHwnd = IntPtr.Zero;
    private static RECT dockTargetRect = new RECT();
    private static bool hasDockTargetRect = false;
    private static int parentElectronPid = 0;
    private static long nextSeenSeq = 1;
    private static readonly Dictionary<long, long> firstSeenMap = new Dictionary<long, long>();
    private static readonly HashSet<long> maximizedHwnds = new HashSet<long>();
    private static readonly Dictionary<uint, ProcMeta> procCache = new Dictionary<uint, ProcMeta>();
    private static readonly Dictionary<string, int> subsystemCache = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, string> descCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private static readonly object procCacheLock = new object();
    private static volatile bool keepOnTop = true;
    private static string replyPrefix = "";
    private static bool taskbarHiddenByUs = false;
    private static int savedScreenLeft = 0;
    private static int savedScreenRight = 1920;
    private static int savedScreenBottom = 1080;

    private struct WinEntry {
      public long seq;
      public string json;
    }

    private struct ProcMeta {
      public string name;
      public string exePath;
      public bool isElectron;
    }

    private static string JsonEscape(string s) {
      if (string.IsNullOrEmpty(s)) return "";
      StringBuilder sb = new StringBuilder(s.Length + 8);
      for (int i = 0; i < s.Length; i++) {
        char c = s[i];
        if (c == '\\') sb.Append("\\\\");
        else if (c == '"') sb.Append("\\\"");
        else if (c == '\r') sb.Append("\\r");
        else if (c == '\n') sb.Append("\\n");
        else if (c == '\t') sb.Append("\\t");
        else if (c < 32) sb.Append(' ');
        else sb.Append(c);
      }
      return sb.ToString();
    }

    // procCache is shared by the command loop and PollForegroundLoop; Dictionary is not
    // thread-safe and concurrent writes can corrupt it into an infinite loop.
    private static ProcMeta GetProcMeta(uint pid) {
      ProcMeta cached;
      lock (procCacheLock) {
        if (procCache.TryGetValue(pid, out cached)) return cached;
      }

      ProcMeta meta = QueryProcMeta(pid);
      if (!string.IsNullOrEmpty(meta.name)) {
        lock (procCacheLock) {
          if (procCache.Count > 200) procCache.Clear();
          procCache[pid] = meta;
        }
      }
      return meta;
    }

    // Uncached lookup for destructive paths: a cached entry can be stale after PID reuse
    private static ProcMeta QueryProcMeta(uint pid) {
      string exePath = "";
      string procName = "";
      IntPtr hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (int)pid);
      if (hProc != IntPtr.Zero) {
        try {
          StringBuilder sb = new StringBuilder(512);
          int sz = sb.Capacity;
          if (QueryFullProcessImageName(hProc, 0, sb, ref sz)) {
            exePath = sb.ToString();
            procName = Path.GetFileNameWithoutExtension(exePath);
          }
        } finally {
          CloseHandle(hProc);
        }
      }

      if (string.IsNullOrEmpty(procName)) {
        try {
          Process p = Process.GetProcessById((int)pid);
          procName = p.ProcessName;
        } catch { }
      }

      return new ProcMeta {
        name = procName,
        exePath = exePath,
        isElectron = procName.Equals("electron", StringComparison.OrdinalIgnoreCase)
      };
    }

    private static bool IsCloaked(IntPtr hWnd) {
      int cloaked = 0;
      int hr = DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, sizeof(int));
      return hr == 0 && cloaked != 0;
    }

    private static bool IsAuraBarWindow(uint pid, IntPtr hWnd) {
      if (hWnd != IntPtr.Zero && (hWnd == dockHwnd || hWnd == islandHwnd)) return true;
      if (parentElectronPid > 0 && pid == (uint)parentElectronPid) return true;
      return GetProcMeta(pid).isElectron;
    }

    private static void KeepOnTopIfDemoted(IntPtr hWnd) {
      if (!keepOnTop) return;
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd) || !IsWindowVisible(hWnd)) return;
      int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
      bool needTopmost = (exStyle & WS_EX_TOPMOST) == 0;

      if (!needTopmost) {
        IntPtr prev = GetWindow(hWnd, GW_HWNDPREV);
        int steps = 0;
        while (prev != IntPtr.Zero && steps < 6) {
          if (prev != dockHwnd && prev != islandHwnd && IsWindowVisible(prev)) {
            uint pPid;
            GetWindowThreadProcessId(prev, out pPid);
            if (!IsAuraBarWindow(pPid, prev)) {
              int pEx = GetWindowLong(prev, GWL_EXSTYLE);
              // Ignore genuine tool/system overlays; promote if any normal app window sits above us
              if ((pEx & WS_EX_TOPMOST) == 0) {
                needTopmost = true;
                break;
              }
              StringBuilder cls = new StringBuilder(64);
              GetClassName(prev, cls, cls.Capacity);
              string clsName = cls.ToString();
              if (clsName == "Chrome_WidgetWin_1") {
                needTopmost = true;
                break;
              }
            }
          }
          prev = GetWindow(prev, GW_HWNDPREV);
          steps++;
        }
      }

      if (needTopmost) {
        SetWindowPos(hWnd, new IntPtr(-1), 0, 0, 0, 0, 0x0013 | 0x4000); // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS
      }
    }

    private static void PollForegroundLoop() {
      while (true) {
        try {
          if (taskbarHiddenByUs) {
            IntPtr tray = FindWindow("Shell_TrayWnd", null);
            if (tray != IntPtr.Zero && IsWindowVisible(tray)) {
              ShowWindowAsync(tray, 0);
            }
            IntPtr sec = FindWindow("Shell_SecondaryTrayWnd", null);
            if (sec != IntPtr.Zero && IsWindowVisible(sec)) {
              ShowWindowAsync(sec, 0);
            }
          }

          KeepOnTopIfDemoted(dockHwnd);
          KeepOnTopIfDemoted(islandHwnd);

          IntPtr fg = GetForegroundWindow();
          if (fg != IntPtr.Zero) {
            uint pid;
            GetWindowThreadProcessId(fg, out pid);
            if (!IsAuraBarWindow(pid, fg) && IsTaskbarWindow(fg)) {
              if (fg != lastExternalForeground) {
                lastExternalForeground = fg;
              }
            } else if (lastExternalForeground != IntPtr.Zero &&
                       (!IsWindow(lastExternalForeground) || IsIconic(lastExternalForeground))) {
              lastExternalForeground = IntPtr.Zero;
            }
          }
        } catch { }
        Thread.Sleep(140);
      }
    }

    private static bool IsTaskbarWindow(IntPtr hWnd) {
      if (!IsWindowVisible(hWnd)) return false;
      int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
      if ((exStyle & WS_EX_NOACTIVATE) != 0) return false;
      bool isAppWin = (exStyle & WS_EX_APPWINDOW) != 0;
      if ((exStyle & WS_EX_TOOLWINDOW) != 0 && !isAppWin) return false;
      if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero && !isAppWin) return false;
      if (IsCloaked(hWnd)) return false;

      int len = GetWindowTextLength(hWnd);
      if (len <= 0) return false;

      StringBuilder cls = new StringBuilder(64);
      GetClassName(hWnd, cls, cls.Capacity);
      string clsName = cls.ToString();
      if (clsName == "Progman" || clsName == "WorkerW" || clsName == "Shell_TrayWnd" || clsName == "Windows.UI.Core.CoreWindow") {
        return false;
      }
      return true;
    }

    private static string ListWindowsJson() {
      List<WinEntry> entries = new List<WinEntry>();
      HashSet<long> aliveHwnds = new HashSet<long>();
      IntPtr activeHwnd = lastExternalForeground;
      IntPtr currentFg = GetForegroundWindow();
      if (currentFg != IntPtr.Zero) {
        uint fgPid;
        GetWindowThreadProcessId(currentFg, out fgPid);
        if (!IsAuraBarWindow(fgPid, currentFg)) {
          activeHwnd = currentFg;
        }
      }

      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        if (!IsTaskbarWindow(hWnd)) return true;

        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (IsAuraBarWindow(pid, hWnd)) return true;

        int len = GetWindowTextLength(hWnd);
        StringBuilder sb = new StringBuilder(len + 1);
        GetWindowText(hWnd, sb, sb.Capacity);
        string title = sb.ToString();
        if (string.IsNullOrEmpty(title)) return true;

        ProcMeta meta = GetProcMeta(pid);
        if (meta.name.Equals("TextInputHost", StringComparison.OrdinalIgnoreCase)) return true;

        long hwndNum = hWnd.ToInt64();
        aliveHwnds.Add(hwndNum);
        long seq;
        if (!firstSeenMap.TryGetValue(hwndNum, out seq)) {
          seq = nextSeenSeq++;
          firstSeenMap[hwndNum] = seq;
        }

        bool isMin = IsIconic(hWnd);
        bool isAct = (hWnd == activeHwnd) && !isMin;

        string json = string.Format(
          "{{\"hwnd\":\"{0}\",\"pid\":{1},\"processName\":\"{2}\",\"title\":\"{3}\",\"executablePath\":\"{4}\",\"isMinimized\":{5},\"isActive\":{6}}}",
          hwndNum,
          pid,
          JsonEscape(meta.name),
          JsonEscape(title),
          JsonEscape(meta.exePath),
          isMin ? "true" : "false",
          isAct ? "true" : "false"
        );
        entries.Add(new WinEntry { seq = seq, json = json });
        return true;
      }, IntPtr.Zero);

      List<long> stale = new List<long>();
      foreach (long k in firstSeenMap.Keys) {
        if (!aliveHwnds.Contains(k)) stale.Add(k);
      }
      for (int i = 0; i < stale.Count; i++) {
        firstSeenMap.Remove(stale[i]);
        maximizedHwnds.Remove(stale[i]);
      }

      entries.Sort(delegate(WinEntry a, WinEntry b) { return a.seq.CompareTo(b.seq); });
      if (entries.Count > 24) entries.RemoveRange(24, entries.Count - 24);

      string[] jsonArr = new string[entries.Count];
      for (int i = 0; i < entries.Count; i++) jsonArr[i] = entries[i].json;
      return "[" + string.Join(",", jsonArr) + "]";
    }

    private static void ForceFocus(IntPtr hWnd) {
      long hwndKey = hWnd.ToInt64();
      // Preserve exact prior state: ONLY restore if genuinely minimized (never touch non-minimized bounds)
      if (IsIconic(hWnd)) {
        WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
        wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
        bool wasMax = maximizedHwnds.Contains(hwndKey);
        if (GetWindowPlacement(hWnd, ref wp)) {
          if ((wp.flags & 0x0002) != 0 || wp.showCmd == 3) {
            wasMax = true;
          }
        }
        ShowWindowAsync(hWnd, wasMax ? 3 : 9); // SW_SHOWMAXIMIZED : SW_RESTORE (exact snapped/normal rect)
        maximizedHwnds.Remove(hwndKey);
      }

      AllowSetForegroundWindow(-1);
      if (GetForegroundWindow() == hWnd) return;

      BringWindowToTop(hWnd);
      if (SetForegroundWindow(hWnd)) return;

      // Attach only to current foreground thread (typically our own responsive dockWindow) to unlock SetForegroundWindow
      IntPtr fg = GetForegroundWindow();
      uint dummy;
      uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;
      uint curThread = GetCurrentThreadId();
      bool attachedFg = false;

      if (fgThread != 0 && fgThread != curThread) {
        attachedFg = AttachThreadInput(curThread, fgThread, true);
      }
      BringWindowToTop(hWnd);
      bool focused = SetForegroundWindow(hWnd);
      if (attachedFg) {
        AttachThreadInput(curThread, fgThread, false);
      }

      if (!focused && GetForegroundWindow() != hWnd) {
        uint targetThread = GetWindowThreadProcessId(hWnd, out dummy);
        bool attachedTarget = targetThread != 0 && targetThread != curThread
          ? AttachThreadInput(curThread, targetThread, true)
          : false;
        BringWindowToTop(hWnd);
        SetForegroundWindow(hWnd);
        if (attachedTarget) {
          AttachThreadInput(curThread, targetThread, false);
        }
      }
    }

    private static string ToggleWindow(long hwndVal) {
      IntPtr hWnd = new IntPtr(hwndVal);
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return "false";

      IntPtr fg = GetForegroundWindow();
      bool dockHasFocus = fg == IntPtr.Zero || fg == dockHwnd || fg == islandHwnd;
      bool isTargetActive =
        !IsIconic(hWnd) &&
        (fg == hWnd || (dockHasFocus && hWnd == lastExternalForeground));

      if (isTargetActive) {
        if (IsZoomed(hWnd)) {
          maximizedHwnds.Add(hwndVal);
        } else {
          WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
          wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
          if (GetWindowPlacement(hWnd, ref wp) && wp.showCmd == 3) {
            maximizedHwnds.Add(hwndVal);
          } else {
            maximizedHwnds.Remove(hwndVal);
          }
        }
        ShowWindowAsync(hWnd, 6); // SW_MINIMIZE
        if (lastExternalForeground == hWnd) {
          lastExternalForeground = IntPtr.Zero;
        }
        return "minimized";
      } else {
        ForceFocus(hWnd);
        lastExternalForeground = hWnd;
        return "focused";
      }
    }

    private static string CloseWindowByHwnd(long hwndVal) {
      IntPtr hWnd = new IntPtr(hwndVal);
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return "false";
      bool sent = PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
      if (sent && lastExternalForeground == hWnd) {
        lastExternalForeground = IntPtr.Zero;
      }
      return sent ? "ok" : "false";
    }

    private static int GetPESubsystem(string exePath) {
      int cached;
      if (subsystemCache.TryGetValue(exePath, out cached)) return cached;
      int result = 0;
      try {
        using (FileStream fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        using (BinaryReader br = new BinaryReader(fs)) {
          if (fs.Length >= 0x100) {
            fs.Position = 0x3C;
            int peOffset = br.ReadInt32();
            if (peOffset >= 0 && peOffset + 94 <= fs.Length) {
              fs.Position = peOffset + 24 + 68;
              result = br.ReadUInt16();
            }
          }
        }
      } catch {
        result = 0;
      }
      if (subsystemCache.Count > 250) subsystemCache.Clear();
      subsystemCache[exePath] = result;
      return result;
    }

    private static string GetExeDisplayName(string exePath, string fallbackName) {
      string cached;
      if (descCache.TryGetValue(exePath, out cached)) return cached;
      string displayName = fallbackName;
      try {
        FileVersionInfo fvi = FileVersionInfo.GetVersionInfo(exePath);
        if (!string.IsNullOrWhiteSpace(fvi.FileDescription)) {
          displayName = fvi.FileDescription.Trim();
        } else if (!string.IsNullOrWhiteSpace(fvi.ProductName)) {
          displayName = fvi.ProductName.Trim();
        }
      } catch { }
      if (descCache.Count > 250) descCache.Clear();
      descCache[exePath] = displayName;
      return displayName;
    }

    private static bool IsExcludedBackgroundExe(string procName, string exePath) {
      if (string.IsNullOrEmpty(exePath)) return true;
      string lowerPath = exePath.ToLowerInvariant();
      string lowerName = procName.ToLowerInvariant();
      if (lowerPath.StartsWith("c:\\windows\\") || lowerPath.StartsWith("c:\\windows/")) return true;
      if (lowerPath.Contains("\\.vscode\\extensions\\") || lowerPath.Contains("\\node_modules\\")) return true;
      string[] blocked = new string[] {
        "aurabar", "win32bridge", "electron", "crashhandler", "crashpad", "msedgewebview2",
        "webview", "elevation_service", "widgetservice", "widgetboard", "crossdeviceservice",
        "startfeedprovider", "nvcontainer", "amdrsserv", "amdrssrcext", "amdow", "cncmd",
        "lghub_agent", "omencommandcenterbackground", "securityhealthservice", "openconsole",
        "extension-host", "node_repl", "updater", "spotify_migrator", "spotifylauncher",
        "helper", "installmonitor"
      };
      for (int i = 0; i < blocked.Length; i++) {
        if (lowerName.Contains(blocked[i])) return true;
      }
      return false;
    }

    private static string ListBackgroundAppsJson() {
      HashSet<string> taskbarExePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        if (!IsTaskbarWindow(hWnd)) return true;
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid == 0 || IsAuraBarWindow(pid, hWnd)) return true;
        ProcMeta meta = GetProcMeta(pid);
        if (!string.IsNullOrEmpty(meta.exePath)) {
          taskbarExePaths.Add(meta.exePath);
        }
        return true;
      }, IntPtr.Zero);

      int mySession = Process.GetCurrentProcess().SessionId;
      Dictionary<string, string> byExe = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

      Process[] procs = Process.GetProcesses();
      for (int i = 0; i < procs.Length; i++) {
        Process p = procs[i];
        try {
          if (p.SessionId != mySession) continue;
          uint pid = (uint)p.Id;
          ProcMeta meta = GetProcMeta(pid);
          if (IsAuraBarWindow(pid, IntPtr.Zero)) continue;
          if (IsExcludedBackgroundExe(meta.name, meta.exePath)) continue;
          if (taskbarExePaths.Contains(meta.exePath)) continue;
          if (byExe.ContainsKey(meta.exePath)) continue;
          if (GetPESubsystem(meta.exePath) != 2) continue;

          string displayName = GetExeDisplayName(meta.exePath, meta.name);

          byExe[meta.exePath] = string.Format(
            "{{\"pid\":{0},\"processName\":\"{1}\",\"displayName\":\"{2}\",\"executablePath\":\"{3}\"}}",
            pid,
            JsonEscape(meta.name),
            JsonEscape(displayName),
            JsonEscape(meta.exePath)
          );
          if (byExe.Count >= 24) break;
        } catch {
        } finally {
          p.Dispose();
        }
      }

      string[] arr = new string[byExe.Count];
      byExe.Values.CopyTo(arr, 0);
      return "[" + string.Join(",", arr) + "]";
    }

    private static HashSet<uint> CollectMatchingPids(int seedPid, out ProcMeta targetMeta) {
      targetMeta = QueryProcMeta((uint)seedPid);
      HashSet<uint> pids = new HashSet<uint>();
      if (seedPid > 4 && !IsAuraBarWindow((uint)seedPid, IntPtr.Zero)) {
        pids.Add((uint)seedPid);
      }

      string targetExe = targetMeta.exePath;
      Process[] procs = Process.GetProcesses();
      for (int i = 0; i < procs.Length; i++) {
        Process p = procs[i];
        try {
          uint pid = (uint)p.Id;
          if (pid <= 4 || IsAuraBarWindow(pid, IntPtr.Zero)) continue;
          if (!string.IsNullOrEmpty(targetExe)) {
            ProcMeta pm = QueryProcMeta(pid);
            if (string.Equals(pm.exePath, targetExe, StringComparison.OrdinalIgnoreCase)) {
              pids.Add(pid);
            }
          }
        } catch {
        } finally {
          p.Dispose();
        }
      }
      return pids;
    }

    private static string TryGetAumid(uint pid) {
      try {
        IntPtr hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (int)pid);
        if (hProc == IntPtr.Zero) return "";
        try {
          uint len = 256;
          StringBuilder sb = new StringBuilder((int)len);
          int rc = GetApplicationUserModelId(hProc, ref len, sb);
          if (rc == 0) return sb.ToString();
        } finally {
          CloseHandle(hProc);
        }
      } catch { }
      return "";
    }

    private static string OpenAppFromPid(int pid) {
      if (pid <= 4) return "false";
      ProcMeta targetMeta;
      HashSet<uint> pids = CollectMatchingPids(pid, out targetMeta);

      // 1) Look for an already-taskbar-visible window across all processes of this app
      IntPtr visibleWin = IntPtr.Zero;
      IntPtr hiddenRealWin = IntPtr.Zero;
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        uint wPid;
        GetWindowThreadProcessId(hWnd, out wPid);
        if (!pids.Contains(wPid)) return true;

        if (IsTaskbarWindow(hWnd)) {
          visibleWin = hWnd;
          return false;
        }

        if (hiddenRealWin == IntPtr.Zero && IsWindow(hWnd) && !IsCloaked(hWnd)) {
          int len = GetWindowTextLength(hWnd);
          RECT rc;
          if (len > 0 && GetWindowRect(hWnd, out rc)) {
            int w = rc.right - rc.left;
            int h = rc.bottom - rc.top;
            if (w >= 160 && h >= 100) {
              StringBuilder cls = new StringBuilder(64);
              GetClassName(hWnd, cls, cls.Capacity);
              string c = cls.ToString();
              if (!c.Contains("Tooltip") && c != "MSCTFIME UI" && c != "IME") {
                hiddenRealWin = hWnd;
              }
            }
          }
        }
        return true;
      }, IntPtr.Zero);

      IntPtr toOpen = visibleWin != IntPtr.Zero ? visibleWin : hiddenRealWin;
      if (toOpen != IntPtr.Zero) {
        if (!IsWindowVisible(toOpen)) {
          ShowWindowAsync(toOpen, 5); // SW_SHOW
        }
        ForceFocus(toOpen);
        lastExternalForeground = toOpen;
        return "focused";
      }

      // 2) Packaged Microsoft Store / UWP / MSIX app -> return shell:AppsFolder AUMID
      foreach (uint id in pids) {
        string aumid = TryGetAumid(id);
        if (!string.IsNullOrEmpty(aumid)) {
          return "aumid:" + aumid;
        }
      }

      // 3) Fallback to exe path launch in main process
      if (!string.IsNullOrEmpty(targetMeta.exePath)) {
        return "exe:" + targetMeta.exePath;
      }
      return "false";
    }

    private static string KillAppDeep(int pid) {
      if (pid <= 4 || IsAuraBarWindow((uint)pid, IntPtr.Zero)) return "none";
      ProcMeta targetMeta;
      HashSet<uint> pids = CollectMatchingPids(pid, out targetMeta);
      if (!string.IsNullOrEmpty(targetMeta.exePath) &&
          targetMeta.exePath.StartsWith("C:\\Windows\\", StringComparison.OrdinalIgnoreCase)) {
        string baseName = Path.GetFileName(targetMeta.exePath).ToLowerInvariant();
        if (baseName == "explorer.exe" || baseName == "dwm.exe" || baseName == "svchost.exe" ||
            baseName == "csrss.exe" || baseName == "winlogon.exe" || baseName == "lsass.exe" ||
            baseName == "services.exe" || baseName == "smss.exe") {
          return "none";
        }
      }

      List<string> pidStrings = new List<string>();
      foreach (uint id in pids) {
        pidStrings.Add(id.ToString());
        // Direct Win32 TerminateProcess + .NET Kill
        try {
          IntPtr hProc = OpenProcess(PROCESS_TERMINATE, false, (int)id);
          if (hProc != IntPtr.Zero) {
            try { TerminateProcess(hProc, 1); } finally { CloseHandle(hProc); }
          }
        } catch { }
        try {
          using (Process p = Process.GetProcessById((int)id)) {
            if (!p.HasExited) p.Kill();
          }
        } catch { }
      }
      return pidStrings.Count > 0 ? "pids:" + string.Join(",", pidStrings.ToArray()) : "none";
    }

    private static string QuitProcessApp(int pid) {
      return KillAppDeep(pid);
    }

    private static void TapKey(byte vk) {
      keybd_event(vk, 0, 0, 0);
      keybd_event(vk, 0, 2, 0);
    }

    private static void TapCombo(byte modVk, byte keyVk) {
      keybd_event(modVk, 0, 0, 0);
      keybd_event(keyVk, 0, 0, 0);
      keybd_event(keyVk, 0, 2, 0);
      keybd_event(modVk, 0, 2, 0);
    }

    private static IAudioEndpointVolume GetEndpointVolume() {
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
      IMMDevice device;
      enumerator.GetDefaultAudioEndpoint(0, 1, out device);
      if (device == null) return null;
      Guid iid = typeof(IAudioEndpointVolume).GUID;
      object obj;
      device.Activate(ref iid, 23, IntPtr.Zero, out obj);
      return obj as IAudioEndpointVolume;
    }

    private static string GetVolumeJson() {
      try {
        IAudioEndpointVolume vol = GetEndpointVolume();
        if (vol == null) return "{\"level\":50,\"muted\":false}";
        float scalar;
        bool muted;
        vol.GetMasterVolumeLevelScalar(out scalar);
        vol.GetMute(out muted);
        int pct = Math.Max(0, Math.Min(100, (int)Math.Round(scalar * 100f)));
        return "{\"level\":" + pct + ",\"muted\":" + (muted ? "true" : "false") + "}";
      } catch {
        return "{\"level\":50,\"muted\":false}";
      }
    }

    private static string SetVolumeLevel(int pct) {
      try {
        IAudioEndpointVolume vol = GetEndpointVolume();
        if (vol != null) {
          int clamped = Math.Max(0, Math.Min(100, pct));
          Guid ctx = Guid.Empty;
          vol.SetMasterVolumeLevelScalar(clamped / 100f, ref ctx);
          if (clamped > 0) vol.SetMute(false, ref ctx);
        }
      } catch { }
      return GetVolumeJson();
    }

    private static string ToggleVolumeMute() {
      try {
        IAudioEndpointVolume vol = GetEndpointVolume();
        if (vol != null) {
          bool muted;
          vol.GetMute(out muted);
          Guid ctx = Guid.Empty;
          vol.SetMute(!muted, ref ctx);
        }
      } catch { }
      return GetVolumeJson();
    }

    private static string GetKbdLang() {
      IntPtr fg = lastExternalForeground != IntPtr.Zero ? lastExternalForeground : GetForegroundWindow();
      uint dummy;
      uint tid = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;
      int lang = (int)(GetKeyboardLayout(tid).ToInt64() & 0xFFFF);
      int primary = lang & 0x3FF;
      if (primary == 0x01) return "AR";
      if (primary == 0x09) return "EN";
      if (primary == 0x0C) return "FR";
      if (primary == 0x07) return "DE";
      return "EN";
    }

    private static string IconHandleToDataUrl(IntPtr hIcon, bool shouldDestroy) {
      if (hIcon == IntPtr.Zero) return "";
      try {
        using (Icon ico = Icon.FromHandle(hIcon))
        using (Bitmap bmp = ico.ToBitmap())
        using (MemoryStream ms = new MemoryStream()) {
          bmp.Save(ms, ImageFormat.Png);
          return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
        }
      } catch {
        return "";
      } finally {
        if (shouldDestroy) DestroyIcon(hIcon);
      }
    }

    private static string GetFileIconDataUrl(string filePath) {
      if (string.IsNullOrEmpty(filePath)) return "";
      SHFILEINFO shfi = new SHFILEINFO();
      SHGetFileInfo(filePath, 0, ref shfi, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), 0x100);
      if (shfi.hIcon != IntPtr.Zero) {
        return IconHandleToDataUrl(shfi.hIcon, true);
      }
      return "";
    }

    // Taskbar-style preview: render the window via PrintWindow (PW_RENDERFULLCONTENT so GPU/Chromium
    // content is captured), crop the invisible DWM resize borders, and downscale to a small JPEG.
    private static string GetWindowThumbDataUrl(long hwndVal, int maxW, int maxH) {
      IntPtr hWnd = new IntPtr(hwndVal);
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd) || IsIconic(hWnd)) return "";
      // WM_PRINT to a hung window would block the whole command loop
      if (IsHungAppWindow(hWnd)) return "";

      RECT wr;
      if (!GetWindowRect(hWnd, out wr)) return "";
      int w = wr.right - wr.left;
      int h = wr.bottom - wr.top;
      if (w <= 0 || h <= 0 || w > 10000 || h > 10000) return "";

      RECT fr;
      Rectangle crop = new Rectangle(0, 0, w, h);
      if (DwmGetWindowRect(hWnd, 9, out fr, Marshal.SizeOf(typeof(RECT))) == 0) { // DWMWA_EXTENDED_FRAME_BOUNDS
        Rectangle visible = Rectangle.Intersect(
          new Rectangle(fr.left - wr.left, fr.top - wr.top, fr.right - fr.left, fr.bottom - fr.top),
          crop
        );
        if (visible.Width > 0 && visible.Height > 0) crop = visible;
      }

      try {
        // 24bpp: GDI leaves alpha at 0, which would make a 32bpp capture fully transparent
        using (Bitmap full = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
          using (Graphics g = Graphics.FromImage(full)) {
            IntPtr hdc = g.GetHdc();
            bool ok;
            try { ok = PrintWindow(hWnd, hdc, 2); } finally { g.ReleaseHdc(hdc); }
            if (!ok) return "";
          }

          double scale = Math.Min(1.0, Math.Min((double)maxW / crop.Width, (double)maxH / crop.Height));
          int tw = Math.Max(1, (int)Math.Round(crop.Width * scale));
          int th = Math.Max(1, (int)Math.Round(crop.Height * scale));
          using (Bitmap thumb = new Bitmap(tw, th, PixelFormat.Format24bppRgb))
          using (Graphics g2 = Graphics.FromImage(thumb))
          using (MemoryStream ms = new MemoryStream()) {
            g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g2.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g2.DrawImage(full, new Rectangle(0, 0, tw, th), crop, GraphicsUnit.Pixel);

            ImageCodecInfo jpeg = null;
            foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) {
              if (c.MimeType == "image/jpeg") { jpeg = c; break; }
            }
            if (jpeg == null) {
              thumb.Save(ms, ImageFormat.Png);
              return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
            }
            using (EncoderParameters ep = new EncoderParameters(1)) {
              ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
              thumb.Save(ms, jpeg, ep);
            }
            return "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray());
          }
        }
      } catch {
        return "";
      }
    }

    private static string GetWindowIconDataUrl(long hwndVal) {
      IntPtr hWnd = new IntPtr(hwndVal);
      if (hWnd == IntPtr.Zero) return "";
      IntPtr hIcon = IntPtr.Zero;
      SendMessageTimeout(hWnd, 0x007F, new IntPtr(1), IntPtr.Zero, 0x0002, 120, out hIcon);
      if (hIcon == IntPtr.Zero) {
        SendMessageTimeout(hWnd, 0x007F, IntPtr.Zero, IntPtr.Zero, 0x0002, 120, out hIcon);
      }
      if (hIcon == IntPtr.Zero) {
        hIcon = GetClassLongPtr(hWnd, -14);
      }
      if (hIcon == IntPtr.Zero) {
        hIcon = GetClassLongPtr(hWnd, -34);
      }
      return IconHandleToDataUrl(hIcon, false);
    }

    private static void HideWindowsTaskbar(int left, int top, int right, int bottom) {
      taskbarHiddenByUs = true;
      savedScreenLeft = left;
      savedScreenRight = right;
      savedScreenBottom = Math.Max(bottom, 1080);
      IntPtr tray = FindWindow("Shell_TrayWnd", null);
      if (tray != IntPtr.Zero) {
        RECT trayRc = new RECT();
        if (GetWindowRect(tray, out trayRc)) {
          savedScreenLeft = trayRc.left;
          savedScreenRight = trayRc.right;
          savedScreenBottom = trayRc.bottom;
        }
        ShowWindowAsync(tray, 0);
      }
      IntPtr sec = FindWindow("Shell_SecondaryTrayWnd", null);
      if (sec != IntPtr.Zero) {
        ShowWindowAsync(sec, 0);
      }
      RECT rc = new RECT { left = left, top = top, right = right, bottom = bottom };
      SystemParametersInfo(0x002F, 0, ref rc, 0);
      EnumWindows(delegate(IntPtr hWnd, IntPtr lp) {
        if (IsWindowVisible(hWnd) && IsZoomed(hWnd)) {
          ShowWindowAsync(hWnd, 9);
          Thread.Sleep(25);
          ShowWindowAsync(hWnd, 3);
        }
        return true;
      }, IntPtr.Zero);
    }

    private static void RestoreWindowsTaskbar() {
      taskbarHiddenByUs = false;
      IntPtr tray = FindWindow("Shell_TrayWnd", null);
      if (tray != IntPtr.Zero) {
        ShowWindowAsync(tray, 5);
        SetWindowPos(tray, IntPtr.Zero, 0, 0, 0, 0, 0x0047);
        int trayH = 72;
        RECT trayRc = new RECT();
        if (GetWindowRect(tray, out trayRc) && (trayRc.bottom - trayRc.top) > 20) {
          trayH = trayRc.bottom - trayRc.top;
        }
        RECT wa = new RECT {
          left = savedScreenLeft,
          top = 0,
          right = savedScreenRight,
          bottom = savedScreenBottom - trayH
        };
        SystemParametersInfo(0x002F, 0, ref wa, 2);
      }
      IntPtr sec = FindWindow("Shell_SecondaryTrayWnd", null);
      if (sec != IntPtr.Zero) {
        ShowWindowAsync(sec, 5);
        SetWindowPos(sec, IntPtr.Zero, 0, 0, 0, 0, 0x0047);
      }
    }

    // Echo the caller's "#<id>" tag so the Node side can match replies to requests
    private static void Reply(string text) {
      Console.WriteLine(replyPrefix + text);
    }

    public static void Main(string[] args) {
      SetProcessDPIAware();
      if (args.Length > 0) {
        int.TryParse(args[0], out parentElectronPid);
      }

      Thread pollThread = new Thread(PollForegroundLoop);
      pollThread.IsBackground = true;
      pollThread.Start();

      Console.InputEncoding = Encoding.UTF8;
      Console.OutputEncoding = Encoding.UTF8;

      string line;
      while ((line = Console.ReadLine()) != null) {
        line = line.Trim();
        if (line.Length == 0) continue;

        replyPrefix = "";
        if (line[0] == '#') {
          int sp = line.IndexOf(' ');
          if (sp > 1) {
            replyPrefix = line.Substring(0, sp) + " ";
            line = line.Substring(sp + 1).Trim();
          }
        }

        try {
          if (line == "LIST") {
            Reply(ListWindowsJson());
          } else if (line == "LIST_BG") {
            Reply(ListBackgroundAppsJson());
          } else if (line.StartsWith("TOGGLE ")) {
            long hv = long.Parse(line.Substring(7).Trim());
            Reply(ToggleWindow(hv));
          } else if (line.StartsWith("CLOSE_WIN ")) {
            long hv = long.Parse(line.Substring(10).Trim());
            Reply(CloseWindowByHwnd(hv));
          } else if (line.StartsWith("OPEN_APP ")) {
            int pidVal = int.Parse(line.Substring(9).Trim());
            Reply(OpenAppFromPid(pidVal));
          } else if (line.StartsWith("KILL_APP ")) {
            int pidVal = int.Parse(line.Substring(9).Trim());
            Reply(KillAppDeep(pidVal));
          } else if (line.StartsWith("QUIT_APP ")) {
            int pidVal = int.Parse(line.Substring(9).Trim());
            Reply(QuitProcessApp(pidVal));
          } else if (line == "KBD_LANG") {
            Reply(GetKbdLang());
          } else if (line == "KBD_SWITCH") {
            if (lastExternalForeground != IntPtr.Zero) ForceFocus(lastExternalForeground);
            TapCombo(0x12, 0x10);
            Reply("ok");
          } else if (line == "START") {
            TapKey(0x5B);
            Reply("ok");
          } else if (line == "QUICK") {
            TapCombo(0x5B, 0x41);
            Reply("ok");
          } else if (line == "DESKTOP") {
            TapCombo(0x5B, 0x44);
            Reply("ok");
          } else if (line == "VOL_GET") {
            Reply(GetVolumeJson());
          } else if (line.StartsWith("VOL_SET ")) {
            int pct = int.Parse(line.Substring(8).Trim());
            Reply(SetVolumeLevel(pct));
          } else if (line == "VOL_UP") {
            TapKey(0xAF);
            Reply("ok");
          } else if (line == "VOL_DOWN") {
            TapKey(0xAE);
            Reply("ok");
          } else if (line == "VOL_MUTE") {
            Reply(ToggleVolumeMute());
          } else if (line == "MEDIA_PLAYPAUSE") {
            TapKey(0xB3);
            Reply("ok");
          } else if (line == "MEDIA_NEXT") {
            TapKey(0xB0);
            Reply("ok");
          } else if (line == "MEDIA_PREV") {
            TapKey(0xB1);
            Reply("ok");
          } else if (line.StartsWith("TASKBAR_HIDE ")) {
            string[] parts = line.Substring(13).Split(' ');
            HideWindowsTaskbar(
              int.Parse(parts[0]),
              int.Parse(parts[1]),
              int.Parse(parts[2]),
              int.Parse(parts[3])
            );
            Reply("ok");
          } else if (line == "TASKBAR_SHOW") {
            RestoreWindowsTaskbar();
            Reply("ok");
          } else if (line.StartsWith("SET_HWNDS ")) {
            string[] parts = line.Substring(10).Split(' ');
            dockHwnd = new IntPtr(long.Parse(parts[0]));
            islandHwnd = new IntPtr(long.Parse(parts[1]));
            if (hasDockTargetRect && dockHwnd != IntPtr.Zero) {
              SetWindowPos(
                dockHwnd,
                new IntPtr(-1),
                dockTargetRect.left,
                dockTargetRect.top,
                dockTargetRect.right - dockTargetRect.left,
                dockTargetRect.bottom - dockTargetRect.top,
                keepOnTop ? 0x0010u : 0x0014u
              );
            }
            Reply("ok");
          } else if (line.StartsWith("PLACE_DOCK ")) {
            string[] parts = line.Substring(11).Split(' ');
            int px = int.Parse(parts[0]);
            int py = int.Parse(parts[1]);
            int pw = int.Parse(parts[2]);
            int ph = int.Parse(parts[3]);
            dockTargetRect = new RECT { left = px, top = py, right = px + pw, bottom = py + ph };
            hasDockTargetRect = true;
            if (dockHwnd != IntPtr.Zero) {
              SetWindowPos(dockHwnd, new IntPtr(-1), px, py, pw, ph, keepOnTop ? 0x0010u : 0x0014u);
            }
            Reply("ok");
          } else if (line.StartsWith("TOPMOST ")) {
            IntPtr h = new IntPtr(long.Parse(line.Substring(8).Trim()));
            if (h != IntPtr.Zero && keepOnTop) SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0013 | 0x4000);
            Reply("ok");
          } else if (line.StartsWith("KEEP_TOP ")) {
            keepOnTop = line.Substring(9).Trim() != "0";
            Reply("ok");
          } else if (line.StartsWith("ICON ")) {
            Reply(GetFileIconDataUrl(line.Substring(5).Trim()));
          } else if (line.StartsWith("THUMB ")) {
            string[] parts = line.Substring(6).Trim().Split(' ');
            int tw = parts.Length > 1 ? int.Parse(parts[1]) : 400;
            int th = parts.Length > 2 ? int.Parse(parts[2]) : 240;
            Reply(GetWindowThumbDataUrl(long.Parse(parts[0]), Math.Max(32, Math.Min(tw, 800)), Math.Max(32, Math.Min(th, 600))));
          } else if (line.StartsWith("WINICON ")) {
            long hv = long.Parse(line.Substring(8).Trim());
            Reply(GetWindowIconDataUrl(hv));
          } else if (line == "EXIT") {
            if (taskbarHiddenByUs) RestoreWindowsTaskbar();
            Reply("bye");
            break;
          } else {
            Reply("unknown");
          }
        } catch (Exception ex) {
          Reply("ERR:" + JsonEscape(ex.Message));
        }
      }

      if (taskbarHiddenByUs) {
        RestoreWindowsTaskbar();
      }
    }
  }
}
