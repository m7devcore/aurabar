using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace GlassyNative {
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

    [DllImport("shell32.dll", EntryPoint = "SHGetFileInfoW", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHGetFileInfoPidl(IntPtr pidl, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbSizeFileInfo, uint uFlags);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHParseDisplayName(string pszName, IntPtr pbc, out IntPtr ppidl, uint sfgaoIn, out uint psfgaoOut);

    [DllImport("shell32.dll")]
    private static extern int SHGetKnownFolderPath(ref Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int ExtractIconEx(string lpszFile, int nIconIndex, IntPtr[] phiconLarge, IntPtr[] phiconSmall, int nIcons);

    [DllImport("shell32.dll")]
    private static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, out IPropertyStore ppv);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHGetPropertyStoreFromParsingName(string pszPath, IntPtr pbc, int flags, ref Guid riid, out IPropertyStore ppv);

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE {
      public int cx;
      public int cy;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GDI_BITMAP {
      public int bmType, bmWidth, bmHeight, bmWidthBytes;
      public ushort bmPlanes, bmBitsPixel;
      public IntPtr bmBits;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER {
      public uint biSize;
      public int biWidth, biHeight;
      public ushort biPlanes, biBitCount;
      public uint biCompression, biSizeImage;
      public int biXPelsPerMeter, biYPelsPerMeter;
      public uint biClrUsed, biClrImportant;
    }

    [ComImport]
    [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory {
      [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItemImageFactory ppv);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    private static extern int GetObject(IntPtr hgdiobj, int cbBuffer, out GDI_BITMAP lpvObject);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint start, uint lines, byte[] bits, ref BITMAPINFOHEADER bmi, uint usage);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateRoundRectRgn(int x1, int y1, int x2, int y2, int cx, int cy);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateSolidBrush(uint crColor);

    [DllImport("user32.dll")]
    private static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);

    [DllImport("user32.dll")]
    private static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

    [DllImport("ole32.dll")]
    private static extern void CoTaskMemFree(IntPtr pv);

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PROPVARIANT pvar);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PHYSICAL_MONITOR {
      public IntPtr hPhysicalMonitor;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
      public string szPhysicalMonitorDescription;
    }

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, out uint pdwNumberOfPhysicalMonitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint dwPhysicalMonitorArraySize, [Out] PHYSICAL_MONITOR[] pPhysicalMonitorArray);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool DestroyPhysicalMonitors(uint dwPhysicalMonitorArraySize, [In] PHYSICAL_MONITOR[] pPhysicalMonitorArray);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool GetMonitorBrightness(IntPtr hMonitor, out uint pdwMinimumBrightness, out uint pdwCurrentBrightness, out uint pdwMaximumBrightness);

    [DllImport("dxva2.dll", SetLastError = true)]
    private static extern bool SetMonitorBrightness(IntPtr hMonitor, uint dwNewBrightness);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

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
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr GetLastActivePopup(IntPtr hWnd);

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

    // What Alt+Tab uses: restores and activates even windows our process is not allowed to
    // drive with the regular calls (elevated apps such as Task Manager, or a foreground lock)
    [DllImport("user32.dll")]
    private static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")]
    private static extern IntPtr SendMessageTimeoutRaw(
      IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO {
      public int cbSize;
      public RECT rcMonitor;
      public RECT rcWork;
      public uint dwFlags;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("shell32.dll")]
    private static extern int SHQueryUserNotificationState(out int pquns);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
      IntPtr tokenHandle, int tokenInfoClass, out int tokenInfo, int tokenInfoLength, out int returnLength);

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

    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEM_POWER_STATUS {
      public byte ACLineStatus;
      public byte BatteryFlag;
      public byte BatteryLifePercent;
      public byte SystemStatusFlag;
      public int BatteryLifeTime;
      public int BatteryFullLifeTime;
    }

    [DllImport("kernel32.dll")]
    private static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS lpSystemPowerStatus);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern IntPtr GetKeyboardLayout(uint idThread);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")]
    private static extern int DwmGetWindowRect(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [StructLayout(LayoutKind.Sequential)]
    private struct DWM_THUMBNAIL_PROPERTIES {
      public uint dwFlags;
      public RECT rcDestination;
      public RECT rcSource;
      public byte opacity;
      [MarshalAs(UnmanagedType.Bool)] public bool fVisible;
      [MarshalAs(UnmanagedType.Bool)] public bool fSourceClientAreaOnly;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmRegisterThumbnail(IntPtr hwndDestination, IntPtr hwndSource, out IntPtr phThumbnailId);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUnregisterThumbnail(IntPtr hThumbnailId);

    [DllImport("dwmapi.dll")]
    private static extern int DwmQueryThumbnailSourceSize(IntPtr hThumbnail, out SIZE pSize);

    [DllImport("dwmapi.dll")]
    private static extern int DwmUpdateThumbnailProperties(IntPtr hThumbnailId, ref DWM_THUMBNAIL_PROPERTIES ptnProperties);

    private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEX {
      public uint cbSize;
      public uint style;
      public IntPtr lpfnWndProc;
      public int cbClsExtra;
      public int cbWndExtra;
      public IntPtr hInstance;
      public IntPtr hIcon;
      public IntPtr hCursor;
      public IntPtr hbrBackground;
      public string lpszMenuName;
      public string lpszClassName;
      public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG {
      public IntPtr hwnd;
      public uint message;
      public IntPtr wParam;
      public IntPtr lParam;
      public uint time;
      public POINT pt;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClassEx(ref WNDCLASSEX lpwcx);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(
      uint dwExStyle, string lpClassName, string lpWindowName, uint dwStyle,
      int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    private static extern bool IsHungAppWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPERTYKEY {
      public Guid fmtid;
      public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPVARIANT {
      public ushort vt;
      public ushort wReserved1;
      public ushort wReserved2;
      public ushort wReserved3;
      public IntPtr p;
      public IntPtr p2;
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore {
      [PreserveSig] int GetCount(out uint cProps);
      [PreserveSig] int GetAt(uint iProp, out PROPERTYKEY pkey);
      [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
      [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT propvar);
      [PreserveSig] int Commit();
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorComObject { }

    [ComImport]
    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection {
      [PreserveSig] int GetCount(out uint pcDevices);
      [PreserveSig] int Item(uint nDevice, out IMMDevice ppDevice);
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
      [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IMMDeviceCollection ppDevices);
      [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
      [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
      [PreserveSig] int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
      [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
      [PreserveSig] int GetState(out int pdwState);
    }

    [ComImport]
    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume {
      [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
      [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
      [PreserveSig] int GetChannelCount(out uint pnChannelCount);
      [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
      [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
      [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
      [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
      [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
      [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
      [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
      [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
      [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
      [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
    }

    [ComImport]
    [Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    private class PolicyConfigClientComObject { }

    [ComImport]
    [Guid("F8679F50-850A-41CF-9C72-430F290290C8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPolicyConfig {
      [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr ppFormat);
      [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr ppFormat);
      [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName);
      [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pEndpointFormat, IntPtr pMixFormat);
      [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bDefault, IntPtr pmftDefaultPeriod, IntPtr pmftMinimumPeriod);
      [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pmftPeriod);
      [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
      [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr mode);
      [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bFxStore, IntPtr key, IntPtr pv);
      [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bFxStore, IntPtr key, IntPtr pv);
      [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int role);
      [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, int bVisible);
    }

    [ComImport]
    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionManager2 {
      [PreserveSig] int GetAudioSessionControl(IntPtr AudioSessionGuid, uint StreamFlags, out IntPtr SessionControl);
      [PreserveSig] int GetSimpleAudioVolume(IntPtr AudioSessionGuid, uint StreamFlags, out IntPtr AudioVolume);
      [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
    }

    [ComImport]
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionEnumerator {
      [PreserveSig] int GetCount(out int SessionCount);
      [PreserveSig] int GetSession(int SessionCount, out IAudioSessionControl Session);
    }

    [ComImport]
    [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl {
      [PreserveSig] int GetState(out int pRetVal);
      [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
      [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
      [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
      [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
      [PreserveSig] int GetGroupingParam(out Guid pRetVal);
      [PreserveSig] int SetGroupingParam(ref Guid Override, ref Guid EventContext);
      [PreserveSig] int RegisterAudioSessionNotification(IntPtr NewNotifications);
      [PreserveSig] int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    }

    [ComImport]
    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioSessionControl2 {
      [PreserveSig] int GetState(out int pRetVal);
      [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
      [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
      [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
      [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string Value, ref Guid EventContext);
      [PreserveSig] int GetGroupingParam(out Guid pRetVal);
      [PreserveSig] int SetGroupingParam(ref Guid Override, ref Guid EventContext);
      [PreserveSig] int RegisterAudioSessionNotification(IntPtr NewNotifications);
      [PreserveSig] int UnregisterAudioSessionNotification(IntPtr NewNotifications);
      [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
      [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string pRetVal);
      [PreserveSig] int GetProcessId(out uint pRetVal);
      [PreserveSig] int IsSystemSoundsSession();
      [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    [ComImport]
    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ISimpleAudioVolume {
      [PreserveSig] int SetMasterVolume(float fLevel, ref Guid EventContext);
      [PreserveSig] int GetMasterVolume(out float pfLevel);
      [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid EventContext);
      [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
    }

    private const int GWL_EXSTYLE = -20;
    private const int GWL_STYLE = -16;
    private const int WS_EX_TOOLWINDOW = 0x00000080;
    private const int WS_EX_APPWINDOW = 0x00040000;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TOPMOST = 0x00000008;
    private const uint WM_CLOSE = 0x0010;
    private const uint WM_SYSCOMMAND = 0x0112;
    private const int SC_MINIMIZE = 0xF020;
    private const int SC_RESTORE = 0xF120;
    private const int SC_CLOSE = 0xF060;
    private const uint SMTO_ABORTIFHUNG = 0x0002;
    private const uint GW_HWNDPREV = 3;
    private const uint GW_OWNER = 4;
    private const int DWMWA_CLOAKED = 14;
    private const uint PROCESS_TERMINATE = 0x0001;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    private static IntPtr lastExternalForeground = IntPtr.Zero;
    private static volatile bool startMenuOpen = false;
    private static volatile int startMenuClosedByDockAt = 0;
    private static IntPtr dockHwnd = IntPtr.Zero;
    private static IntPtr islandHwnd = IntPtr.Zero;
    private static volatile IntPtr peekOverlayHwnd = IntPtr.Zero;
    private static IntPtr activePeekThumb = IntPtr.Zero;
    private static WndProcDelegate peekWndProcRef = null;
    private static readonly object liveThumbLock = new object();
    private struct LiveThumbSpec {
      public long targetHwnd;
      public int screenX, screenY, w, h, radius;
    }
    private static List<LiveThumbSpec> pendingThumbSpecs = new List<LiveThumbSpec>();
    private static readonly List<IntPtr> liveThumbPool = new List<IntPtr>();
    private static readonly List<IntPtr> liveThumbHandles = new List<IntPtr>();
    private static readonly List<string> liveThumbSig = new List<string>();
    private static readonly HashSet<IntPtr> liveThumbHwndSet = new HashSet<IntPtr>();
    private static IntPtr liveThumbBrush = IntPtr.Zero;
    private const uint WM_PEEK_START = 0x8010;
    private const uint WM_PEEK_STOP = 0x8011;
    private const uint WM_THUMBS_SYNC = 0x8012;
    private const uint WM_THUMBS_CLEAR = 0x8013;
    private static readonly object extraHwndsLock = new object();
    private static readonly List<IntPtr> extraDockHwnds = new List<IntPtr>();
    private static readonly Dictionary<IntPtr, RECT> extraDockRects = new Dictionary<IntPtr, RECT>();
    private static readonly Dictionary<IntPtr, RECT> savedSecWorkAreas = new Dictionary<IntPtr, RECT>();
    private static readonly Dictionary<IntPtr, RECT> desiredSecWorkAreas = new Dictionary<IntPtr, RECT>();
    private static RECT dockTargetRect = new RECT();
    private static bool hasDockTargetRect = false;
    private static int parentElectronPid = 0;
    private static long nextSeenSeq = 1;
    private static readonly Dictionary<long, long> firstSeenMap = new Dictionary<long, long>();
    private static readonly Dictionary<long, string> winAppIdCache = new Dictionary<long, string>();
    private static readonly HashSet<long> maximizedHwnds = new HashSet<long>();
    private static readonly Dictionary<uint, ProcMeta> procCache = new Dictionary<uint, ProcMeta>();
    private static readonly Dictionary<uint, string> aumidCache = new Dictionary<uint, string>();
    private static readonly Dictionary<string, int> subsystemCache = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, string> descCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private static readonly object procCacheLock = new object();
    private static volatile bool keepOnTop = true;
    private static string replyPrefix = "";

    // Last good preview per window. A minimized window cannot be rendered, so - like the Windows
    // taskbar - the peek shows the frame captured before it was minimized.
    private struct ThumbEntry {
      public string url;
      public long at;
    }
    private static readonly Dictionary<long, ThumbEntry> thumbCache = new Dictionary<long, ThumbEntry>();
    private static readonly object thumbCacheLock = new object();
    private const int THUMB_W = 400;
    private const int THUMB_H = 240;
    private static volatile bool taskbarHiddenByUs = false;
    // The work area we reserved for the dock; Windows resets it behind our back (a full-screen
    // app exiting, a display change), which lets maximized windows slide under the dock
    private static bool hasDesiredWorkArea = false;
    private static RECT desiredWorkArea;
    private static int primaryWorkAreaBackoffUntil = 0;
    private static readonly Dictionary<IntPtr, int> secWorkAreaBackoffUntil = new Dictionary<IntPtr, int>();
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

    private static string GetCachedAumid(uint pid) {
      if (pid <= 4) return "";
      string cached;
      lock (procCacheLock) {
        if (aumidCache.TryGetValue(pid, out cached)) return cached;
      }
      string aumid = TryGetAumid(pid);
      lock (procCacheLock) {
        if (aumidCache.Count > 250) aumidCache.Clear();
        aumidCache[pid] = aumid;
      }
      return aumid;
    }

    // UWP/Store apps (WhatsApp, Calculator, Photos, Settings...) host their top-level frame inside
    // ApplicationFrameHost.exe. Find the real hosted child CoreWindow PID so Glassy gets the true
    // app name, executable path, icon, and AUMID instead of ApplicationFrameHost.
    private static uint ResolveRealUwpPid(IntPtr hWnd, uint hostPid) {
      uint corePid = 0;
      uint fallbackPid = 0;
      EnumChildWindows(hWnd, delegate(IntPtr child, IntPtr lp) {
        uint cPid;
        GetWindowThreadProcessId(child, out cPid);
        if (cPid == 0 || cPid == hostPid) return true;
        StringBuilder cls = new StringBuilder(64);
        GetClassName(child, cls, cls.Capacity);
        if (cls.ToString() == "Windows.UI.Core.CoreWindow") {
          corePid = cPid;
          return false;
        }
        if (fallbackPid == 0) fallbackPid = cPid;
        return true;
      }, IntPtr.Zero);
      return corePid != 0 ? corePid : (fallbackPid != 0 ? fallbackPid : hostPid);
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

    // Returns the true visible window bounds excluding invisible DWM resize/shadow borders
    // (which overhang by 8-16px on 100%-200% DPI maximized windows and otherwise cause false
    // fullscreen / work-area refit triggers).
    private static bool GetVisibleWindowRect(IntPtr hWnd, out RECT r) {
      if (DwmGetWindowRect(hWnd, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0 &&
          (r.right - r.left) > 0 && (r.bottom - r.top) > 0) {
        return true;
      }
      return GetWindowRect(hWnd, out r);
    }

    private static volatile int lastWorkAreaChangeAt = 0;
    private static int primaryWorkAreaLastSetAt = 0;
    private static readonly Dictionary<IntPtr, int> secWorkAreaLastSetAt = new Dictionary<IntPtr, int>();

    private static bool IsExtraDockHwnd(IntPtr hWnd) {
      if (hWnd == IntPtr.Zero) return false;
      lock (extraHwndsLock) {
        for (int i = 0; i < extraDockHwnds.Count; i++) {
          if (extraDockHwnds[i] == hWnd) return true;
        }
      }
      return false;
    }

    private static bool IsGlassyWindow(uint pid, IntPtr hWnd) {
      if (hWnd != IntPtr.Zero) {
        if (hWnd == dockHwnd || hWnd == islandHwnd || hWnd == peekOverlayHwnd || IsExtraDockHwnd(hWnd)) return true;
        lock (liveThumbLock) {
          if (liveThumbHwndSet.Contains(hWnd)) return true;
        }
      }
      if (parentElectronPid > 0 && pid == (uint)parentElectronPid) return true;
      return GetProcMeta(pid).isElectron;
    }

    // Never call SW_RESTORE + SW_MAXIMIZE on user windows (that makes every open window visibly
    // shrink and grow / bounce on both monitors). Silently reserving the work area with fWinIni=0
    // lets Windows apply it cleanly without waking explorer.exe to overwrite it back.
    private static void EnforceWorkArea() {
      if (!taskbarHiddenByUs) return;
      // Never touch work area while ANY monitor has an active fullscreen game or video.
      if (IsAnyMonitorFullscreen()) return;

      int now = Environment.TickCount;

      if (hasDesiredWorkArea && unchecked(now - primaryWorkAreaBackoffUntil) >= 0) {
        RECT cur = new RECT();
        if (SystemParametersInfo(0x0030, 0, ref cur, 0)) {
          RECT want = desiredWorkArea;
          bool drifted = Math.Abs(cur.left - want.left) > 6 || Math.Abs(cur.top - want.top) > 6 ||
                         Math.Abs(cur.right - want.right) > 6 || Math.Abs(cur.bottom - want.bottom) > 6;
          if (drifted) {
            // If Windows/Explorer reverted our work area within 8s of us setting it, back off 60s
            // so we never enter a tug-of-war bounce loop.
            if (primaryWorkAreaLastSetAt != 0 && unchecked(now - primaryWorkAreaLastSetAt) < 8000) {
              primaryWorkAreaBackoffUntil = unchecked(now + 60000);
            } else {
              lastWorkAreaChangeAt = now;
              primaryWorkAreaLastSetAt = now;
              SystemParametersInfo(0x002F, 0, ref want, 0); // fWinIni=0: do NOT broadcast WM_SETTINGCHANGE to explorer.exe!
              RECT after = new RECT();
              if (SystemParametersInfo(0x0030, 0, ref after, 0)) {
                bool stillDrifted = Math.Abs(after.left - want.left) > 6 || Math.Abs(after.top - want.top) > 6 ||
                                    Math.Abs(after.right - want.right) > 6 || Math.Abs(after.bottom - want.bottom) > 6;
                if (stillDrifted) {
                  primaryWorkAreaBackoffUntil = unchecked(now + 60000);
                }
              }
            }
          }
        }
      }

      List<KeyValuePair<IntPtr, RECT>> secList = null;
      lock (extraHwndsLock) {
        if (desiredSecWorkAreas.Count > 0) {
          secList = new List<KeyValuePair<IntPtr, RECT>>(desiredSecWorkAreas);
        }
      }
      if (secList != null) {
        for (int i = 0; i < secList.Count; i++) {
          IntPtr mon = secList[i].Key;
          int backoffUntil;
          int lastSetAt = 0;
          bool backedOff = false;
          lock (extraHwndsLock) {
            if (secWorkAreaBackoffUntil.TryGetValue(mon, out backoffUntil) && unchecked(now - backoffUntil) < 0) {
              backedOff = true;
            }
            secWorkAreaLastSetAt.TryGetValue(mon, out lastSetAt);
          }
          if (backedOff) continue;
          RECT want = secList[i].Value;
          MONITORINFO mi = new MONITORINFO();
          mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
          if (!GetMonitorInfo(mon, ref mi)) continue;
          RECT cur = mi.rcWork;
          bool drifted = Math.Abs(cur.left - want.left) > 6 || Math.Abs(cur.top - want.top) > 6 ||
                         Math.Abs(cur.right - want.right) > 6 || Math.Abs(cur.bottom - want.bottom) > 6;
          if (!drifted) continue;
          if (lastSetAt != 0 && unchecked(now - lastSetAt) < 8000) {
            lock (extraHwndsLock) {
              secWorkAreaBackoffUntil[mon] = unchecked(now + 60000);
            }
            continue;
          }
          lastWorkAreaChangeAt = now;
          lock (extraHwndsLock) {
            secWorkAreaLastSetAt[mon] = now;
          }
          SystemParametersInfo(0x002F, 0, ref want, 0); // fWinIni=0: never wake explorer.exe AppBar!
          MONITORINFO afterMi = new MONITORINFO();
          afterMi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
          if (GetMonitorInfo(mon, ref afterMi)) {
            RECT after = afterMi.rcWork;
            bool stillDrifted = Math.Abs(after.left - want.left) > 6 || Math.Abs(after.top - want.top) > 6 ||
                                Math.Abs(after.right - want.right) > 6 || Math.Abs(after.bottom - want.bottom) > 6;
            if (stillDrifted) {
              lock (extraHwndsLock) {
                secWorkAreaBackoffUntil[mon] = unchecked(now + 60000);
              }
            }
          }
        }
      }
    }

    private static void EnforceDockPlacement() {
      if (!hasDockTargetRect || dockHwnd == IntPtr.Zero) return;
      if (!IsWindow(dockHwnd) || !IsWindowVisible(dockHwnd)) return;
      RECT r;
      if (!GetWindowRect(dockHwnd, out r)) return;
      RECT t = dockTargetRect;
      // Allow +-3px tolerance for fractional DPI rounding so we never ping-pong with Electron setBounds
      if (Math.Abs(r.left - t.left) <= 3 && Math.Abs(r.top - t.top) <= 3 &&
          Math.Abs(r.right - t.right) <= 3 && Math.Abs(r.bottom - t.bottom) <= 3) {
        return;
      }
      SetWindowPos(
        dockHwnd,
        new IntPtr(-1),
        t.left,
        t.top,
        t.right - t.left,
        t.bottom - t.top,
        keepOnTop ? 0x0010u : 0x0014u
      );
    }

    private static void EnforceExtraDockPlacement(IntPtr h) {
      if (h == IntPtr.Zero || !IsWindow(h) || !IsWindowVisible(h)) return;
      RECT t;
      bool hasRect = false;
      lock (extraHwndsLock) {
        hasRect = extraDockRects.TryGetValue(h, out t);
      }
      if (!hasRect) return;
      RECT r;
      if (!GetWindowRect(h, out r)) return;
      if (Math.Abs(r.left - t.left) <= 3 && Math.Abs(r.top - t.top) <= 3 &&
          Math.Abs(r.right - t.right) <= 3 && Math.Abs(r.bottom - t.bottom) <= 3) {
        return;
      }
      SetWindowPos(
        h,
        new IntPtr(-1),
        t.left,
        t.top,
        t.right - t.left,
        t.bottom - t.top,
        keepOnTop ? 0x0010u : 0x0014u
      );
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
          if (prev != dockHwnd && prev != islandHwnd && !IsExtraDockHwnd(prev) && IsWindowVisible(prev)) {
            uint pPid;
            GetWindowThreadProcessId(prev, out pPid);
            if (!IsGlassyWindow(pPid, prev)) {
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

    private static void SetAllNativeTaskbarsVisible(bool show) {
      string[] classes = new string[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" };
      for (int i = 0; i < classes.Length; i++) {
        IntPtr cur = IntPtr.Zero;
        while ((cur = FindWindowEx(IntPtr.Zero, cur, classes[i], null)) != IntPtr.Zero) {
          bool vis = IsWindowVisible(cur);
          if (show) {
            if (!vis) ShowWindow(cur, 5);
            SetWindowPos(cur, IntPtr.Zero, 0, 0, 0, 0, 0x0047);
          } else if (vis) {
            ShowWindowAsync(cur, 0);
          }
        }
      }
    }

    private static bool IsParentAlive() {
      if (parentElectronPid <= 4) return true;
      try {
        using (Process p = Process.GetProcessById(parentElectronPid)) {
          return !p.HasExited;
        }
      } catch {
        return false;
      }
    }

    private static readonly object stdoutLock = new object();

    private static void EmitEvent(string ev) {
      lock (stdoutLock) {
        Console.WriteLine("!" + ev);
        Console.Out.Flush();
      }
    }

    private static bool IsStartMenuWindow(IntPtr hWnd, uint pid) {
      if (hWnd == IntPtr.Zero || pid <= 4 || !IsWindowVisible(hWnd) || IsCloaked(hWnd)) return false;
      string name = GetProcMeta(pid).name;
      return name.Equals("StartMenuExperienceHost", StringComparison.OrdinalIgnoreCase) ||
             name.Equals("SearchHost", StringComparison.OrdinalIgnoreCase) ||
             name.Equals("SearchApp", StringComparison.OrdinalIgnoreCase) ||
             name.Equals("ShellExperienceHost", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsShellOverlayForegroundOnMonitor(IntPtr monitor) {
      if (monitor == IntPtr.Zero) return false;
      IntPtr fg = GetForegroundWindow();
      if (fg == IntPtr.Zero) return false;
      uint pid;
      GetWindowThreadProcessId(fg, out pid);
      if (pid <= 4) return false;
      bool isStartOrAura = IsStartMenuWindow(fg, pid) || IsGlassyWindow(pid, fg);
      if (!isStartOrAura) return false;
      IntPtr fgMon = MonitorFromWindow(fg, 2);
      return fgMon == monitor;
    }

    private static string ToggleStartMenu() {
      IntPtr fg = GetForegroundWindow();
      if (fg != IntPtr.Zero) {
        uint fgPid;
        GetWindowThreadProcessId(fg, out fgPid);
        if (IsStartMenuWindow(fg, fgPid)) {
          startMenuOpen = false;
          startMenuClosedByDockAt = 0;
          TapKey(0x5B);
          return "closed";
        }
      }
      int closedAt = startMenuClosedByDockAt;
      if (startMenuOpen || (closedAt != 0 && unchecked(Environment.TickCount - closedAt) < 550)) {
        // Clicking the Start button on any Glassy monitor just stole focus and closed Start Menu;
        // do not send Win key again or Windows will bounce Start Menu right back open.
        startMenuOpen = false;
        startMenuClosedByDockAt = 0;
        return "closed";
      }
      startMenuOpen = false;
      startMenuClosedByDockAt = 0;
      TapKey(0x5B);
      return "opened";
    }

    private static void PollForegroundLoop() {
      int parentCheckTick = 0;
      int enforceTick = 0;
      bool inFullscreenSleep = false;
      bool wasStartMenu = false;
      while (true) {
        try {
          if (++parentCheckTick >= 10) {
            parentCheckTick = 0;
            if (!IsParentAlive()) {
              if (taskbarHiddenByUs) {
                try { RestoreWindowsTaskbar(); } catch { }
              } else {
                try { ReleaseAllSecondaryWorkAreas(); } catch { }
              }
              Environment.Exit(0);
              return;
            }
          }

          IntPtr fg = GetForegroundWindow();
          bool isStartNow = false;
          if (fg != IntPtr.Zero) {
            uint pid;
            GetWindowThreadProcessId(fg, out pid);
            bool isAura = IsGlassyWindow(pid, fg);
            isStartNow = !isAura && IsStartMenuWindow(fg, pid);
            if (isStartNow) {
              startMenuOpen = true;
              startMenuClosedByDockAt = 0;
              // User pressed the Windows key (possibly from inside a fullscreen game!):
              // immediately hide Windows' native taskbar so it never flashes, and push an instant
              // wake event to Electron so Glassy appears in <100ms instead of waiting ~1.5s.
              if (!wasStartMenu) {
                if (taskbarHiddenByUs) {
                  SetAllNativeTaskbarsVisible(false);
                }
                bool anyDockHidden = dockHwnd != IntPtr.Zero && !IsWindowVisible(dockHwnd);
                if (!anyDockHidden) {
                  lock (extraHwndsLock) {
                    for (int ei = 0; ei < extraDockHwnds.Count; ei++) {
                      IntPtr eh = extraDockHwnds[ei];
                      if (eh != IntPtr.Zero && IsWindow(eh) && !IsWindowVisible(eh)) {
                        anyDockHidden = true;
                        break;
                      }
                    }
                  }
                }
                if (anyDockHidden) {
                  EmitEvent("FS_WAKE");
                }
              }
            } else if (isAura) {
              if (startMenuOpen) {
                startMenuOpen = false;
                startMenuClosedByDockAt = Environment.TickCount;
              }
            } else {
              startMenuOpen = false;
              startMenuClosedByDockAt = 0;
            }
            if (!isAura && IsTaskbarWindow(fg)) {
              if (fg != lastExternalForeground) {
                lastExternalForeground = fg;
              }
            } else if (!isAura) {
              // Focus went to the desktop, Start, a shell popup...: the old window is no longer
              // "the active one", so clicking its icon must bring it forward, not minimize it
              lastExternalForeground = IntPtr.Zero;
            } else if (lastExternalForeground != IntPtr.Zero &&
                       (!IsWindow(lastExternalForeground) || IsIconic(lastExternalForeground))) {
              lastExternalForeground = IntPtr.Zero;
            }
          }
          wasStartMenu = isStartNow;

          // Enforce work area, dock rect, and topmost z-order every ~600ms (zero work while hidden in fullscreen!)
          if (++enforceTick >= 4) {
            enforceTick = 0;
            bool primaryDockVis = dockHwnd != IntPtr.Zero && IsWindow(dockHwnd) && IsWindowVisible(dockHwnd);
            List<IntPtr> extrasCopy = null;
            lock (extraHwndsLock) {
              if (extraDockHwnds.Count > 0) extrasCopy = new List<IntPtr>(extraDockHwnds);
            }
            bool anyExtraVis = false;
            if (extrasCopy != null) {
              for (int i = 0; i < extrasCopy.Count; i++) {
                IntPtr eh = extrasCopy[i];
                if (eh != IntPtr.Zero && IsWindow(eh) && IsWindowVisible(eh)) {
                  anyExtraVis = true;
                  break;
                }
              }
            }

            if (!primaryDockVis && !anyExtraVis) {
              // All Glassy docks are hidden (e.g. fullscreen game): skip EnumWindows/DWM completely!
              inFullscreenSleep = true;
            } else {
              POINT origin = new POINT();
              IntPtr primaryMon = MonitorFromPoint(origin, 1);
              int qState;
              bool primaryD3dFs = SHQueryUserNotificationState(out qState) == 0 && (qState == 3 || qState == 4);
              bool primaryFs = primaryDockVis ? IsMonitorShowingFullscreen(primaryMon, primaryMon, primaryD3dFs) : true;
              bool anyFs = primaryFs;

              if (primaryDockVis && !primaryFs) {
                EnforceDockPlacement();
                KeepOnTopIfDemoted(dockHwnd);
                KeepOnTopIfDemoted(islandHwnd);
              }
              if (extrasCopy != null) {
                for (int i = 0; i < extrasCopy.Count; i++) {
                  IntPtr eh = extrasCopy[i];
                  if (eh == IntPtr.Zero || !IsWindow(eh) || !IsWindowVisible(eh)) continue;
                  IntPtr eMon = MonitorFromWindow(eh, 2);
                  bool eFs = eMon != IntPtr.Zero && IsMonitorShowingFullscreen(eMon, primaryMon, primaryD3dFs);
                  if (eFs) {
                    anyFs = true;
                  } else {
                    EnforceExtraDockPlacement(eh);
                    KeepOnTopIfDemoted(eh);
                  }
                }
              }
              inFullscreenSleep = anyFs;
              if (!anyFs) {
                if (taskbarHiddenByUs) {
                  SetAllNativeTaskbarsVisible(false);
                }
                EnforceWorkArea();
              }
            }
          }
        } catch { }
        Thread.Sleep(inFullscreenSleep ? 220 : 140);
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
        if (!IsGlassyWindow(fgPid, currentFg)) {
          activeHwnd = currentFg;
        }
      }

      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        if (!IsTaskbarWindow(hWnd)) return true;

        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (IsGlassyWindow(pid, hWnd)) return true;

        int len = GetWindowTextLength(hWnd);
        StringBuilder sb = new StringBuilder(len + 1);
        GetWindowText(hWnd, sb, sb.Capacity);
        string title = sb.ToString();
        if (string.IsNullOrEmpty(title)) return true;

        ProcMeta meta = GetProcMeta(pid);
        uint effectivePid = pid;
        if (meta.name.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) {
          uint realPid = ResolveRealUwpPid(hWnd, pid);
          if (realPid != pid) {
            ProcMeta realMeta = GetProcMeta(realPid);
            if (!string.IsNullOrEmpty(realMeta.name)) {
              effectivePid = realPid;
              meta = realMeta;
            }
          }
        }
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
        string aumid = GetCachedAumid(effectivePid);
        string winAppId = GetCachedWindowAppId(hWnd);
        string effectiveAppId = !string.IsNullOrEmpty(winAppId) ? winAppId : aumid;
        string displayName = !string.IsNullOrEmpty(meta.exePath)
          ? GetExeDisplayName(meta.exePath, meta.name)
          : meta.name;

        string aumidPart = !string.IsNullOrEmpty(aumid)
          ? ",\"aumid\":\"" + JsonEscape(aumid) + "\""
          : "";
        string appIdPart = !string.IsNullOrEmpty(effectiveAppId)
          ? ",\"appId\":\"" + JsonEscape(effectiveAppId) + "\""
          : "";
        string displayPart = !string.IsNullOrEmpty(displayName)
          ? ",\"displayName\":\"" + JsonEscape(displayName) + "\""
          : "";

        string json = string.Format(
          "{{\"hwnd\":\"{0}\",\"pid\":{1},\"processName\":\"{2}\",\"title\":\"{3}\",\"executablePath\":\"{4}\"{5}{6}{7},\"isMinimized\":{8},\"isActive\":{9}}}",
          hwndNum,
          effectivePid,
          JsonEscape(meta.name),
          JsonEscape(title),
          JsonEscape(meta.exePath),
          aumidPart,
          appIdPart,
          displayPart,
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
        winAppIdCache.Remove(stale[i]);
        maximizedHwnds.Remove(stale[i]);
      }

      entries.Sort(delegate(WinEntry a, WinEntry b) { return a.seq.CompareTo(b.seq); });
      if (entries.Count > 40) entries.RemoveRange(40, entries.Count - 40);

      string[] jsonArr = new string[entries.Count];
      for (int i = 0; i < entries.Count; i++) jsonArr[i] = entries[i].json;
      return "[" + string.Join(",", jsonArr) + "]";
    }

    // Windows of elevated (admin) processes, such as Task Manager, cannot be driven with the
    // regular window calls from a normal process. The answer is cached per process.
    private static readonly Dictionary<uint, bool> protectedProcs = new Dictionary<uint, bool>();
    private static int ownElevation = -1;

    private static bool IsProcessElevated(IntPtr hProc, out bool known) {
      known = false;
      IntPtr token;
      if (!OpenProcessToken(hProc, 0x0008, out token)) return false; // TOKEN_QUERY
      try {
        int elevated;
        int len;
        if (GetTokenInformation(token, 20, out elevated, 4, out len)) { // TokenElevation
          known = true;
          return elevated != 0;
        }
      } finally {
        CloseHandle(token);
      }
      return false;
    }

    private static bool IsProtectedWindow(IntPtr hWnd) {
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      if (pid == 0) return false;
      bool cached;
      lock (protectedProcs) {
        if (protectedProcs.TryGetValue(pid, out cached)) return cached;
      }

      if (ownElevation < 0) {
        bool ownKnown;
        bool own = IsProcessElevated(Process.GetCurrentProcess().Handle, out ownKnown);
        ownElevation = ownKnown && own ? 1 : 0;
      }

      bool isProtected = false;
      IntPtr hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (int)pid);
      if (hProc == IntPtr.Zero) {
        // Cannot even open it: it is more privileged than we are
        isProtected = ownElevation == 0;
      } else {
        try {
          bool known;
          bool elevated = IsProcessElevated(hProc, out known);
          if (known) {
            isProtected = elevated && ownElevation == 0;
          } else {
            isProtected = ownElevation == 0;
          }
        } finally {
          CloseHandle(hProc);
        }
      }
      lock (protectedProcs) {
        if (protectedProcs.Count > 256) protectedProcs.Clear();
        protectedProcs[pid] = isProtected;
      }
      return isProtected;
    }

    private static bool IsFullscreenWindowOnMonitor(IntPtr hWnd, IntPtr targetMonitor) {
      if (hWnd == IntPtr.Zero || targetMonitor == IntPtr.Zero || !IsWindowVisible(hWnd) || IsIconic(hWnd)) return false;
      if (IsCloaked(hWnd)) return false;

      int ex = GetWindowLong(hWnd, GWL_EXSTYLE);
      if ((ex & 0x00000020) != 0) return false; // WS_EX_TRANSPARENT (NVIDIA/Discord/Xbox overlays)
      if ((ex & WS_EX_NOACTIVATE) != 0) return false;
      if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return false;

      StringBuilder cls = new StringBuilder(64);
      GetClassName(hWnd, cls, cls.Capacity);
      string clsName = cls.ToString();
      if (clsName == "Progman" || clsName == "WorkerW" || clsName == "Shell_TrayWnd" ||
          clsName == "Shell_SecondaryTrayWnd" || clsName == "Windows.UI.Core.CoreWindow") {
        return false;
      }

      IntPtr monitor = MonitorFromWindow(hWnd, 2); // MONITOR_DEFAULTTONEAREST
      if (monitor == IntPtr.Zero || monitor != targetMonitor) return false;

      MONITORINFO mi = new MONITORINFO();
      mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      RECT r;
      if (!GetMonitorInfo(monitor, ref mi) || !GetVisibleWindowRect(hWnd, out r)) return false;

      // Allow +-2px tolerance for borderless game engines / DWM frame rounding
      bool covers = r.left <= mi.rcMonitor.left + 2 && r.top <= mi.rcMonitor.top + 2 &&
                    r.right >= mi.rcMonitor.right - 2 && r.bottom >= mi.rcMonitor.bottom - 2;
      if (!covers) return false;

      bool hasCaption = (GetWindowLong(hWnd, GWL_STYLE) & 0x00C00000) == 0x00C00000; // WS_CAPTION
      if (!hasCaption || !IsZoomed(hWnd)) return true;

      // During the brief 1.5s settle window right after Glassy changes work area, a normal
      // maximized window might still be resizing from the old work area — never misclassify it.
      int sinceWa = unchecked(Environment.TickCount - lastWorkAreaChangeAt);
      if (lastWorkAreaChangeAt != 0 && sinceWa >= 0 && sinceWa < 1500) return false;

      // True fullscreen video/browser (YouTube F11, VLC, UWP) covers the entire monitor edge-to-edge
      // past rcWork even if Chromium/UWP kept WS_CAPTION + IsZoomed.
      bool exceedsWorkArea =
        ((mi.rcMonitor.bottom - mi.rcWork.bottom) >= 24 && r.bottom >= mi.rcMonitor.bottom - 2) ||
        ((mi.rcWork.top - mi.rcMonitor.top) >= 24 && r.top <= mi.rcMonitor.top + 2);
      return exceedsWorkArea;
    }

    // Finds the topmost real visible application window on a specific monitor by walking Z-order
    // from front to back. This keeps Monitor 1's dock hidden while a fullscreen game/video sits on
    // Monitor 1 even when the user clicks Discord/Browser on Monitor 2, while ignoring transparent
    // overlays (NVIDIA, Discord, Xbox Game Bar) and Glassy itself.
    private static IntPtr GetTopmostRealWindowOnMonitor(IntPtr targetMonitor) {
      if (targetMonitor == IntPtr.Zero) return IntPtr.Zero;
      IntPtr topWin = IntPtr.Zero;
      EnumWindows(delegate(IntPtr hWnd, IntPtr lp) {
        if (!IsWindowVisible(hWnd) || IsIconic(hWnd) || IsCloaked(hWnd)) return true;
        int ex = GetWindowLong(hWnd, GWL_EXSTYLE);
        if ((ex & 0x00000020) != 0) return true; // WS_EX_TRANSPARENT overlay
        if ((ex & WS_EX_NOACTIVATE) != 0) return true;
        if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return true;
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (IsGlassyWindow(pid, hWnd)) return true;
        StringBuilder cls = new StringBuilder(64);
        GetClassName(hWnd, cls, cls.Capacity);
        string clsName = cls.ToString();
        if (clsName == "Progman" || clsName == "WorkerW" || clsName == "Shell_TrayWnd" ||
            clsName == "Shell_SecondaryTrayWnd" || clsName == "Windows.UI.Core.CoreWindow") {
          return true;
        }
        RECT rc;
        if (!GetWindowRect(hWnd, out rc)) return true;
        if ((rc.right - rc.left) < 120 || (rc.bottom - rc.top) < 80) return true;
        if (MonitorFromWindow(hWnd, 2) != targetMonitor) return true;
        topWin = hWnd;
        return false; // Stop at the very first (topmost) real app window on this monitor
      }, IntPtr.Zero);
      return topWin;
    }

    private static bool IsMonitorShowingFullscreen(IntPtr monitor, IntPtr primaryMon, bool primaryD3dFs) {
      if (monitor == IntPtr.Zero) return false;

      // If the user pressed the Windows key (Start Menu / Search) or is interacting with Glassy
      // on this monitor, NEVER suppress the dock even if a borderless fullscreen game sits behind it!
      if (IsShellOverlayForegroundOnMonitor(monitor)) return false;

      // O(1) fast-path: during active fullscreen gameplay, GetForegroundWindow() IS the game itself.
      // Checking it directly avoids walking EnumWindows + DwmGetWindowAttribute over 300+ windows,
      // eliminating DWM frame-pacing stutters and CPU overhead during games!
      IntPtr fg = GetForegroundWindow();
      if (fg != IntPtr.Zero) {
        IntPtr fgMon = MonitorFromWindow(fg, 2);
        if (fgMon == monitor) {
          uint fgPid;
          GetWindowThreadProcessId(fg, out fgPid);
          if (!IsGlassyWindow(fgPid, fg)) {
            if (IsFullscreenWindowOnMonitor(fg, monitor)) return true;
            if (monitor == primaryMon && primaryD3dFs) return true;
            // A normal non-fullscreen app is foreground on this monitor: monitor is NOT fullscreen
            if (IsTaskbarWindow(fg)) return false;
          }
        }
      }

      // Only fall back to Z-order EnumWindows when foreground is on another monitor (e.g. clicking
      // Discord on Monitor 2 while a fullscreen game/video remains visible on Monitor 1).
      IntPtr topWin = GetTopmostRealWindowOnMonitor(monitor);
      if (topWin != IntPtr.Zero && IsFullscreenWindowOnMonitor(topWin, monitor)) return true;
      if (monitor == primaryMon && primaryD3dFs && topWin == IntPtr.Zero) return true;
      return false;
    }

    private static bool IsAnyMonitorFullscreen() {
      int qState;
      bool primaryD3dFs = SHQueryUserNotificationState(out qState) == 0 && (qState == 3 || qState == 4);
      if (primaryD3dFs) return true;

      POINT origin = new POINT();
      IntPtr primaryMon = MonitorFromPoint(origin, 1);
      if (IsMonitorShowingFullscreen(primaryMon, primaryMon, false)) return true;

      List<IntPtr> extras = null;
      lock (extraHwndsLock) {
        if (extraDockHwnds.Count > 0) extras = new List<IntPtr>(extraDockHwnds);
      }
      if (extras != null) {
        for (int i = 0; i < extras.Count; i++) {
          IntPtr eh = extras[i];
          if (eh == IntPtr.Zero || !IsWindow(eh)) continue;
          IntPtr mon = MonitorFromWindow(eh, 2);
          if (mon != IntPtr.Zero && mon != primaryMon && IsMonitorShowingFullscreen(mon, primaryMon, false)) {
            return true;
          }
        }
      }
      return false;
    }

    private static bool IsFullscreenWindow(IntPtr hWnd) {
      POINT origin = new POINT();
      IntPtr dockMonitor = dockHwnd != IntPtr.Zero
        ? MonitorFromWindow(dockHwnd, 2)
        : MonitorFromPoint(origin, 1); // MONITOR_DEFAULTTOPRIMARY
      return IsFullscreenWindowOnMonitor(hWnd, dockMonitor);
    }

    // Returns "1" = fullscreen (hide), "2" = Win/Start overlay active (wake immediately), "0" = normal desktop
    private static string FullscreenCodeForMonitor(IntPtr mon, IntPtr primaryMon, bool primaryD3dFs) {
      if (mon == IntPtr.Zero) return "0";
      if (IsShellOverlayForegroundOnMonitor(mon)) return "2";
      return IsMonitorShowingFullscreen(mon, primaryMon, primaryD3dFs) ? "1" : "0";
    }

    private static string CheckFullscreenForHwnds(string csv) {
      if (string.IsNullOrWhiteSpace(csv)) return "";
      POINT origin = new POINT();
      IntPtr primaryMon = MonitorFromPoint(origin, 1);
      int qState;
      bool primaryD3dFs = SHQueryUserNotificationState(out qState) == 0 && (qState == 3 || qState == 4);

      string[] parts = csv.Split(',');
      string[] results = new string[parts.Length];
      for (int i = 0; i < parts.Length; i++) {
        long hv;
        if (!long.TryParse(parts[i].Trim(), out hv) || hv == 0) {
          results[i] = "0";
          continue;
        }
        IntPtr h = new IntPtr(hv);
        IntPtr mon = MonitorFromWindow(h, 2);
        results[i] = FullscreenCodeForMonitor(mon, primaryMon, primaryD3dFs);
      }
      return string.Join(",", results);
    }

    // "1" = primary monitor fullscreen, "2" = Win/Start overlay active (wake instantly), "0" = normal
    private static string GetPrimaryFullscreenCode() {
      POINT origin = new POINT();
      IntPtr primaryMon = MonitorFromPoint(origin, 1);
      IntPtr dockMon = dockHwnd != IntPtr.Zero ? MonitorFromWindow(dockHwnd, 2) : primaryMon;
      int qState;
      bool primaryD3dFs = SHQueryUserNotificationState(out qState) == 0 && (qState == 3 || qState == 4);
      return FullscreenCodeForMonitor(dockMon, primaryMon, primaryD3dFs);
    }

    private static bool IsForegroundTarget(IntPtr hWnd) {
      IntPtr fg = GetForegroundWindow();
      if (fg == hWnd) return true;
      return fg != IntPtr.Zero && GetAncestor(fg, 3) == hWnd; // GA_ROOTOWNER
    }

    private delegate bool Condition();

    // Polls a cheap condition for at most maxMs; returns as soon as it holds (usually at once)
    private static bool WaitUntil(Condition cond, int maxMs) {
      int waited = 0;
      while (true) {
        if (cond()) return true;
        if (waited >= maxMs) return false;
        Thread.Sleep(4);
        waited += 4;
      }
    }

    private static void RestoreIfMinimized(IntPtr hWnd) {
      if (!IsIconic(hWnd)) return;
      Condition restored = delegate() { return !IsIconic(hWnd); };
      if (IsProtectedWindow(hWnd)) {
        // Straight to the call that works for them; it restores and activates in one go
        SwitchToThisWindow(hWnd, true);
        if (WaitUntil(restored, 150)) return;
      }
      long hwndKey = hWnd.ToInt64();
      // Preserve exact prior state: ONLY restore if genuinely minimized (never touch non-minimized bounds)
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
      if (WaitUntil(restored, 60)) return;

      // Elevated windows silently ignore ShowWindowAsync; a WM_SYSCOMMAND still gets through
      IntPtr res;
      SendMessageTimeoutRaw(hWnd, WM_SYSCOMMAND, new IntPtr(SC_RESTORE), IntPtr.Zero, SMTO_ABORTIFHUNG, 200, out res);
      if (WaitUntil(restored, 40)) return;

      SwitchToThisWindow(hWnd, true);
      WaitUntil(restored, 150);
    }

    // Brings the window to the front and reports whether it really got there.
    // Works reliably for multi-window apps (VS Code #1 <-> #2), minimized apps, and elevated
    // windows (Task Manager) even when called from our helper daemon process.
    private static bool ForceFocus(IntPtr hWnd) {
      RestoreIfMinimized(hWnd);

      // If the app has a visible modal dialog/popup open (e.g. Save As, Preferences), focus that
      // popup rather than the disabled owner window, which Windows refuses to activate directly.
      IntPtr target = hWnd;
      IntPtr popup = GetLastActivePopup(hWnd);
      if (popup != IntPtr.Zero && popup != hWnd && IsWindowVisible(popup) && !IsIconic(popup)) {
        target = popup;
      }

      AllowSetForegroundWindow(-1);
      if (IsForegroundTarget(hWnd)) return true;

      Condition isFront = delegate() { return IsForegroundTarget(hWnd); };
      bool targetProtected = IsProtectedWindow(target);

      // 1) Fast direct path (succeeds immediately if we already hold foreground rights)
      BringWindowToTop(target);
      if (SetForegroundWindow(target) && WaitUntil(isFront, 16)) return true;

      // 2) Attach our message-queued thread to the current foreground thread (typically our own
      // dockWindow which just received the user's click!) so we inherit its foreground lock.
      IntPtr fg = GetForegroundWindow();
      uint dummy;
      uint curThread = GetCurrentThreadId();
      uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;
      uint targetThread = GetWindowThreadProcessId(target, out dummy);

      bool attachedFg = fgThread != 0 && fgThread != curThread && AttachThreadInput(curThread, fgThread, true);
      bool attachedTarget = !targetProtected && targetThread != 0 && targetThread != curThread && targetThread != fgThread &&
                            AttachThreadInput(curThread, targetThread, true);
      try {
        AllowSetForegroundWindow(-1);
        SetWindowPos(target, IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040); // HWND_TOP | NOSIZE | NOMOVE | SHOWWINDOW
        BringWindowToTop(target);
        SetForegroundWindow(target);
      } finally {
        if (attachedTarget) AttachThreadInput(curThread, targetThread, false);
        if (attachedFg) AttachThreadInput(curThread, fgThread, false);
      }
      if (WaitUntil(isFront, 28)) return true;

      // 3) Last resort (same call Alt+Tab makes): handles elevated windows (Task Manager) &
      // fullscreen games without synthesizing any Alt keyboard events that could interfere with
      // AR/EN keyboard layouts or app menus during rapid switching.
      SwitchToThisWindow(target, true);
      return WaitUntil(isFront, targetProtected ? 140 : 180);
    }

    private static bool MinimizeWindow(IntPtr hWnd) {
      Condition minimized = delegate() { return IsIconic(hWnd); };
      IntPtr res;
      if (IsProtectedWindow(hWnd)) {
        SendMessageTimeoutRaw(hWnd, WM_SYSCOMMAND, new IntPtr(SC_MINIMIZE), IntPtr.Zero, SMTO_ABORTIFHUNG, 200, out res);
        if (WaitUntil(minimized, 60)) return true;
      }
      ShowWindowAsync(hWnd, 6); // SW_MINIMIZE
      if (WaitUntil(minimized, 40)) return true;
      SendMessageTimeoutRaw(hWnd, WM_SYSCOMMAND, new IntPtr(SC_MINIMIZE), IntPtr.Zero, SMTO_ABORTIFHUNG, 200, out res);
      return WaitUntil(minimized, 60);
    }

    private static string ToggleWindow(long hwndVal) {
      StopLivePeek(true);
      ClearLiveThumbs();
      IntPtr hWnd = new IntPtr(hwndVal);
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return "gone";

      IntPtr fg = GetForegroundWindow();
      bool dockHasFocus = fg == IntPtr.Zero || fg == dockHwnd || fg == islandHwnd || IsExtraDockHwnd(fg);
      bool isTargetActive =
        !IsIconic(hWnd) &&
        (IsForegroundTarget(hWnd) || (dockHasFocus && hWnd == lastExternalForeground));

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
        SnapshotThumbIfStale(hWnd, 1500);
        if (MinimizeWindow(hWnd)) {
          if (lastExternalForeground == hWnd) {
            lastExternalForeground = IntPtr.Zero;
          }
          return "minimized";
        }
        // Could not minimize it (it is not ours to control): make sure it is at least in front
        maximizedHwnds.Remove(hwndVal);
        if (ForceFocus(hWnd)) {
          lastExternalForeground = hWnd;
          return "focused";
        }
        return IsWindow(hWnd) ? "attempted" : "gone";
      } else {
        if (ForceFocus(hWnd)) {
          lastExternalForeground = hWnd;
          return "focused";
        }
        // Window is still alive (e.g. elevated game or slow fullscreen restore) — never tell the
        // caller to spawn a duplicate copy while the window still exists.
        return IsWindow(hWnd) ? "attempted" : "gone";
      }
    }

    private static string ActivateWindow(long hwndVal) {
      StopLivePeek(true);
      ClearLiveThumbs();
      IntPtr hWnd = new IntPtr(hwndVal);
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return "gone";
      if (ForceFocus(hWnd)) {
        lastExternalForeground = hWnd;
        return "focused";
      }
      return IsWindow(hWnd) ? "attempted" : "gone";
    }

    private static IntPtr PeekOverlayWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam) {
      // Belt-and-suspenders click-through: never intercept mouse hover, clicks, or cursor
      if (msg == 0x0084) { // WM_NCHITTEST
        return new IntPtr(-1); // HTTRANSPARENT
      }
      if (msg == 0x0021) { // WM_MOUSEACTIVATE
        return new IntPtr(3); // MA_NOACTIVATE
      }
      if (msg == WM_PEEK_START) {
        ApplyLivePeekOnThread(hWnd, wParam);
        return IntPtr.Zero;
      }
      if (msg == WM_PEEK_STOP) {
        ClearLivePeekOnThread(hWnd);
        return IntPtr.Zero;
      }
      if (msg == WM_THUMBS_SYNC) {
        SyncLiveThumbsOnThread();
        return IntPtr.Zero;
      }
      if (msg == WM_THUMBS_CLEAR) {
        ClearLiveThumbsOnThread();
        return IntPtr.Zero;
      }
      return DefWindowProc(hWnd, msg, wParam, lParam);
    }

    private static void ClearLiveThumbSlot(int i) {
      if (i < liveThumbHandles.Count && liveThumbHandles[i] != IntPtr.Zero) {
        try { DwmUnregisterThumbnail(liveThumbHandles[i]); } catch { }
        liveThumbHandles[i] = IntPtr.Zero;
      }
      if (i < liveThumbSig.Count) liveThumbSig[i] = "";
      if (i < liveThumbPool.Count && liveThumbPool[i] != IntPtr.Zero) {
        ShowWindow(liveThumbPool[i], 0); // SW_HIDE
      }
    }

    private static void ClearLiveThumbsOnThread() {
      for (int i = 0; i < liveThumbPool.Count; i++) {
        ClearLiveThumbSlot(i);
      }
    }

    private static void RaiseLiveThumbsAboveDock() {
      for (int i = 0; i < liveThumbPool.Count; i++) {
        IntPtr th = liveThumbPool[i];
        if (th != IntPtr.Zero && IsWindowVisible(th)) {
          SetWindowPos(th, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
        }
      }
    }

    private static void SyncLiveThumbsOnThread() {
      List<LiveThumbSpec> specs;
      lock (liveThumbLock) {
        specs = new List<LiveThumbSpec>(pendingThumbSpecs);
      }
      if (specs.Count == 0) {
        ClearLiveThumbsOnThread();
        return;
      }

      IntPtr hInst = GetModuleHandle(null);
      int count = Math.Min(specs.Count, 12);
      // WS_EX_LAYERED (0x80000) + WS_EX_TRANSPARENT (0x20) is REQUIRED by Win32 for true
      // click-through at the compositor level so mouse hovers/clicks pass cleanly to Electron!
      const uint OVERLAY_EX_STYLE = 0x080800A8u; // TOOLWINDOW | NOACTIVATE | LAYERED | TRANSPARENT | TOPMOST
      while (liveThumbPool.Count < count) {
        IntPtr w = CreateWindowEx(
          OVERLAY_EX_STYLE,
          "GlassyLiveThumbSlot",
          "",
          0x80000000u, // WS_POPUP
          0, 0, 1, 1,
          IntPtr.Zero, IntPtr.Zero, hInst, IntPtr.Zero
        );
        if (w == IntPtr.Zero) break;
        SetLayeredWindowAttributes(w, 0, 255, 2); // LWA_ALPHA = 255 (opaque live DWM surface, 100% click-through)
        liveThumbPool.Add(w);
        liveThumbHandles.Add(IntPtr.Zero);
        liveThumbSig.Add("");
        lock (liveThumbLock) {
          liveThumbHwndSet.Add(w);
        }
      }

      // Hide any surplus pool slots no longer needed
      for (int i = count; i < liveThumbPool.Count; i++) {
        ClearLiveThumbSlot(i);
      }

      for (int i = 0; i < count && i < liveThumbPool.Count; i++) {
        LiveThumbSpec sp = specs[i];
        IntPtr target = new IntPtr(sp.targetHwnd);
        if (target == IntPtr.Zero || !IsWindow(target) || sp.w < 16 || sp.h < 16) {
          ClearLiveThumbSlot(i);
          continue;
        }

        int sx = sp.screenX;
        int sy = sp.screenY;
        bool targetMin = IsIconic(target);
        string sig = sp.targetHwnd + ":" + sx + "," + sy + "," + sp.w + "," + sp.h + ":" + (targetMin ? 1 : 0);

        // Already showing this exact live thumbnail at this exact pixel rect: skip tear-down (0 flicker!)
        if (liveThumbSig[i] == sig && liveThumbHandles[i] != IntPtr.Zero && IsWindowVisible(liveThumbPool[i])) {
          continue;
        }

        ClearLiveThumbSlot(i);

        IntPtr slotWin = liveThumbPool[i];
        IntPtr hThumb;
        if (DwmRegisterThumbnail(slotWin, target, out hThumb) != 0 || hThumb == IntPtr.Zero) continue;

        SIZE srcSize;
        if (DwmQueryThumbnailSourceSize(hThumb, out srcSize) != 0 || srcSize.cx <= 0 || srcSize.cy <= 0) {
          try { DwmUnregisterThumbnail(hThumb); } catch { }
          continue;
        }
        // Minimized windows whose DWM surface collapsed to a tiny caption stub should fall back
        // to the HTML card's cached full-window snapshot instead of drawing a tiny title bar.
        if (targetMin && (srcSize.cx < 200 || srcSize.cy < 120)) {
          try { DwmUnregisterThumbnail(hThumb); } catch { }
          continue;
        }

        double scale = Math.Min((double)sp.w / srcSize.cx, (double)sp.h / srcSize.cy);
        int dw = Math.Max(1, (int)Math.Round(srcSize.cx * scale));
        int dh = Math.Max(1, (int)Math.Round(srcSize.cy * scale));
        int dx = (sp.w - dw) / 2;
        int dy = (sp.h - dh) / 2;

        liveThumbHandles[i] = hThumb;
        liveThumbSig[i] = sig;
        DWM_THUMBNAIL_PROPERTIES props = new DWM_THUMBNAIL_PROPERTIES {
          dwFlags = 0x0001 | 0x0004 | 0x0008, // DWM_TNP_RECTDESTINATION | DWM_TNP_OPACITY | DWM_TNP_VISIBLE
          rcDestination = new RECT { left = dx, top = dy, right = dx + dw, bottom = dy + dh },
          opacity = 255,
          fVisible = true
        };
        DwmUpdateThumbnailProperties(hThumb, ref props);

        int r = Math.Max(0, sp.radius) * 2;
        IntPtr rgn = CreateRoundRectRgn(0, 0, sp.w + 1, sp.h + 1, r, r);
        if (rgn != IntPtr.Zero) {
          SetWindowRgn(slotWin, rgn, false);
        }

        SetWindowPos(slotWin, new IntPtr(-1), sx, sy, sp.w, sp.h, 0x0010 | 0x0040); // SWP_NOACTIVATE | SWP_SHOWWINDOW
      }
    }

    private static void ClearLivePeekOnThread(IntPtr overlay) {
      if (activePeekThumb != IntPtr.Zero) {
        try { DwmUnregisterThumbnail(activePeekThumb); } catch { }
        activePeekThumb = IntPtr.Zero;
      }
      if (overlay != IntPtr.Zero) {
        ShowWindow(overlay, 0); // SW_HIDE
      }
    }

    private static void ApplyLivePeekOnThread(IntPtr overlay, IntPtr targetHwnd) {
      ClearLivePeekOnThread(overlay);
      if (overlay == IntPtr.Zero || targetHwnd == IntPtr.Zero || !IsWindow(targetHwnd)) return;

      bool targetMin = IsIconic(targetHwnd);
      // Already visible in front on screen: no need to paint a redundant topmost overlay over it
      if (!targetMin && targetHwnd == lastExternalForeground) return;

      IntPtr hThumb;
      if (DwmRegisterThumbnail(overlay, targetHwnd, out hThumb) != 0 || hThumb == IntPtr.Zero) return;

      SIZE srcSize;
      if (DwmQueryThumbnailSourceSize(hThumb, out srcSize) != 0 || srcSize.cx <= 0 || srcSize.cy <= 0) {
        try { DwmUnregisterThumbnail(hThumb); } catch { }
        return;
      }
      // Never stretch a minimized caption-bar stub across the whole screen
      if (targetMin && (srcSize.cx < 200 || srcSize.cy < 120)) {
        try { DwmUnregisterThumbnail(hThumb); } catch { }
        return;
      }

      RECT rc;
      if (!targetMin) {
        if (!GetWindowRect(targetHwnd, out rc)) {
          try { DwmUnregisterThumbnail(hThumb); } catch { }
          return;
        }
      } else {
        WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
        wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
        if (!GetWindowPlacement(targetHwnd, ref wp)) {
          try { DwmUnregisterThumbnail(hThumb); } catch { }
          return;
        }
        bool wasMax = (wp.flags & 0x0002) != 0 || maximizedHwnds.Contains(targetHwnd.ToInt64());
        if (wasMax) {
          IntPtr mon = MonitorFromWindow(targetHwnd, 2);
          MONITORINFO mi = new MONITORINFO();
          mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
          if (mon != IntPtr.Zero && GetMonitorInfo(mon, ref mi)) {
            rc = mi.rcWork;
          } else {
            rc = wp.rcNormalPosition;
          }
        } else {
          rc = wp.rcNormalPosition;
        }
      }

      int w = rc.right - rc.left;
      int h = rc.bottom - rc.top;
      if (w < 80 || h < 60) {
        try { DwmUnregisterThumbnail(hThumb); } catch { }
        return;
      }

      activePeekThumb = hThumb;
      DWM_THUMBNAIL_PROPERTIES props = new DWM_THUMBNAIL_PROPERTIES {
        dwFlags = 0x0001 | 0x0004 | 0x0008, // DWM_TNP_RECTDESTINATION | DWM_TNP_OPACITY | DWM_TNP_VISIBLE
        rcDestination = new RECT { left = 0, top = 0, right = w, bottom = h },
        opacity = 255,
        fVisible = true
      };
      DwmUpdateThumbnailProperties(hThumb, ref props);

      // Show overlay topmost without activating, then keep Glassy dock & preview card above it
      SetWindowPos(overlay, new IntPtr(-1), rc.left, rc.top, w, h, 0x0010 | 0x0040); // SWP_NOACTIVATE | SWP_SHOWWINDOW
      if (dockHwnd != IntPtr.Zero && IsWindow(dockHwnd)) {
        SetWindowPos(dockHwnd, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
      }
      lock (extraHwndsLock) {
        for (int i = 0; i < extraDockHwnds.Count; i++) {
          IntPtr eh = extraDockHwnds[i];
          if (eh != IntPtr.Zero && IsWindow(eh)) {
            SetWindowPos(eh, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
          }
        }
      }
      RaiseLiveThumbsAboveDock();
    }

    private static void PeekOverlayLoop() {
      try {
        peekWndProcRef = new WndProcDelegate(PeekOverlayWndProc);
        IntPtr hInst = GetModuleHandle(null);
        liveThumbBrush = CreateSolidBrush(0x00141416u);
        WNDCLASSEX wc = new WNDCLASSEX {
          cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX)),
          lpfnWndProc = Marshal.GetFunctionPointerForDelegate(peekWndProcRef),
          hInstance = hInst,
          lpszClassName = "GlassyLivePeekOverlay"
        };
        RegisterClassEx(ref wc);

        WNDCLASSEX tc = new WNDCLASSEX {
          cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX)),
          lpfnWndProc = Marshal.GetFunctionPointerForDelegate(peekWndProcRef),
          hInstance = hInst,
          hbrBackground = liveThumbBrush,
          lpszClassName = "GlassyLiveThumbSlot"
        };
        RegisterClassEx(ref tc);
        // WS_POPUP (0x80000000), WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST
        IntPtr h = CreateWindowEx(
          0x080800A8u,
          "GlassyLivePeekOverlay",
          "",
          0x80000000u,
          0, 0, 1, 1,
          IntPtr.Zero, IntPtr.Zero, hInst, IntPtr.Zero
        );
        peekOverlayHwnd = h;
        if (h == IntPtr.Zero) return;
        SetLayeredWindowAttributes(h, 0, 255, 2); // LWA_ALPHA = 255 so WS_EX_TRANSPARENT is 100% click-through
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
          TranslateMessage(ref msg);
          DispatchMessage(ref msg);
        }
      } catch { }
    }

    private static void StartLivePeek(long hwndVal) {
      IntPtr ov = peekOverlayHwnd;
      if (ov != IntPtr.Zero && hwndVal != 0) {
        PostMessage(ov, WM_PEEK_START, new IntPtr(hwndVal), IntPtr.Zero);
      }
    }

    private static void StopLivePeek(bool sync = false) {
      IntPtr ov = peekOverlayHwnd;
      if (ov == IntPtr.Zero) return;
      if (sync) {
        IntPtr res;
        SendMessageTimeoutRaw(ov, WM_PEEK_STOP, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, 60, out res);
      } else {
        PostMessage(ov, WM_PEEK_STOP, IntPtr.Zero, IntPtr.Zero);
      }
    }

    private static void SetLiveThumbs(string payload) {
      IntPtr ov = peekOverlayHwnd;
      if (ov == IntPtr.Zero) return;
      List<LiveThumbSpec> list = new List<LiveThumbSpec>();
      if (!string.IsNullOrWhiteSpace(payload)) {
        string[] items = payload.Trim().Split(';');
        for (int i = 0; i < items.Length; i++) {
          string[] f = items[i].Split(',');
          if (f.Length >= 5) {
            long th;
            int sx, sy, w, h, rad = 7;
            if (long.TryParse(f[0], out th) &&
                int.TryParse(f[1], out sx) &&
                int.TryParse(f[2], out sy) &&
                int.TryParse(f[3], out w) &&
                int.TryParse(f[4], out h)) {
              if (f.Length >= 6) int.TryParse(f[5], out rad);
              list.Add(new LiveThumbSpec { targetHwnd = th, screenX = sx, screenY = sy, w = w, h = h, radius = rad });
            }
          }
        }
      }
      lock (liveThumbLock) {
        pendingThumbSpecs = list;
      }
      PostMessage(ov, WM_THUMBS_SYNC, IntPtr.Zero, IntPtr.Zero);
    }

    private static void ClearLiveThumbs() {
      IntPtr ov = peekOverlayHwnd;
      if (ov == IntPtr.Zero) return;
      lock (liveThumbLock) {
        pendingThumbSpecs = new List<LiveThumbSpec>();
      }
      PostMessage(ov, WM_THUMBS_CLEAR, IntPtr.Zero, IntPtr.Zero);
    }

    private static string CloseWindowByHwnd(long hwndVal) {
      IntPtr hWnd = new IntPtr(hwndVal);
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return "false";
      bool sent = false;
      if (IsProtectedWindow(hWnd)) {
        // Elevated windows reject a posted WM_CLOSE; the system-menu close is let through
        IntPtr res;
        sent = SendMessageTimeoutRaw(hWnd, WM_SYSCOMMAND, new IntPtr(SC_CLOSE), IntPtr.Zero, SMTO_ABORTIFHUNG, 250, out res) != IntPtr.Zero;
      }
      if (!sent) sent = PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
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
        "glassy", "win32bridge", "electron", "crashhandler", "crashpad", "msedgewebview2",
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

    private static string ResolveKnownFolderPath(string rawPath) {
      if (string.IsNullOrEmpty(rawPath)) return "";
      string p = rawPath.Trim();
      if (p.Length > 38 && p[0] == '{' && p[37] == '}') {
        Guid g;
        if (Guid.TryParse(p.Substring(1, 36), out g)) {
          IntPtr ptr = IntPtr.Zero;
          try {
            if (SHGetKnownFolderPath(ref g, 0, IntPtr.Zero, out ptr) == 0 && ptr != IntPtr.Zero) {
              string folder = Marshal.PtrToStringUni(ptr);
              if (!string.IsNullOrEmpty(folder)) {
                string rest = p.Substring(38).TrimStart('\\', '/');
                p = Path.Combine(folder, rest);
              }
            }
          } catch {
          } finally {
            if (ptr != IntPtr.Zero) CoTaskMemFree(ptr);
          }
        }
      }
      return p.Replace('/', '\\');
    }

    private static string CleanTrayTooltip(string tip) {
      if (string.IsNullOrWhiteSpace(tip)) return "";
      // Strip Unicode directional marks (LRE/PDF/LRM/RLM) Windows sometimes embeds in tray tooltips
      StringBuilder sb = new StringBuilder(tip.Length);
      for (int i = 0; i < tip.Length; i++) {
        char c = tip[i];
        if (c == '\r' || c == '\n') break;
        if (c >= 0x200E && c <= 0x202E) continue;
        sb.Append(c);
      }
      string clean = sb.ToString().Trim();
      if (clean.Length == 0 || clean.Length > 42) return "";
      return clean;
    }

    // Windows 11 records every app that registered a real Notification Area (system tray) icon
    // under HKCU\Control Panel\NotifyIconSettings. Intersecting this with running user processes
    // gives the exact Windows tray overflow list without non-tray windows or headless helpers.
    private static Dictionary<string, string> GetRegisteredTrayIconExes() {
      Dictionary<string, string> map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      try {
        using (RegistryKey root = Registry.CurrentUser.OpenSubKey(@"Control Panel\NotifyIconSettings", false)) {
          if (root == null) return map;
          string[] subNames = root.GetSubKeyNames();
          for (int i = 0; i < subNames.Length; i++) {
            try {
              using (RegistryKey sub = root.OpenSubKey(subNames[i], false)) {
                if (sub == null) continue;
                string rawExe = sub.GetValue("ExecutablePath") as string;
                if (string.IsNullOrWhiteSpace(rawExe)) continue;
                string resolved = ResolveKnownFolderPath(rawExe);
                if (string.IsNullOrEmpty(resolved)) continue;
                string fileName = Path.GetFileName(resolved).ToLowerInvariant();
                if (fileName == "explorer.exe" || fileName == "taskmgr.exe" ||
                    fileName == "monotificationux.exe" || fileName == "glassy.exe" ||
                    fileName == "electron.exe" || fileName == "shellexperiencehost.exe") {
                  continue;
                }
                string tip = CleanTrayTooltip(sub.GetValue("InitialTooltip") as string);
                string existing;
                if (!map.TryGetValue(resolved, out existing) || (string.IsNullOrEmpty(existing) && !string.IsNullOrEmpty(tip))) {
                  map[resolved] = tip;
                }
              }
            } catch { }
          }
        }
      } catch { }
      return map;
    }

    private static string ListBackgroundAppsJson() {
      int mySession = Process.GetCurrentProcess().SessionId;
      Dictionary<string, string> byExe = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      HashSet<string> seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

      Dictionary<string, string> registeredTray = GetRegisteredTrayIconExes();
      if (registeredTray.Count > 0) {
        HashSet<string> registeredNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string exe in registeredTray.Keys) {
          string baseName = Path.GetFileNameWithoutExtension(exe);
          if (!string.IsNullOrEmpty(baseName)) registeredNames.Add(baseName);
        }

        Process[] procs = Process.GetProcesses();
        for (int i = 0; i < procs.Length; i++) {
          Process p = procs[i];
          try {
            if (!registeredNames.Contains(p.ProcessName)) continue;
            if (p.SessionId != mySession) continue;
            uint pid = (uint)p.Id;
            ProcMeta meta = GetProcMeta(pid);
            if (string.IsNullOrEmpty(meta.exePath)) continue;
            if (IsGlassyWindow(pid, IntPtr.Zero)) continue;

            string tip;
            if (!registeredTray.TryGetValue(meta.exePath, out tip)) continue;
            if (byExe.ContainsKey(meta.exePath)) continue;
            if (!string.IsNullOrEmpty(meta.name) && !seenNames.Add(meta.name)) continue;

            string displayName = !string.IsNullOrEmpty(tip) ? tip : "";
            if (string.IsNullOrEmpty(displayName) &&
                meta.name.Equals("SecurityHealthSystray", StringComparison.OrdinalIgnoreCase)) {
              displayName = "Windows Security";
            }
            if (string.IsNullOrEmpty(displayName)) {
              displayName = GetExeDisplayName(meta.exePath, meta.name);
            }
            string aumid = GetCachedAumid(pid);
            string aumidPart = !string.IsNullOrEmpty(aumid)
              ? ",\"aumid\":\"" + JsonEscape(aumid) + "\""
              : "";

            byExe[meta.exePath] = string.Format(
              "{{\"pid\":{0},\"processName\":\"{1}\",\"displayName\":\"{2}\",\"executablePath\":\"{3}\"{4}}}",
              pid,
              JsonEscape(meta.name),
              JsonEscape(displayName),
              JsonEscape(meta.exePath),
              aumidPart
            );
            if (byExe.Count >= 24) break;
          } catch {
          } finally {
            p.Dispose();
          }
        }

        string[] trayArr = new string[byExe.Count];
        byExe.Values.CopyTo(trayArr, 0);
        return "[" + string.Join(",", trayArr) + "]";
      }

      // Fallback for Windows 10 where NotifyIconSettings does not exist
      HashSet<string> taskbarExePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        if (!IsTaskbarWindow(hWnd)) return true;
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid == 0 || IsGlassyWindow(pid, hWnd)) return true;
        ProcMeta meta = GetProcMeta(pid);
        if (meta.name.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) {
          uint realPid = ResolveRealUwpPid(hWnd, pid);
          if (realPid != pid) meta = GetProcMeta(realPid);
        }
        if (!string.IsNullOrEmpty(meta.exePath)) {
          taskbarExePaths.Add(meta.exePath);
        }
        return true;
      }, IntPtr.Zero);

      Process[] fallbackProcs = Process.GetProcesses();
      for (int i = 0; i < fallbackProcs.Length; i++) {
        Process p = fallbackProcs[i];
        try {
          if (p.SessionId != mySession) continue;
          uint pid = (uint)p.Id;
          ProcMeta meta = GetProcMeta(pid);
          if (IsGlassyWindow(pid, IntPtr.Zero)) continue;
          if (IsExcludedBackgroundExe(meta.name, meta.exePath)) continue;
          if (taskbarExePaths.Contains(meta.exePath)) continue;
          if (byExe.ContainsKey(meta.exePath)) continue;
          if (GetPESubsystem(meta.exePath) != 2) continue;
          if (ExtractIconEx(meta.exePath, -1, null, null, 0) <= 0) continue;

          string displayName = GetExeDisplayName(meta.exePath, meta.name);
          string aumid = GetCachedAumid(pid);
          string aumidPart = !string.IsNullOrEmpty(aumid)
            ? ",\"aumid\":\"" + JsonEscape(aumid) + "\""
            : "";

          byExe[meta.exePath] = string.Format(
            "{{\"pid\":{0},\"processName\":\"{1}\",\"displayName\":\"{2}\",\"executablePath\":\"{3}\"{4}}}",
            pid,
            JsonEscape(meta.name),
            JsonEscape(displayName),
            JsonEscape(meta.exePath),
            aumidPart
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
      if (seedPid > 4 && !IsGlassyWindow((uint)seedPid, IntPtr.Zero)) {
        pids.Add((uint)seedPid);
      }

      string targetExe = targetMeta.exePath;
      string targetName = targetMeta.name;
      if (string.IsNullOrEmpty(targetExe) && string.IsNullOrEmpty(targetName)) return pids;

      Process[] procs = Process.GetProcesses();
      for (int i = 0; i < procs.Length; i++) {
        Process p = procs[i];
        try {
          uint pid = (uint)p.Id;
          if (pid <= 4 || pid == (uint)seedPid) continue;
          // Pre-filter by already-loaded ProcessName so we never call OpenProcess/GetProcessById
          // on 250+ unrelated system/protected processes (cuts ~1850ms freeze down to ~15ms).
          if (!string.IsNullOrEmpty(targetName) &&
              !string.Equals(p.ProcessName, targetName, StringComparison.OrdinalIgnoreCase)) {
            continue;
          }
          if (IsGlassyWindow(pid, IntPtr.Zero)) continue;
          if (!string.IsNullOrEmpty(targetExe)) {
            ProcMeta pm = QueryProcMeta(pid);
            if (string.Equals(pm.exePath, targetExe, StringComparison.OrdinalIgnoreCase)) {
              pids.Add(pid);
            }
          } else {
            pids.Add(pid);
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
      uint seedPid = (uint)pid;
      ProcMeta targetMeta = GetProcMeta(seedPid);
      if (string.IsNullOrEmpty(targetMeta.exePath)) {
        targetMeta = QueryProcMeta(seedPid);
      }
      string targetExe = targetMeta.exePath ?? "";
      string targetName = targetMeta.name ?? "";

      // 1) Look for an already-taskbar-visible window (or real hidden main window) directly via
      // EnumWindows + cached ProcMeta — zero Process.GetProcesses() stall!
      IntPtr visibleWin = IntPtr.Zero;
      IntPtr hiddenRealWin = IntPtr.Zero;
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        uint wPid;
        GetWindowThreadProcessId(hWnd, out wPid);
        if (wPid <= 4) return true;

        bool matches = (wPid == seedPid);
        if (!matches) {
          ProcMeta wm = GetProcMeta(wPid);
          if (wm.name.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) {
            uint realPid = ResolveRealUwpPid(hWnd, wPid);
            if (realPid != wPid) {
              if (realPid == seedPid) {
                matches = true;
              } else {
                ProcMeta rm = GetProcMeta(realPid);
                if (!string.IsNullOrEmpty(targetExe) &&
                    string.Equals(rm.exePath, targetExe, StringComparison.OrdinalIgnoreCase)) {
                  matches = true;
                }
              }
            }
          } else if (!string.IsNullOrEmpty(targetExe)) {
            if (string.Equals(wm.exePath, targetExe, StringComparison.OrdinalIgnoreCase)) {
              matches = true;
            }
          } else if (!string.IsNullOrEmpty(targetName) &&
                     string.Equals(wm.name, targetName, StringComparison.OrdinalIgnoreCase)) {
            matches = true;
          }
        }
        if (!matches) return true;

        if (IsTaskbarWindow(hWnd)) {
          visibleWin = hWnd;
          return false;
        }

        if (hiddenRealWin == IntPtr.Zero && IsWindow(hWnd) && !IsCloaked(hWnd)) {
          int style = GetWindowLong(hWnd, GWL_STYLE);
          int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
          if ((style & 0x08000000) != 0) return true; // WS_DISABLED
          if ((exStyle & WS_EX_NOACTIVATE) != 0) return true;
          if ((exStyle & WS_EX_TOOLWINDOW) != 0 && (exStyle & WS_EX_APPWINDOW) == 0) return true;
          if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero && (exStyle & WS_EX_APPWINDOW) == 0) return true;
          int len = GetWindowTextLength(hWnd);
          RECT rc;
          if (len > 0 && GetWindowRect(hWnd, out rc)) {
            int w = rc.right - rc.left;
            int h = rc.bottom - rc.top;
            if (w >= 260 && h >= 160 && rc.right > -10000 && rc.bottom > -10000) {
              StringBuilder cls = new StringBuilder(64);
              GetClassName(hWnd, cls, cls.Capacity);
              string c = cls.ToString();
              if (!c.Contains("Tooltip") && c != "MSCTFIME UI" && c != "IME" && c != "Chrome_WidgetWin_0") {
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
        if (ForceFocus(toOpen)) {
          lastExternalForeground = toOpen;
          return "focused";
        }
      }

      // 2) Packaged Microsoft Store / UWP / MSIX app -> return shell:AppsFolder AUMID
      string aumid = GetCachedAumid(seedPid);
      if (!string.IsNullOrEmpty(aumid)) {
        return "aumid:" + aumid;
      }

      // 3) Fallback to exe path launch in main process
      if (!string.IsNullOrEmpty(targetExe)) {
        return "exe:" + targetExe;
      }
      return "false";
    }

    private static string KillAppDeep(int pid) {
      if (pid <= 4 || IsGlassyWindow((uint)pid, IntPtr.Zero)) return "none";
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

    private static string GetHardwareInfoJson() {
      string batPct = "null";
      string batCharging = "null";
      try {
        SYSTEM_POWER_STATUS sps;
        if (GetSystemPowerStatus(out sps)) {
          bool noBattery = (sps.BatteryFlag & 128) != 0 || sps.BatteryLifePercent == 255;
          if (!noBattery) {
            int pct = Math.Max(0, Math.Min(100, (int)sps.BatteryLifePercent));
            bool charging = sps.ACLineStatus == 1 || (sps.BatteryFlag & 8) != 0;
            batPct = pct.ToString();
            batCharging = charging ? "true" : "false";
          }
        }
      } catch { }

      string diskSize = "null";
      string diskFree = "null";
      try {
        string root = Path.GetPathRoot(Environment.SystemDirectory);
        if (string.IsNullOrEmpty(root)) root = "C:\\";
        DriveInfo di = new DriveInfo(root);
        if (di.IsReady) {
          diskSize = di.TotalSize.ToString();
          diskFree = di.AvailableFreeSpace.ToString();
        }
      } catch { }

      return "{\"batPct\":" + batPct + ",\"batCharging\":" + batCharging +
             ",\"diskSize\":" + diskSize + ",\"diskFree\":" + diskFree + "}";
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

    private static void SafeReleaseCom(object obj) {
      if (obj != null) {
        try {
          if (Marshal.IsComObject(obj)) Marshal.ReleaseComObject(obj);
        } catch { }
      }
    }

    private static IAudioEndpointVolume GetEndpointVolume() {
      IMMDeviceEnumerator enumerator = null;
      IMMDevice device = null;
      try {
        enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0 || device == null) return null;
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object obj;
        if (device.Activate(ref iid, 23, IntPtr.Zero, out obj) != 0 || obj == null) return null;
        IAudioEndpointVolume vol = obj as IAudioEndpointVolume;
        if (vol == null) SafeReleaseCom(obj);
        return vol;
      } catch {
        return null;
      } finally {
        SafeReleaseCom(device);
        SafeReleaseCom(enumerator);
      }
    }

    private static string GetVolumeJson() {
      IAudioEndpointVolume vol = null;
      try {
        vol = GetEndpointVolume();
        if (vol == null) return "{\"level\":50,\"muted\":false}";
        float scalar;
        bool muted;
        vol.GetMasterVolumeLevelScalar(out scalar);
        vol.GetMute(out muted);
        int pct = Math.Max(0, Math.Min(100, (int)Math.Round(scalar * 100f)));
        return "{\"level\":" + pct + ",\"muted\":" + (muted ? "true" : "false") + "}";
      } catch {
        return "{\"level\":50,\"muted\":false}";
      } finally {
        SafeReleaseCom(vol);
      }
    }

    private static string SetVolumeLevel(int pct) {
      IAudioEndpointVolume vol = null;
      try {
        vol = GetEndpointVolume();
        if (vol != null) {
          int clamped = Math.Max(0, Math.Min(100, pct));
          Guid ctx = Guid.Empty;
          vol.SetMasterVolumeLevelScalar(clamped / 100f, ref ctx);
          if (clamped > 0) vol.SetMute(false, ref ctx);
        }
      } catch {
      } finally {
        SafeReleaseCom(vol);
      }
      return GetVolumeJson();
    }

    private static string ToggleVolumeMute() {
      IAudioEndpointVolume vol = null;
      try {
        vol = GetEndpointVolume();
        if (vol != null) {
          bool muted;
          vol.GetMute(out muted);
          Guid ctx = Guid.Empty;
          vol.SetMute(!muted, ref ctx);
        }
      } catch {
      } finally {
        SafeReleaseCom(vol);
      }
      return GetVolumeJson();
    }

    private static PROPERTYKEY PKEY_Device_FriendlyName = new PROPERTYKEY {
      fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"),
      pid = 14
    };

    private static PROPERTYKEY PKEY_AppUserModel_ID = new PROPERTYKEY {
      fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
      pid = 5
    };

    private static string ReadAppIdFromStore(IPropertyStore store) {
      if (store == null) return "";
      try {
        PROPVARIANT pv;
        if (store.GetValue(ref PKEY_AppUserModel_ID, out pv) == 0) {
          try {
            if (pv.vt == 31 && pv.p != IntPtr.Zero) {
              return (Marshal.PtrToStringUni(pv.p) ?? "").Trim();
            }
          } finally {
            PropVariantClear(ref pv);
          }
        }
      } catch { }
      return "";
    }

    private static string GetCachedWindowAppId(IntPtr hWnd) {
      long key = hWnd.ToInt64();
      string cached;
      if (winAppIdCache.TryGetValue(key, out cached)) return cached;
      string appId = "";
      IPropertyStore store = null;
      try {
        Guid iid = typeof(IPropertyStore).GUID;
        if (SHGetPropertyStoreForWindow(hWnd, ref iid, out store) == 0 && store != null) {
          appId = ReadAppIdFromStore(store);
        }
      } catch {
      } finally {
        SafeReleaseCom(store);
      }
      if (winAppIdCache.Count > 250) winAppIdCache.Clear();
      winAppIdCache[key] = appId;
      return appId;
    }

    private static string GetShortcutAppId(string filePath) {
      if (string.IsNullOrWhiteSpace(filePath)) return "";
      IPropertyStore store = null;
      try {
        Guid iid = typeof(IPropertyStore).GUID;
        if (SHGetPropertyStoreFromParsingName(filePath, IntPtr.Zero, 0, ref iid, out store) == 0 && store != null) {
          return ReadAppIdFromStore(store);
        }
      } catch {
      } finally {
        SafeReleaseCom(store);
      }
      return "";
    }

    // Wakes a tray-minimized app's hidden main window (e.g. Medal, Discord, Spotify) when the
    // user clicks its pinned icon, avoiding launching a redundant second instance.
    private static string WakeHiddenApp(string exeName, string installDir) {
      string wantExe = (exeName ?? "").Trim().ToLowerInvariant();
      string wantDir = (installDir ?? "").Trim().ToLowerInvariant();
      if (wantExe.Length == 0 && wantDir.Length == 0) return "none";

      Dictionary<string, string> trayExes = GetRegisteredTrayIconExes();
      if (trayExes.Count == 0) return "none";

      int mySession = Process.GetCurrentProcess().SessionId;
      HashSet<uint> matchingPids = new HashSet<uint>();
      Process[] procs = Process.GetProcesses();
      for (int i = 0; i < procs.Length; i++) {
        Process p = procs[i];
        try {
          if (p.SessionId != mySession) continue;
          uint pid = (uint)p.Id;
          ProcMeta meta = GetProcMeta(pid);
          if (string.IsNullOrEmpty(meta.exePath)) continue;
          if (!trayExes.ContainsKey(meta.exePath)) continue;
          bool match = false;
          if (wantExe.Length > 0 && meta.name.Equals(wantExe, StringComparison.OrdinalIgnoreCase)) {
            match = true;
          } else if (wantDir.Length > 0 &&
              meta.exePath.StartsWith(wantDir + "\\", StringComparison.OrdinalIgnoreCase)) {
            match = true;
          }
          if (match) matchingPids.Add(pid);
        } catch {
        } finally {
          p.Dispose();
        }
      }
      if (matchingPids.Count == 0) return "none";

      IntPtr foundWin = IntPtr.Zero;
      EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
        uint wPid;
        GetWindowThreadProcessId(hWnd, out wPid);
        if (!matchingPids.Contains(wPid)) return true;
        if (IsTaskbarWindow(hWnd)) {
          foundWin = hWnd;
          return false;
        }
        if (foundWin == IntPtr.Zero && IsWindow(hWnd) && !IsCloaked(hWnd)) {
          int style = GetWindowLong(hWnd, GWL_STYLE);
          int len = GetWindowTextLength(hWnd);
          RECT rc;
          if (len > 0 && (style & 0x00C00000) != 0 && GetWindowRect(hWnd, out rc)) {
            int w = rc.right - rc.left;
            int h = rc.bottom - rc.top;
            if (w >= 240 && h >= 160) {
              foundWin = hWnd;
            }
          }
        }
        return true;
      }, IntPtr.Zero);

      if (foundWin == IntPtr.Zero) return "none";
      if (!IsWindowVisible(foundWin)) ShowWindow(foundWin, 5);
      ForceFocus(foundWin);
      lastExternalForeground = foundWin;
      return "focused";
    }

    private static string GetDeviceFriendlyName(IMMDevice dev) {
      if (dev == null) return "";
      IPropertyStore store = null;
      try {
        if (dev.OpenPropertyStore(0, out store) != 0 || store == null) return "";
        PROPVARIANT pv;
        if (store.GetValue(ref PKEY_Device_FriendlyName, out pv) == 0) {
          try {
            if (pv.vt == 31 && pv.p != IntPtr.Zero) {
              return Marshal.PtrToStringUni(pv.p) ?? "";
            }
          } finally {
            PropVariantClear(ref pv);
          }
        }
      } catch {
      } finally {
        SafeReleaseCom(store);
      }
      return "";
    }

    private static string GetAudioDevicesJson() {
      IMMDeviceEnumerator enumerator = null;
      IMMDeviceCollection col = null;
      try {
        enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        string defaultId = "";
        IMMDevice defDev = null;
        try {
          if (enumerator.GetDefaultAudioEndpoint(0, 1, out defDev) == 0 && defDev != null) {
            defDev.GetId(out defaultId);
          }
        } catch {
        } finally {
          SafeReleaseCom(defDev);
        }

        if (enumerator.EnumAudioEndpoints(0, 1, out col) != 0 || col == null) return "[]";
        uint count;
        if (col.GetCount(out count) != 0) return "[]";

        StringBuilder sb = new StringBuilder("[");
        bool first = true;
        for (uint i = 0; i < count; i++) {
          IMMDevice dev = null;
          try {
            if (col.Item(i, out dev) != 0 || dev == null) continue;
            string id;
            if (dev.GetId(out id) != 0 || string.IsNullOrEmpty(id)) continue;
            string name = GetDeviceFriendlyName(dev);
            if (string.IsNullOrEmpty(name)) name = "Audio Device";
            bool isDef = string.Equals(id, defaultId, StringComparison.OrdinalIgnoreCase);
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"id\":\"").Append(JsonEscape(id))
              .Append("\",\"name\":\"").Append(JsonEscape(name))
              .Append("\",\"isDefault\":").Append(isDef ? "true" : "false")
              .Append('}');
          } finally {
            SafeReleaseCom(dev);
          }
        }
        sb.Append(']');
        return sb.ToString();
      } catch {
        return "[]";
      } finally {
        SafeReleaseCom(col);
        SafeReleaseCom(enumerator);
      }
    }

    private static string SetDefaultAudioDevice(string deviceId) {
      if (!string.IsNullOrEmpty(deviceId)) {
        IPolicyConfig policy = null;
        try {
          policy = (IPolicyConfig)new PolicyConfigClientComObject();
          policy.SetDefaultEndpoint(deviceId, 0);
          policy.SetDefaultEndpoint(deviceId, 1);
          policy.SetDefaultEndpoint(deviceId, 2);
        } catch {
        } finally {
          SafeReleaseCom(policy);
        }
      }
      return GetAudioDevicesJson();
    }

    private static string ComputeAudioSessionKey(IAudioSessionControl2 ctrl2, out string displayName, out string exePath, out bool isSystem) {
      displayName = "";
      exePath = "";
      isSystem = false;
      try {
        if (ctrl2.IsSystemSoundsSession() == 0) {
          isSystem = true;
          displayName = "System Sounds";
          return "system";
        }
        uint pid = 0;
        ctrl2.GetProcessId(out pid);
        if (pid == 0) {
          isSystem = true;
          displayName = "System Sounds";
          return "system";
        }
        ProcMeta meta = GetProcMeta(pid);
        exePath = meta.exePath ?? "";
        string procName = meta.name ?? "";
        if (!string.IsNullOrEmpty(exePath)) {
          displayName = GetExeDisplayName(exePath, procName);
        }
        if (string.IsNullOrEmpty(displayName)) {
          string rawName;
          if (ctrl2.GetDisplayName(out rawName) == 0 && !string.IsNullOrEmpty(rawName) && !rawName.StartsWith("@")) {
            displayName = rawName.Trim();
          }
        }
        if (string.IsNullOrEmpty(displayName)) {
          displayName = !string.IsNullOrEmpty(procName) ? procName : ("App " + pid);
        }
        return !string.IsNullOrEmpty(procName) ? procName.ToLowerInvariant() : ("pid:" + pid);
      } catch {
        return "";
      }
    }

    private class AudioSessionGroup {
      public string id;
      public string name;
      public string exePath;
      public int volume;
      public bool muted;
      public bool isSystem;
      public bool active;
    }

    private static string GetAudioSessionsJson() {
      IMMDeviceEnumerator enumerator = null;
      IMMDevice device = null;
      object mgrObj = null;
      IAudioSessionEnumerator sessionEnum = null;
      try {
        enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0 || device == null) return "[]";
        Guid iid = typeof(IAudioSessionManager2).GUID;
        if (device.Activate(ref iid, 23, IntPtr.Zero, out mgrObj) != 0 || mgrObj == null) return "[]";
        IAudioSessionManager2 mgr = mgrObj as IAudioSessionManager2;
        if (mgr == null) return "[]";

        if (mgr.GetSessionEnumerator(out sessionEnum) != 0 || sessionEnum == null) return "[]";
        int count;
        if (sessionEnum.GetCount(out count) != 0) return "[]";

        Dictionary<string, AudioSessionGroup> grouped = new Dictionary<string, AudioSessionGroup>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < count; i++) {
          IAudioSessionControl ctrl = null;
          try {
            if (sessionEnum.GetSession(i, out ctrl) != 0 || ctrl == null) continue;
            int state = 0;
            ctrl.GetState(out state);
            if (state == 2) continue; // Expired

            IAudioSessionControl2 ctrl2 = ctrl as IAudioSessionControl2;
            ISimpleAudioVolume vol = ctrl as ISimpleAudioVolume;
            if (ctrl2 == null || vol == null) continue;

            string name, exePath;
            bool isSys;
            string key = ComputeAudioSessionKey(ctrl2, out name, out exePath, out isSys);
            if (string.IsNullOrEmpty(key)) continue;

            float scalar = 1f;
            bool muted = false;
            vol.GetMasterVolume(out scalar);
            vol.GetMute(out muted);
            int pct = Math.Max(0, Math.Min(100, (int)Math.Round(scalar * 100f)));
            bool active = state == 1;

            AudioSessionGroup existing;
            if (grouped.TryGetValue(key, out existing)) {
              if (active && !existing.active) {
                existing.active = true;
                existing.volume = pct;
                existing.muted = muted;
              }
              if (string.IsNullOrEmpty(existing.exePath) && !string.IsNullOrEmpty(exePath)) {
                existing.exePath = exePath;
              }
            } else {
              grouped[key] = new AudioSessionGroup {
                id = key,
                name = name,
                exePath = exePath,
                volume = pct,
                muted = muted,
                isSystem = isSys,
                active = active
              };
            }
          } finally {
            SafeReleaseCom(ctrl);
          }
        }

        List<AudioSessionGroup> list = new List<AudioSessionGroup>(grouped.Values);
        list.Sort(delegate(AudioSessionGroup a, AudioSessionGroup b) {
          if (a.isSystem != b.isSystem) return a.isSystem ? -1 : 1;
          if (a.active != b.active) return a.active ? -1 : 1;
          return string.Compare(a.name, b.name, StringComparison.OrdinalIgnoreCase);
        });

        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < list.Count; i++) {
          AudioSessionGroup g = list[i];
          if (i > 0) sb.Append(',');
          sb.Append("{\"id\":\"").Append(JsonEscape(g.id))
            .Append("\",\"name\":\"").Append(JsonEscape(g.name))
            .Append("\",\"exePath\":\"").Append(JsonEscape(g.exePath))
            .Append("\",\"volume\":").Append(g.volume)
            .Append(",\"muted\":").Append(g.muted ? "true" : "false")
            .Append(",\"isSystem\":").Append(g.isSystem ? "true" : "false")
            .Append(",\"active\":").Append(g.active ? "true" : "false")
            .Append('}');
        }
        sb.Append(']');
        return sb.ToString();
      } catch {
        return "[]";
      } finally {
        SafeReleaseCom(sessionEnum);
        SafeReleaseCom(mgrObj);
        SafeReleaseCom(device);
        SafeReleaseCom(enumerator);
      }
    }

    private static string SetAudioSessionVolume(string targetKey, int pct) {
      if (string.IsNullOrEmpty(targetKey)) return "ok";
      IMMDeviceEnumerator enumerator = null;
      IMMDevice device = null;
      object mgrObj = null;
      IAudioSessionEnumerator sessionEnum = null;
      try {
        int clamped = Math.Max(0, Math.Min(100, pct));
        enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0 || device == null) return "ok";
        Guid iid = typeof(IAudioSessionManager2).GUID;
        if (device.Activate(ref iid, 23, IntPtr.Zero, out mgrObj) != 0 || mgrObj == null) return "ok";
        IAudioSessionManager2 mgr = mgrObj as IAudioSessionManager2;
        if (mgr == null) return "ok";

        if (mgr.GetSessionEnumerator(out sessionEnum) != 0 || sessionEnum == null) return "ok";
        int count;
        if (sessionEnum.GetCount(out count) != 0) return "ok";

        Guid ctx = Guid.Empty;
        for (int i = 0; i < count; i++) {
          IAudioSessionControl ctrl = null;
          try {
            if (sessionEnum.GetSession(i, out ctrl) != 0 || ctrl == null) continue;
            int state = 0;
            ctrl.GetState(out state);
            if (state == 2) continue;
            IAudioSessionControl2 ctrl2 = ctrl as IAudioSessionControl2;
            ISimpleAudioVolume vol = ctrl as ISimpleAudioVolume;
            if (ctrl2 == null || vol == null) continue;

            string dn, ep;
            bool isSys;
            string key = ComputeAudioSessionKey(ctrl2, out dn, out ep, out isSys);
            if (string.Equals(key, targetKey, StringComparison.OrdinalIgnoreCase)) {
              vol.SetMasterVolume(clamped / 100f, ref ctx);
              if (clamped > 0) vol.SetMute(false, ref ctx);
            }
          } finally {
            SafeReleaseCom(ctrl);
          }
        }
      } catch {
      } finally {
        SafeReleaseCom(sessionEnum);
        SafeReleaseCom(mgrObj);
        SafeReleaseCom(device);
        SafeReleaseCom(enumerator);
      }
      return "ok";
    }

    private static string ToggleAudioSessionMute(string targetKey) {
      if (string.IsNullOrEmpty(targetKey)) return "ok";
      IMMDeviceEnumerator enumerator = null;
      IMMDevice device = null;
      object mgrObj = null;
      IAudioSessionEnumerator sessionEnum = null;
      List<ISimpleAudioVolume> matches = new List<ISimpleAudioVolume>();
      try {
        enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0 || device == null) return "ok";
        Guid iid = typeof(IAudioSessionManager2).GUID;
        if (device.Activate(ref iid, 23, IntPtr.Zero, out mgrObj) != 0 || mgrObj == null) return "ok";
        IAudioSessionManager2 mgr = mgrObj as IAudioSessionManager2;
        if (mgr == null) return "ok";

        if (mgr.GetSessionEnumerator(out sessionEnum) != 0 || sessionEnum == null) return "ok";
        int count;
        if (sessionEnum.GetCount(out count) != 0) return "ok";

        for (int i = 0; i < count; i++) {
          IAudioSessionControl ctrl = null;
          bool kept = false;
          try {
            if (sessionEnum.GetSession(i, out ctrl) != 0 || ctrl == null) continue;
            int state = 0;
            ctrl.GetState(out state);
            if (state == 2) continue;
            IAudioSessionControl2 ctrl2 = ctrl as IAudioSessionControl2;
            ISimpleAudioVolume vol = ctrl as ISimpleAudioVolume;
            if (ctrl2 == null || vol == null) continue;

            string dn, ep;
            bool isSys;
            string key = ComputeAudioSessionKey(ctrl2, out dn, out ep, out isSys);
            if (string.Equals(key, targetKey, StringComparison.OrdinalIgnoreCase)) {
              matches.Add(vol);
              kept = true;
            }
          } finally {
            if (!kept) SafeReleaseCom(ctrl);
          }
        }

        if (matches.Count > 0) {
          bool curMuted = false;
          matches[0].GetMute(out curMuted);
          bool nextMuted = !curMuted;
          Guid ctx = Guid.Empty;
          for (int i = 0; i < matches.Count; i++) {
            matches[i].SetMute(nextMuted, ref ctx);
          }
        }
      } catch {
      } finally {
        for (int i = 0; i < matches.Count; i++) SafeReleaseCom(matches[i]);
        SafeReleaseCom(sessionEnum);
        SafeReleaseCom(mgrObj);
        SafeReleaseCom(device);
        SafeReleaseCom(enumerator);
      }
      return "ok";
    }

    // Brightness backend: 0 = unknown, 1 = WMI (laptop), 2 = DDC/CI (desktop monitor), -1 = unsupported
    private static int brightnessBackend = 0;
    private static ManagementObject cachedWmiBrightMethod = null;

    private static bool TryGetWmiBrightness(out int level) {
      level = 100;
      try {
        using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("root\\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness"))
        using (ManagementObjectCollection results = searcher.Get()) {
          foreach (ManagementObject obj in results) {
            object val = obj["CurrentBrightness"];
            if (val != null) {
              level = Math.Max(0, Math.Min(100, Convert.ToInt32(val)));
              return true;
            }
          }
        }
      } catch { }
      return false;
    }

    private static bool TrySetWmiBrightness(int pct) {
      try {
        byte b = (byte)Math.Max(0, Math.Min(100, pct));
        if (cachedWmiBrightMethod == null) {
          using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("root\\WMI", "SELECT * FROM WmiMonitorBrightnessMethods"))
          using (ManagementObjectCollection results = searcher.Get()) {
            foreach (ManagementObject obj in results) {
              cachedWmiBrightMethod = obj;
              break;
            }
          }
        }
        if (cachedWmiBrightMethod != null) {
          cachedWmiBrightMethod.InvokeMethod("WmiSetBrightness", new object[] { (uint)0, b });
          return true;
        }
      } catch {
        cachedWmiBrightMethod = null;
      }
      return false;
    }

    private static bool TryGetDdcciBrightness(out int level) {
      level = 100;
      try {
        POINT origin = new POINT { X = 0, Y = 0 };
        IntPtr hMon = MonitorFromPoint(origin, 1);
        if (hMon == IntPtr.Zero) return false;
        uint count;
        if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out count) || count == 0) return false;
        PHYSICAL_MONITOR[] mons = new PHYSICAL_MONITOR[count];
        if (!GetPhysicalMonitorsFromHMONITOR(hMon, count, mons)) return false;
        try {
          uint minB, curB, maxB;
          if (GetMonitorBrightness(mons[0].hPhysicalMonitor, out minB, out curB, out maxB) && maxB > minB) {
            level = Math.Max(0, Math.Min(100, (int)Math.Round(((double)(curB - minB) / (maxB - minB)) * 100.0)));
            return true;
          }
        } finally {
          DestroyPhysicalMonitors(count, mons);
        }
      } catch { }
      return false;
    }

    private static bool TrySetDdcciBrightness(int pct) {
      try {
        int clamped = Math.Max(0, Math.Min(100, pct));
        POINT origin = new POINT { X = 0, Y = 0 };
        IntPtr hMon = MonitorFromPoint(origin, 1);
        if (hMon == IntPtr.Zero) return false;
        uint count;
        if (!GetNumberOfPhysicalMonitorsFromHMONITOR(hMon, out count) || count == 0) return false;
        PHYSICAL_MONITOR[] mons = new PHYSICAL_MONITOR[count];
        if (!GetPhysicalMonitorsFromHMONITOR(hMon, count, mons)) return false;
        try {
          bool any = false;
          for (uint i = 0; i < count; i++) {
            uint minB, curB, maxB;
            if (GetMonitorBrightness(mons[i].hPhysicalMonitor, out minB, out curB, out maxB) && maxB > minB) {
              uint target = minB + (uint)Math.Round((clamped / 100.0) * (maxB - minB));
              if (SetMonitorBrightness(mons[i].hPhysicalMonitor, target)) any = true;
            }
          }
          return any;
        } finally {
          DestroyPhysicalMonitors(count, mons);
        }
      } catch { }
      return false;
    }

    private static string GetBrightnessJson() {
      int level = 100;
      if (brightnessBackend == 0) {
        if (TryGetWmiBrightness(out level)) {
          brightnessBackend = 1;
          return "{\"supported\":true,\"level\":" + level + "}";
        }
        if (TryGetDdcciBrightness(out level)) {
          brightnessBackend = 2;
          return "{\"supported\":true,\"level\":" + level + "}";
        }
        brightnessBackend = -1;
        return "{\"supported\":false,\"level\":100}";
      }
      if (brightnessBackend == 1 && TryGetWmiBrightness(out level)) {
        return "{\"supported\":true,\"level\":" + level + "}";
      }
      if (brightnessBackend == 2 && TryGetDdcciBrightness(out level)) {
        return "{\"supported\":true,\"level\":" + level + "}";
      }
      return "{\"supported\":false,\"level\":100}";
    }

    private static string SetBrightnessLevel(int pct) {
      int clamped = Math.Max(0, Math.Min(100, pct));
      if (brightnessBackend == 0) GetBrightnessJson();
      if (brightnessBackend == 1) {
        if (TrySetWmiBrightness(clamped)) return "{\"supported\":true,\"level\":" + clamped + "}";
      } else if (brightnessBackend == 2) {
        if (TrySetDdcciBrightness(clamped)) return "{\"supported\":true,\"level\":" + clamped + "}";
      }
      return "{\"supported\":false,\"level\":100}";
    }

    private const string NIGHT_LIGHT_REG_PATH =
      @"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate";

    private static string GetNightLightJson() {
      try {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(NIGHT_LIGHT_REG_PATH, false)) {
          if (key == null) return "{\"supported\":false,\"enabled\":false}";
          byte[] data = key.GetValue("Data") as byte[];
          if (data == null || data.Length < 25) return "{\"supported\":false,\"enabled\":false}";
          if (data[18] == 0x15) return "{\"supported\":true,\"enabled\":true}";
          if (data[18] == 0x13) return "{\"supported\":true,\"enabled\":false}";
        }
      } catch { }
      return "{\"supported\":false,\"enabled\":false}";
    }

    private static string ToggleNightLight() {
      try {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(NIGHT_LIGHT_REG_PATH, true)) {
          if (key == null) return "{\"supported\":false,\"enabled\":false}";
          byte[] data = key.GetValue("Data") as byte[];
          if (data == null || data.Length < 25) return "{\"supported\":false,\"enabled\":false}";
          bool isOn = data[18] == 0x15;
          bool isOff = data[18] == 0x13;
          if (!isOn && !isOff) return "{\"supported\":false,\"enabled\":false}";

          byte[] next;
          if (isOn) {
            next = new byte[data.Length - 2];
            Array.Copy(data, 0, next, 0, 23);
            Array.Copy(data, 25, next, 23, data.Length - 25);
            next[18] = 0x13;
          } else {
            next = new byte[data.Length + 2];
            Array.Copy(data, 0, next, 0, 23);
            next[23] = 0x10;
            next[24] = 0x00;
            Array.Copy(data, 23, next, 25, data.Length - 23);
            next[18] = 0x15;
          }

          // Bump the 5-byte CloudStore timestamp so Shell picks up the change immediately
          for (int i = 10; i < 15; i++) {
            if (next[i] != 0xFF) {
              next[i] = (byte)(next[i] + 1);
              break;
            }
            next[i] = 0x00;
          }

          key.SetValue("Data", next, RegistryValueKind.Binary);
          return "{\"supported\":true,\"enabled\":" + (!isOn ? "true" : "false") + "}";
        }
      } catch {
        return "{\"supported\":false,\"enabled\":false}";
      }
    }

    private static string GetKbdLang() {
      IntPtr fg = lastExternalForeground != IntPtr.Zero ? lastExternalForeground : GetForegroundWindow();
      uint dummy;
      uint tid = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out dummy) : 0;
      int lang = (int)(GetKeyboardLayout(tid).ToInt64() & 0xFFFF);
      if (lang > 0) {
        try {
          string code = new System.Globalization.CultureInfo(lang).TwoLetterISOLanguageName;
          if (!string.IsNullOrEmpty(code) && code.Length >= 2) {
            return code.Substring(0, 2).ToUpperInvariant();
          }
        } catch { }
      }
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

    private static string HBitmapToPngDataUrl(IntPtr hbm) {
      if (hbm == IntPtr.Zero) return "";
      try {
        GDI_BITMAP bm;
        if (GetObject(hbm, Marshal.SizeOf(typeof(GDI_BITMAP)), out bm) == 0) return "";
        int w = bm.bmWidth;
        int h = bm.bmHeight;
        if (w <= 0 || h <= 0 || w > 512 || h > 512) return "";

        byte[] raw = new byte[w * h * 4];
        BITMAPINFOHEADER bih = new BITMAPINFOHEADER {
          biSize = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER)),
          biWidth = w,
          biHeight = -h, // top-down DIB
          biPlanes = 1,
          biBitCount = 32,
          biCompression = 0 // BI_RGB
        };
        IntPtr hdc = CreateCompatibleDC(IntPtr.Zero);
        if (hdc == IntPtr.Zero) return "";
        try {
          if (GetDIBits(hdc, hbm, 0, (uint)h, raw, ref bih, 0) == 0) return "";
        } finally {
          DeleteDC(hdc);
        }

        bool hasAlpha = false;
        for (int i = 3; i < raw.Length; i += 4) {
          if (raw[i] != 0) { hasAlpha = true; break; }
        }
        if (!hasAlpha) {
          for (int i = 3; i < raw.Length; i += 4) raw[i] = 255;
        }

        // IShellItemImageFactory produces premultiplied 32-bit ARGB (PARGB); locking as
        // Format32bppPArgb lets GDI+ un-premultiply cleanly when encoding PNG with full alpha.
        PixelFormat fmt = hasAlpha ? PixelFormat.Format32bppPArgb : PixelFormat.Format32bppArgb;
        using (Bitmap bmp = new Bitmap(w, h, fmt)) {
          BitmapData bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, fmt);
          try {
            Marshal.Copy(raw, 0, bd.Scan0, raw.Length);
          } finally {
            bmp.UnlockBits(bd);
          }
          using (MemoryStream ms = new MemoryStream()) {
            bmp.Save(ms, ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
          }
        }
      } catch {
        return "";
      }
    }

    private static string GetShellItemIconDataUrl(string filePath, int size) {
      IShellItemImageFactory factory = null;
      try {
        Guid iid = typeof(IShellItemImageFactory).GUID;
        if (SHCreateItemFromParsingName(filePath, IntPtr.Zero, ref iid, out factory) != 0 || factory == null) {
          return "";
        }
        IntPtr hbm = IntPtr.Zero;
        // SIIGBF_BIGGERSIZEOK (0x01) | SIIGBF_ICONONLY (0x04) = 0x05
        int hr = factory.GetImage(new SIZE { cx = size, cy = size }, 0x05, out hbm);
        if (hr != 0 || hbm == IntPtr.Zero) {
          hr = factory.GetImage(new SIZE { cx = size, cy = size }, 0x01, out hbm);
        }
        if (hr != 0 || hbm == IntPtr.Zero) return "";
        try {
          return HBitmapToPngDataUrl(hbm);
        } finally {
          DeleteObject(hbm);
        }
      } catch {
        return "";
      } finally {
        SafeReleaseCom(factory);
      }
    }

    private static string GetFileIconDataUrl(string filePath, bool strictExe) {
      if (string.IsNullOrEmpty(filePath)) return "";

      bool isShellPath = filePath.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);

      // When strictExe is requested (for running windows), skip .exe files that have zero
      // embedded icon resources so the caller can fall back to the window's live WM_GETICON
      // instead of caching Windows' generic white default-exe box.
      if (strictExe && !isShellPath && filePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
        if (ExtractIconEx(filePath, -1, null, null, 0) <= 0) {
          return "";
        }
      }

      // Primary: IShellItemImageFactory — renders crisp 48x48 transparent icons for ALL UWP /
      // MSIX / SystemApps (Settings, Calculator, Photos, Store, Terminal...) as well as Win32 exes.
      string shellImg = GetShellItemIconDataUrl(filePath, 48);
      if (shellImg.Length > 0) return shellImg;

      SHFILEINFO shfi = new SHFILEINFO();
      if (isShellPath) {
        IntPtr pidl = IntPtr.Zero;
        uint sfgao = 0;
        int hr = SHParseDisplayName(filePath, IntPtr.Zero, out pidl, 0, out sfgao);
        if (hr == 0 && pidl != IntPtr.Zero) {
          try {
            // SHGFI_ICON (0x100) | SHGFI_PIDL (0x008)
            SHGetFileInfoPidl(pidl, 0, ref shfi, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), 0x108);
            if (shfi.hIcon != IntPtr.Zero) {
              return IconHandleToDataUrl(shfi.hIcon, true);
            }
          } finally {
            CoTaskMemFree(pidl);
          }
        }
        return "";
      }
      SHGetFileInfo(filePath, 0, ref shfi, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), 0x100);
      if (shfi.hIcon != IntPtr.Zero) {
        return IconHandleToDataUrl(shfi.hIcon, true);
      }
      return "";
    }

    // Taskbar-style preview: render the window via PrintWindow (PW_RENDERFULLCONTENT so GPU/Chromium
    // content is captured), crop the invisible DWM resize borders, and downscale to a small JPEG.
    private static string GetWindowThumbDataUrl(long hwndVal) {
      IntPtr hWnd = new IntPtr(hwndVal);
      if (hWnd == IntPtr.Zero) return "";
      if (!IsWindow(hWnd)) {
        lock (thumbCacheLock) { thumbCache.Remove(hwndVal); }
        return "";
      }
      if (!IsIconic(hWnd)) {
        string fresh = CaptureWindowThumb(hWnd, THUMB_W, THUMB_H);
        if (fresh.Length > 0) {
          StoreThumb(hwndVal, fresh);
          return fresh;
        }
      }
      ThumbEntry cached;
      lock (thumbCacheLock) {
        if (thumbCache.TryGetValue(hwndVal, out cached)) return cached.url;
      }
      return "";
    }

    private static void StoreThumb(long hwndVal, string url) {
      lock (thumbCacheLock) {
        if (thumbCache.Count > 80) {
          List<long> dead = new List<long>();
          foreach (long k in thumbCache.Keys) {
            if (!IsWindow(new IntPtr(k))) dead.Add(k);
          }
          foreach (long k in dead) thumbCache.Remove(k);
          if (thumbCache.Count > 80) thumbCache.Clear();
        }
        thumbCache[hwndVal] = new ThumbEntry { url = url, at = Environment.TickCount };
      }
    }

    private static void SnapshotThumb(IntPtr hWnd) {
      if (hWnd == IntPtr.Zero || !IsWindow(hWnd) || IsIconic(hWnd) || !IsWindowVisible(hWnd)) return;
      string url = CaptureWindowThumb(hWnd, THUMB_W, THUMB_H);
      if (url.Length > 0) StoreThumb(hWnd.ToInt64(), url);
    }

    private static void SnapshotThumbIfStale(IntPtr hWnd, int maxAgeMs) {
      ThumbEntry cached;
      bool fresh;
      lock (thumbCacheLock) {
        fresh = thumbCache.TryGetValue(hWnd.ToInt64(), out cached) &&
          unchecked(Environment.TickCount - (int)cached.at) < maxAgeMs;
      }
      if (!fresh) SnapshotThumb(hWnd);
    }

    private static readonly ImageCodecInfo cachedJpegCodec = FindJpegCodec();

    private static ImageCodecInfo FindJpegCodec() {
      try {
        foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders()) {
          if (c.MimeType == "image/jpeg") return c;
        }
      } catch { }
      return null;
    }

    private static string CaptureWindowThumb(IntPtr hWnd, int maxW, int maxH) {
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
            g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
            g2.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighSpeed;
            g2.DrawImage(full, new Rectangle(0, 0, tw, th), crop, GraphicsUnit.Pixel);

            ImageCodecInfo jpeg = cachedJpegCodec;
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
      }
      SetAllNativeTaskbarsVisible(false);
      RECT rc = new RECT { left = left, top = top, right = right, bottom = bottom };
      desiredWorkArea = rc;
      hasDesiredWorkArea = true;
      primaryWorkAreaBackoffUntil = 0;

      RECT curWa = new RECT();
      bool waChanged = true;
      if (SystemParametersInfo(0x0030, 0, ref curWa, 0)) {
        waChanged = Math.Abs(curWa.left - rc.left) > 6 || Math.Abs(curWa.top - rc.top) > 6 ||
                    Math.Abs(curWa.right - rc.right) > 6 || Math.Abs(curWa.bottom - rc.bottom) > 6;
      }
      if (waChanged) {
        lastWorkAreaChangeAt = Environment.TickCount;
        primaryWorkAreaLastSetAt = lastWorkAreaChangeAt;
        // fWinIni=0: update work area silently without sending WM_SETTINGCHANGE to explorer.exe
        // (broadcasting SPIF_SENDCHANGE wakes explorer's AppBar, which immediately overwrites rcWork back!)
        SystemParametersInfo(0x002F, 0, ref rc, 0);
      }
    }

    private static void RestoreWindowsTaskbar() {
      taskbarHiddenByUs = false;
      hasDesiredWorkArea = false;
      IntPtr tray = FindWindow("Shell_TrayWnd", null);
      if (tray != IntPtr.Zero) {
        ShowWindow(tray, 5);
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
      SetAllNativeTaskbarsVisible(true);
      ReleaseAllSecondaryWorkAreas();
    }

    private static void ReleaseAllSecondaryWorkAreas() {
      List<RECT> toRestore = new List<RECT>();
      lock (extraHwndsLock) {
        foreach (RECT orig in savedSecWorkAreas.Values) toRestore.Add(orig);
        savedSecWorkAreas.Clear();
        desiredSecWorkAreas.Clear();
      }
      for (int i = 0; i < toRestore.Count; i++) {
        RECT r = toRestore[i];
        SystemParametersInfo(0x002F, 0, ref r, 2);
      }
    }

    private static void PlaceDockOnOwnMonitor(IntPtr h, bool isTop, int canvasPhysH, int reservePhys) {
      if (h == IntPtr.Zero || !IsWindow(h)) return;
      IntPtr mon = MonitorFromWindow(h, 2);
      if (mon == IntPtr.Zero) return;
      MONITORINFO mi = new MONITORINFO();
      mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(mon, ref mi)) return;

      RECT area = reservePhys > 0 ? mi.rcMonitor : mi.rcWork;
      int px = area.left;
      int pw = area.right - area.left;
      int ph = Math.Min(canvasPhysH, Math.Max(120, area.bottom - area.top));
      int py = isTop ? area.top : (area.bottom - ph);

      RECT tr = new RECT { left = px, top = py, right = px + pw, bottom = py + ph };
      lock (extraHwndsLock) {
        extraDockRects[h] = tr;
      }
      RECT cur;
      if (!GetWindowRect(h, out cur) ||
          Math.Abs(cur.left - tr.left) > 2 ||
          Math.Abs(cur.top - tr.top) > 2 ||
          Math.Abs(cur.right - tr.right) > 2 ||
          Math.Abs(cur.bottom - tr.bottom) > 2) {
        SetWindowPos(h, new IntPtr(-1), px, py, pw, ph, keepOnTop ? 0x0010u : 0x0014u);
      }
    }

    private static void ReserveSecondaryWorkAreaForHwnd(IntPtr h, bool isTop, int reservePhys) {
      if (h == IntPtr.Zero || !IsWindow(h) || reservePhys <= 0) return;
      IntPtr mon = MonitorFromWindow(h, 2);
      if (mon == IntPtr.Zero) return;
      MONITORINFO mi = new MONITORINFO();
      mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(mon, ref mi)) return;

      // Never overwrite the primary monitor's work area from this secondary helper
      if ((mi.dwFlags & 1) != 0) return;

      RECT want = mi.rcMonitor;
      if (isTop) {
        want.top = mi.rcMonitor.top + reservePhys;
      } else {
        want.bottom = mi.rcMonitor.bottom - reservePhys;
      }

      lock (extraHwndsLock) {
        if (!savedSecWorkAreas.ContainsKey(mon)) {
          savedSecWorkAreas[mon] = mi.rcWork;
        }
        desiredSecWorkAreas[mon] = want;
        secWorkAreaBackoffUntil.Remove(mon);
      }

      RECT cur = mi.rcWork;
      bool changed = Math.Abs(cur.left - want.left) > 6 || Math.Abs(cur.top - want.top) > 6 ||
                     Math.Abs(cur.right - want.right) > 6 || Math.Abs(cur.bottom - want.bottom) > 6;
      if (changed) {
        int nowTick = Environment.TickCount;
        lastWorkAreaChangeAt = nowTick;
        lock (extraHwndsLock) {
          secWorkAreaLastSetAt[mon] = nowTick;
        }
        SystemParametersInfo(0x002F, 0, ref want, 0); // fWinIni=0: never wake explorer.exe AppBar!
      }
    }

    private static void ReleaseSecondaryWorkAreaForHwnd(IntPtr h) {
      if (h == IntPtr.Zero || !IsWindow(h)) return;
      IntPtr mon = MonitorFromWindow(h, 2);
      if (mon == IntPtr.Zero) return;
      RECT orig;
      bool had = false;
      lock (extraHwndsLock) {
        desiredSecWorkAreas.Remove(mon);
        if (savedSecWorkAreas.TryGetValue(mon, out orig)) {
          savedSecWorkAreas.Remove(mon);
          had = true;
        }
      }
      if (had) {
        SystemParametersInfo(0x002F, 0, ref orig, 2);
      }
    }

    private static void SetSecondaryWorkArea(int left, int top, int right, int bottom) {
      POINT pt = new POINT { X = (left + right) / 2, Y = (top + bottom) / 2 };
      IntPtr mon = MonitorFromPoint(pt, 2);
      if (mon != IntPtr.Zero) {
        MONITORINFO mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (GetMonitorInfo(mon, ref mi)) {
          lock (extraHwndsLock) {
            if (!savedSecWorkAreas.ContainsKey(mon)) {
              savedSecWorkAreas[mon] = mi.rcWork;
            }
          }
        }
      }
      RECT rc = new RECT { left = left, top = top, right = right, bottom = bottom };
      SystemParametersInfo(0x002F, 0, ref rc, 0);
    }

    // Echo the caller's "#<id>" tag so the Node side can match replies to requests
    private static void Reply(string text) {
      lock (stdoutLock) {
        Console.WriteLine(replyPrefix + text);
      }
    }

    public static void Main(string[] args) {
      // Per-Monitor DPI Aware v2 so multi-monitor setups with mixed scaling (e.g. 150% + 100%)
      // use true physical pixel coordinates on every monitor without DWM virtualization drift.
      try {
        if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) {
          SetProcessDPIAware();
        }
      } catch {
        SetProcessDPIAware();
      }
      if (args.Length > 0) {
        int.TryParse(args[0], out parentElectronPid);
      }

      // Ensure Main's thread has a Win32 message queue so AttachThreadInput in ForceFocus works!
      MSG initMsg;
      PeekMessage(out initMsg, IntPtr.Zero, 0, 0, 0);

      Thread pollThread = new Thread(PollForegroundLoop);
      pollThread.IsBackground = true;
      pollThread.Start();

      Thread peekThread = new Thread(PeekOverlayLoop);
      peekThread.IsBackground = true;
      peekThread.SetApartmentState(ApartmentState.STA);
      peekThread.Start();

      Console.InputEncoding = Encoding.UTF8;
      Console.OutputEncoding = Encoding.UTF8;
      Console.WriteLine("READY");
      Console.Out.Flush();

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
          } else if (line.StartsWith("FOCUS ")) {
            long hv = long.Parse(line.Substring(6).Trim());
            Reply(ActivateWindow(hv));
          } else if (line.StartsWith("PEEK_START ")) {
            long hv = long.Parse(line.Substring(11).Trim());
            StartLivePeek(hv);
            Reply("ok");
          } else if (line == "PEEK_STOP") {
            StopLivePeek();
            Reply("ok");
          } else if (line.StartsWith("LIVE_THUMBS ")) {
            SetLiveThumbs(line.Substring(12).Trim());
            Reply("ok");
          } else if (line == "LIVE_THUMBS_CLEAR") {
            ClearLiveThumbs();
            Reply("ok");
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
          } else if (line == "FULLSCREEN") {
            Reply(GetPrimaryFullscreenCode());
          } else if (line.StartsWith("FULLSCREEN_OF ")) {
            Reply(CheckFullscreenForHwnds(line.Substring(14).Trim()));
          } else if (line == "KBD_LANG") {
            Reply(GetKbdLang());
          } else if (line == "KBD_SWITCH") {
            if (lastExternalForeground != IntPtr.Zero) ForceFocus(lastExternalForeground);
            TapCombo(0x12, 0x10);
            Reply("ok");
          } else if (line == "START") {
            Reply(ToggleStartMenu());
          } else if (line == "QUICK") {
            TapCombo(0x5B, 0x41);
            Reply("ok");
          } else if (line == "DESKTOP") {
            TapCombo(0x5B, 0x44);
            Reply("ok");
          } else if (line == "HW_INFO") {
            Reply(GetHardwareInfoJson());
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
          } else if (line == "AUDIO_DEVICES") {
            Reply(GetAudioDevicesJson());
          } else if (line.StartsWith("AUDIO_SET_DEVICE ")) {
            Reply(SetDefaultAudioDevice(line.Substring(17).Trim()));
          } else if (line == "AUDIO_SESSIONS") {
            Reply(GetAudioSessionsJson());
          } else if (line.StartsWith("AUDIO_SESSION_VOL ")) {
            string rest = line.Substring(18).Trim();
            int sp2 = rest.IndexOf(' ');
            if (sp2 > 0) {
              int pct = int.Parse(rest.Substring(0, sp2));
              string key = rest.Substring(sp2 + 1).Trim();
              Reply(SetAudioSessionVolume(key, pct));
            } else {
              Reply("ok");
            }
          } else if (line.StartsWith("AUDIO_SESSION_MUTE ")) {
            Reply(ToggleAudioSessionMute(line.Substring(19).Trim()));
          } else if (line == "BRIGHT_GET") {
            Reply(GetBrightnessJson());
          } else if (line.StartsWith("BRIGHT_SET ")) {
            int pct = int.Parse(line.Substring(11).Trim());
            Reply(SetBrightnessLevel(pct));
          } else if (line == "NIGHTLIGHT_GET") {
            Reply(GetNightLightJson());
          } else if (line == "NIGHTLIGHT_TOGGLE") {
            Reply(ToggleNightLight());
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
          } else if (line.StartsWith("SET_EXTRA_HWNDS")) {
            string arg = line.Length > 15 ? line.Substring(15).Trim() : "";
            lock (extraHwndsLock) {
              extraDockHwnds.Clear();
              HashSet<IntPtr> keep = new HashSet<IntPtr>();
              if (!string.IsNullOrEmpty(arg)) {
                string[] parts = arg.Split(',');
                for (int i = 0; i < parts.Length; i++) {
                  long hv;
                  if (long.TryParse(parts[i].Trim(), out hv) && hv != 0) {
                    IntPtr h = new IntPtr(hv);
                    extraDockHwnds.Add(h);
                    keep.Add(h);
                  }
                }
              }
              List<IntPtr> stale = new List<IntPtr>();
              foreach (IntPtr k in extraDockRects.Keys) {
                if (!keep.Contains(k)) stale.Add(k);
              }
              for (int i = 0; i < stale.Count; i++) extraDockRects.Remove(stale[i]);
            }
            Reply("ok");
          } else if (line.StartsWith("PLACE_DOCK_MON ")) {
            string[] parts = line.Substring(15).Split(' ');
            IntPtr h = new IntPtr(long.Parse(parts[0]));
            bool isTop = parts[1] == "top";
            int ph = int.Parse(parts[2]);
            int reserve = int.Parse(parts[3]);
            PlaceDockOnOwnMonitor(h, isTop, ph, reserve);
            Reply("ok");
          } else if (line.StartsWith("PLACE_WIN ")) {
            string[] parts = line.Substring(10).Split(' ');
            IntPtr h = new IntPtr(long.Parse(parts[0]));
            int px = int.Parse(parts[1]);
            int py = int.Parse(parts[2]);
            int pw = int.Parse(parts[3]);
            int ph = int.Parse(parts[4]);
            RECT tr = new RECT { left = px, top = py, right = px + pw, bottom = py + ph };
            lock (extraHwndsLock) {
              extraDockRects[h] = tr;
            }
            if (h != IntPtr.Zero && IsWindow(h)) {
              RECT curR;
              bool needMove = !GetWindowRect(h, out curR) ||
                Math.Abs(curR.left - px) > 3 || Math.Abs(curR.top - py) > 3 ||
                Math.Abs(curR.right - (px + pw)) > 3 || Math.Abs(curR.bottom - (py + ph)) > 3;
              if (needMove) {
                SetWindowPos(h, new IntPtr(-1), px, py, pw, ph, keepOnTop ? 0x0010u : 0x0014u);
              }
            }
            Reply("ok");
          } else if (line.StartsWith("SEC_RESERVE ")) {
            string[] parts = line.Substring(12).Split(' ');
            IntPtr h = new IntPtr(long.Parse(parts[0]));
            bool isTop = parts[1] == "top";
            int reserve = int.Parse(parts[2]);
            ReserveSecondaryWorkAreaForHwnd(h, isTop, reserve);
            Reply("ok");
          } else if (line.StartsWith("SEC_RELEASE ")) {
            IntPtr h = new IntPtr(long.Parse(line.Substring(12).Trim()));
            ReleaseSecondaryWorkAreaForHwnd(h);
            Reply("ok");
          } else if (line.StartsWith("SEC_WORKAREA ")) {
            string[] parts = line.Substring(13).Split(' ');
            SetSecondaryWorkArea(
              int.Parse(parts[0]),
              int.Parse(parts[1]),
              int.Parse(parts[2]),
              int.Parse(parts[3])
            );
            Reply("ok");
          } else if (line.StartsWith("PLACE_DOCK ")) {
            string[] parts = line.Substring(11).Split(' ');
            int px = int.Parse(parts[0]);
            int py = int.Parse(parts[1]);
            int pw = int.Parse(parts[2]);
            int ph = int.Parse(parts[3]);
            dockTargetRect = new RECT { left = px, top = py, right = px + pw, bottom = py + ph };
            hasDockTargetRect = true;
            if (dockHwnd != IntPtr.Zero && IsWindow(dockHwnd)) {
              RECT curR;
              bool needMove = !GetWindowRect(dockHwnd, out curR) ||
                Math.Abs(curR.left - px) > 3 || Math.Abs(curR.top - py) > 3 ||
                Math.Abs(curR.right - (px + pw)) > 3 || Math.Abs(curR.bottom - (py + ph)) > 3;
              if (needMove) {
                SetWindowPos(dockHwnd, new IntPtr(-1), px, py, pw, ph, keepOnTop ? 0x0010u : 0x0014u);
              }
            }
            Reply("ok");
          } else if (line.StartsWith("TOPMOST ")) {
            IntPtr h = new IntPtr(long.Parse(line.Substring(8).Trim()));
            if (h != IntPtr.Zero && keepOnTop) SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0013 | 0x4000);
            Reply("ok");
          } else if (line.StartsWith("KEEP_TOP ")) {
            keepOnTop = line.Substring(9).Trim() != "0";
            Reply("ok");
          } else if (line.StartsWith("ICON_STRICT ")) {
            Reply(GetFileIconDataUrl(line.Substring(12).Trim(), true));
          } else if (line.StartsWith("ICON ")) {
            Reply(GetFileIconDataUrl(line.Substring(5).Trim(), false));
          } else if (line.StartsWith("LNK_APPID ")) {
            Reply(GetShortcutAppId(line.Substring(10).Trim()));
          } else if (line.StartsWith("WAKE_HIDDEN ")) {
            string arg = line.Substring(12).Trim();
            int sep = arg.IndexOf('|');
            string ex = sep >= 0 ? arg.Substring(0, sep) : arg;
            string dir = sep >= 0 ? arg.Substring(sep + 1) : "";
            Reply(WakeHiddenApp(ex, dir));
          } else if (line.StartsWith("THUMB ")) {
            string[] parts = line.Substring(6).Trim().Split(' ');
            Reply(GetWindowThumbDataUrl(long.Parse(parts[0])));
          } else if (line.StartsWith("WINICON ")) {
            long hv = long.Parse(line.Substring(8).Trim());
            Reply(GetWindowIconDataUrl(hv));
          } else if (line == "EXIT") {
            StopLivePeek();
            ClearLiveThumbs();
            if (taskbarHiddenByUs) RestoreWindowsTaskbar();
            else ReleaseAllSecondaryWorkAreas();
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
