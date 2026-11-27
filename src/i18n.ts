import type { ActivePanel, Language } from './types';

export interface Translations {
  apps: string;
  media: string;
  system: string;
  calendar: string;
  settings: string;
  settingsSubtitle: string;
  pinnedApps: string;
  runningWindows: string;
  noRunningWindows: string;
  addUrl: string;
  browseExe: string;
  importWinApps: string;
  cpu: string;
  ram: string;
  disk: string;
  battery: string;
  uptime: string;
  volume: string;
  nothingPlaying: string;
  musicSection: string;
  musicTop: string;
  musicTaskbar: string;
  dockPosition: string;
  posBottom: string;
  posTop: string;
  appearanceSection: string;
  theme: string;
  themeObsidian: string;
  themePlatinum: string;
  themeFrost: string;
  language: string;
  behaviorSection: string;
  replaceWindowsTaskbar: string;
  replaceTaskbarDesc: string;
  showOpenWindows: string;
  showOpenWindowsDesc: string;
  compactMode: string;
  compactModeDesc: string;
  dockMagnification: string;
  dockMagnificationDesc: string;
  alwaysOnTop: string;
  alwaysOnTopDesc: string;
  launchAtStartup: string;
  launchAtStartupDesc: string;
  hideInFullscreen: string;
  hideInFullscreenDesc: string;
  showOnAllDisplays: string;
  showOnAllDisplaysDesc: string;
  updateReady: string;
  updateReadyDesc: string;
  restartNow: string;
  updateDownloading: string;
  checkingUpdates: string;
  upToDate: string;
  checkUpdates: string;
  updateError: string;
  versionLabel: string;
  manageAppsBtn: string;
  hideDock: string;
  quitApp: string;
  reminders: string;
  addReminderPlaceholder: string;
  noReminders: string;
  scanningApps: string;
  refresh: string;
  islandIdle: string;
  islandHint: string;
  play: string;
  pause: string;
  previousTrack: string;
  nextTrack: string;
  collapse: string;
  lyrics: string;
  lyricsLoading: string;
  noLyrics: string;
  instrumental: string;
}

const EN: Translations = {
  apps: 'Apps & Pinning',
  media: 'Now Playing',
  system: 'System & Audio',
  calendar: 'Calendar',
  settings: 'Glassy Settings',
  settingsSubtitle: 'Customize your taskbar, music player, and theme',
  pinnedApps: 'Pinned Apps',
  runningWindows: 'Open Windows',
  noRunningWindows: 'No other visible desktop windows detected right now.',
  addUrl: 'Add Link',
  browseExe: 'Browse .exe',
  importWinApps: 'Import Win Taskbar',
  cpu: 'CPU',
  ram: 'Memory',
  disk: 'Disk C:',
  battery: 'Battery',
  uptime: 'Uptime',
  volume: 'Volume',
  nothingPlaying: 'No active media playing',
  musicSection: 'Music Player Position',
  musicTop: 'Top Island (Under Camera)',
  musicTaskbar: 'In Taskbar (Left)',
  dockPosition: 'Taskbar Position',
  posBottom: 'Bottom',
  posTop: 'Top',
  appearanceSection: 'Appearance & Theme',
  theme: 'Theme',
  themeObsidian: 'Classy Obsidian',
  themePlatinum: 'Platinum Gold',
  themeFrost: 'Frost Light',
  language: 'Language',
  behaviorSection: 'Taskbar Behavior',
  replaceWindowsTaskbar: 'Replace Windows Taskbar',
  replaceTaskbarDesc: 'Hide the native Windows taskbar and reserve screen space',
  showOpenWindows: 'Show Open Windows',
  showOpenWindowsDesc: 'Display unpinned running apps in the center dock',
  compactMode: 'Compact Taskbar',
  compactModeDesc: 'Use a slimmer 44px bar height',
  dockMagnification: 'Icon Wave Magnification',
  dockMagnificationDesc: 'Smoothly lift and scale taskbar icons under your cursor',
  alwaysOnTop: 'Always on Top',
  alwaysOnTopDesc: 'Keep taskbar and overlays above other open apps',
  launchAtStartup: 'Launch at Windows startup',
  launchAtStartupDesc: 'Open Glassy automatically when you sign in',
  hideInFullscreen: 'Hide in full screen',
  hideInFullscreenDesc: 'Tuck the bar and island away while a game or video is full screen',
  showOnAllDisplays: 'Show on all monitors',
  showOnAllDisplaysDesc: 'Display a streamlined bar with apps and clock on secondary monitors',
  updateReady: 'Update ready',
  updateReadyDesc: 'Version {v} is downloaded and ready to install',
  restartNow: 'Restart now',
  updateDownloading: 'Downloading update…',
  checkingUpdates: 'Checking for updates…',
  upToDate: "You're on the latest version",
  checkUpdates: 'Check for updates',
  updateError: "Couldn't check for updates. Try again later.",
  versionLabel: 'Glassy',
  manageAppsBtn: 'Manage Pinned Apps',
  hideDock: 'Hide (Alt+Space)',
  quitApp: 'Quit Glassy',
  reminders: 'Reminders for Selected Day',
  addReminderPlaceholder: 'Add reminder for this date...',
  noReminders: 'No reminders for this day',
  scanningApps: 'Scanning Start Menu apps…',
  refresh: 'Refresh',
  islandIdle: 'Nothing playing',
  islandHint: 'Play something in Spotify, YouTube, or any media app',
  play: 'Play',
  pause: 'Pause',
  previousTrack: 'Previous track',
  nextTrack: 'Next track',
  collapse: 'Collapse',
  lyrics: 'Lyrics',
  lyricsLoading: 'Finding lyrics…',
  noLyrics: 'No lyrics found for this track',
  instrumental: 'Instrumental'
};

