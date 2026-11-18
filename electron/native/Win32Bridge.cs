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
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(uint idThread);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_APPWINDOW = 0x00040000;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TOPMOST = 0x00000008;
    private const uint GW_HWNDPREV = 3;
    private const uint GW_OWNER = 4;
    private const int DWMWA_CLOAKED = 14;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    private static IntPtr lastExternalForeground = IntPtr.Zero;
    private static IntPtr dockHwnd = IntPtr.Zero;
    private static IntPtr islandHwnd = IntPtr.Zero;
    private static RECT dockTargetRect = new RECT();
    private static bool hasDockTargetRect = false;
    private static int parentElectronPid = 0;
    private static long nextSeenSeq = 1;
    private static readonly Dictionary<long, long> firstSeenMap = new Dictionary<long, long>();
    private static readonly Dictionary<uint, ProcMeta> procCache = new Dictionary<uint, ProcMeta>();
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

    private static ProcMeta GetProcMeta(uint pid) {
      ProcMeta cached;
      if (procCache.TryGetValue(pid, out cached)) return cached;

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

      ProcMeta meta = new ProcMeta {
        name = procName,
        exePath = exePath,
        isElectron = procName.Equals("electron", StringComparison.OrdinalIgnoreCase)
      };
      if (!string.IsNullOrEmpty(procName)) {
        if (procCache.Count > 200) procCache.Clear();
        procCache[pid] = meta;
      }
      return meta;
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
                if (dockHwnd != IntPtr.Zero) {
                  SetWindowPos(dockHwnd, new IntPtr(-1), 0, 0, 0, 0, 0x0013 | 0x4000);
                }
                if (islandHwnd != IntPtr.Zero) {
                  SetWindowPos(islandHwnd, new IntPtr(-1), 0, 0, 0, 0, 0x0013 | 0x4000);
                }
              }
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
      for (int i = 0; i < stale.Count; i++) firstSeenMap.Remove(stale[i]);

      entries.Sort(delegate(WinEntry a, WinEntry b) { return a.seq.CompareTo(b.seq); });
      if (entries.Count > 24) entries.RemoveRange(24, entries.Count - 24);

      string[] jsonArr = new string[entries.Count];
      for (int i = 0; i < entries.Count; i++) jsonArr[i] = entries[i].json;
      return "[" + string.Join(",", jsonArr) + "]";
    }

    private static void ForceFocus(IntPtr hWnd) {
      if (IsIconic(hWnd)) {
        ShowWindowAsync(hWnd, 9); // SW_RESTORE
      }
      AllowSetForegroundWindow(-1);
      BringWindowToTop(hWnd);
      if (SetForegroundWindow(hWnd)) return;

      // Fallback without Alt-key menu freeze
      IntPtr fg = GetForegroundWindow();
      uint dummy;
      uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;
      uint targetThread = GetWindowThreadProcessId(hWnd, out dummy);
      uint curThread = GetCurrentThreadId();

      if (fgThread != 0 && fgThread != curThread) AttachThreadInput(curThread, fgThread, true);
      if (targetThread != 0 && targetThread != curThread) AttachThreadInput(curThread, targetThread, true);

      BringWindowToTop(hWnd);
      SetForegroundWindow(hWnd);

      if (fgThread != 0 && fgThread != curThread) AttachThreadInput(curThread, fgThread, false);
      if (targetThread != 0 && targetThread != curThread) AttachThreadInput(curThread, targetThread, false);
    }

    private static string ToggleWindow(long hwndVal) {
      IntPtr hWnd = new IntPtr(hwndVal);
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return "false";
      if (!IsIconic(hWnd) && hWnd == lastExternalForeground) {
        ShowWindowAsync(hWnd, 6); // SW_MINIMIZE
        return "minimized";
      } else {
        ForceFocus(hWnd);
        lastExternalForeground = hWnd;
        return "focused";
      }
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

        try {
          if (line == "LIST") {
            Console.WriteLine(ListWindowsJson());
          } else if (line.StartsWith("TOGGLE ")) {
            long hv = long.Parse(line.Substring(7).Trim());
            Console.WriteLine(ToggleWindow(hv));
          } else if (line == "KBD_LANG") {
            Console.WriteLine(GetKbdLang());
          } else if (line == "KBD_SWITCH") {
            if (lastExternalForeground != IntPtr.Zero) ForceFocus(lastExternalForeground);
            TapCombo(0x12, 0x10);
            Console.WriteLine("ok");
          } else if (line == "START") {
            TapKey(0x5B);
            Console.WriteLine("ok");
          } else if (line == "QUICK") {
            TapCombo(0x5B, 0x41);
            Console.WriteLine("ok");
          } else if (line == "DESKTOP") {
            TapCombo(0x5B, 0x44);
            Console.WriteLine("ok");
          } else if (line == "VOL_UP") {
            TapKey(0xAF);
            Console.WriteLine("ok");
          } else if (line == "VOL_DOWN") {
            TapKey(0xAE);
            Console.WriteLine("ok");
          } else if (line == "VOL_MUTE") {
            TapKey(0xAD);
            Console.WriteLine("ok");
          } else if (line == "MEDIA_PLAYPAUSE") {
            TapKey(0xB3);
            Console.WriteLine("ok");
          } else if (line == "MEDIA_NEXT") {
            TapKey(0xB0);
            Console.WriteLine("ok");
          } else if (line == "MEDIA_PREV") {
            TapKey(0xB1);
            Console.WriteLine("ok");
          } else if (line.StartsWith("TASKBAR_HIDE ")) {
            string[] parts = line.Substring(13).Split(' ');
            HideWindowsTaskbar(
              int.Parse(parts[0]),
              int.Parse(parts[1]),
              int.Parse(parts[2]),
              int.Parse(parts[3])
            );
            Console.WriteLine("ok");
          } else if (line == "TASKBAR_SHOW") {
            RestoreWindowsTaskbar();
            Console.WriteLine("ok");
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
                0x0010
              );
            }
            Console.WriteLine("ok");
          } else if (line.StartsWith("PLACE_DOCK ")) {
            string[] parts = line.Substring(11).Split(' ');
            int px = int.Parse(parts[0]);
            int py = int.Parse(parts[1]);
            int pw = int.Parse(parts[2]);
            int ph = int.Parse(parts[3]);
            dockTargetRect = new RECT { left = px, top = py, right = px + pw, bottom = py + ph };
            hasDockTargetRect = true;
            if (dockHwnd != IntPtr.Zero) {
              SetWindowPos(dockHwnd, new IntPtr(-1), px, py, pw, ph, 0x0010);
            }
            Console.WriteLine("ok");
          } else if (line.StartsWith("TOPMOST ")) {
            IntPtr h = new IntPtr(long.Parse(line.Substring(8).Trim()));
            if (h != IntPtr.Zero) SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0013 | 0x4000);
            Console.WriteLine("ok");
          } else if (line.StartsWith("ICON ")) {
            Console.WriteLine(GetFileIconDataUrl(line.Substring(5).Trim()));
          } else if (line.StartsWith("WINICON ")) {
            long hv = long.Parse(line.Substring(8).Trim());
            Console.WriteLine(GetWindowIconDataUrl(hv));
          } else if (line == "EXIT") {
            if (taskbarHiddenByUs) RestoreWindowsTaskbar();
            Console.WriteLine("bye");
            break;
          } else {
            Console.WriteLine("unknown");
          }
        } catch (Exception ex) {
          Console.WriteLine("ERR:" + JsonEscape(ex.Message));
        }
      }

      if (taskbarHiddenByUs) {
        RestoreWindowsTaskbar();
      }
    }
  }
}