const AR: Translations = {
  apps: 'التطبيقات والتثبيت',
  media: 'الموسيقى الآن',
  system: 'النظام والصوت',
  calendar: 'التقويم',
  settings: 'إعدادات Glassy',
  settingsSubtitle: 'تخصيص شريط المهام ومشغل الأغاني والمظهر',
  pinnedApps: 'التطبيقات المثبتة',
  runningWindows: 'النوافذ المفتوحة',
  noRunningWindows: 'لا توجد نوافذ سطح مكتب ظاهرة حالياً.',
  addUrl: 'إضافة رابط',
  browseExe: 'اختيار .exe',
  importWinApps: 'استيراد من ويندوز',
  cpu: 'المعالج',
  ram: 'الذاكرة',
  disk: 'القرص C:',
  battery: 'البطارية',
  uptime: 'وقت التشغيل',
  volume: 'مستوى الصوت',
  nothingPlaying: 'لا يوجد صوت قيد التشغيل',
  musicSection: 'مكان شريط الأغاني',
  musicTop: 'في الأعلى (تحت الكاميرا)',
  musicTaskbar: 'داخل شريط المهام',
  dockPosition: 'مكان شريط المهام',
  posBottom: 'الأسفل',
  posTop: 'الأعلى',
  appearanceSection: 'المظهر والخطوط',
  theme: 'الثيم',
  themeObsidian: 'أوبسيديان كلاسيك',
  themePlatinum: 'بلاتينيوم ذهبي',
  themeFrost: 'فروست فاتح',
  language: 'اللغة',
  behaviorSection: 'سلوك شريط المهام',
  replaceWindowsTaskbar: 'استبدال شريط ويندوز الأساسي',
  replaceTaskbarDesc: 'إخفاء شريط ويندوز وحجز مساحة الشاشة لشريطنا فقط',
  showOpenWindows: 'إظهار التطبيقات المفتوحة',
  showOpenWindowsDesc: 'عرض البرامج الشغالة غير المثبتة في منتصف الشريط',
  compactMode: 'شريط مدمج (Compact)',
  compactModeDesc: 'تقليل ارتفاع الشريط إلى 44px لمظهر أنحف',
  dockMagnification: 'تكبير الأيقونات عند التمرير',
  dockMagnificationDesc: 'رفع وتكبير أيقونات الشريط بنعومة تحت مؤشر الماوس',
  alwaysOnTop: 'دائماً في المقدمة',
  alwaysOnTopDesc: 'إبقاء الشريط والأيقونات فوق جميع النوافذ المفتوحة',
  launchAtStartup: 'التشغيل مع ويندوز',
  launchAtStartupDesc: 'فتح Glassy تلقائياً عند تسجيل الدخول',
  hideInFullscreen: 'الإخفاء في ملء الشاشة',
  hideInFullscreenDesc: 'إخفاء الشريط والجزيرة أثناء لعبة أو فيديو بملء الشاشة',
  showOnAllDisplays: 'إظهار على جميع الشاشات',
  showOnAllDisplaysDesc: 'عرض شريط أنيق بالتطبيقات والساعة على الشاشات الإضافية',
  updateReady: 'التحديث جاهز',
  updateReadyDesc: 'النسخة {v} نزلت وجاهزة للتثبيت',
  restartNow: 'أعد التشغيل الآن',
  updateDownloading: 'جاري تنزيل التحديث…',
  checkingUpdates: 'جاري البحث عن تحديث…',
  upToDate: 'أنت على آخر نسخة',
  checkUpdates: 'البحث عن تحديث',
  updateError: 'تعذر البحث عن تحديث. جرّب لاحقاً.',
  versionLabel: 'Glassy',
  manageAppsBtn: 'إدارة التطبيقات المثبتة',
  hideDock: 'إخفاء (Alt+Space)',
  quitApp: 'إغلاق Glassy',
  reminders: 'ملاحظات اليوم المحدد',
  addReminderPlaceholder: 'أضف تذكيراً لهذا اليوم...',
  noReminders: 'لا توجد تذكيرات لهذا اليوم',
  scanningApps: 'جارٍ البحث عن التطبيقات…',
  refresh: 'تحديث',
  islandIdle: 'لا يوجد تشغيل',
  islandHint: 'شغّل أي شيء على Spotify أو YouTube أو أي مشغل',
  play: 'تشغيل',
  pause: 'إيقاف مؤقت',
  previousTrack: 'السابق',
  nextTrack: 'التالي',
  collapse: 'تصغير',
  lyrics: 'كلمات الأغنية',
  lyricsLoading: 'جاري البحث عن الكلمات…',
  noLyrics: 'ما في كلمات لهالأغنية',
  instrumental: 'موسيقى بدون كلمات'
};

export function t(lang: Language): Translations {
  return lang === 'ar' ? AR : EN;
}

export function panelTitleLabel(panel: ActivePanel, lang: Language): string {
  if (!panel) return '';
  return t(lang)[panel];
}
