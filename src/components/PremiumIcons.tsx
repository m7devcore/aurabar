export function StartIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
      <defs>
        <linearGradient id="auraWinGrad" x1="2" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#93C5FD" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
      <rect x="2.2" y="2.2" width="7" height="7" rx="1.6" fill="url(#auraWinGrad)" />
      <rect x="10.8" y="2.2" width="7" height="7" rx="1.6" fill="url(#auraWinGrad)" fillOpacity="0.88" />
      <rect x="2.2" y="10.8" width="7" height="7" rx="1.6" fill="url(#auraWinGrad)" fillOpacity="0.88" />
      <rect x="10.8" y="10.8" width="7" height="7" rx="1.6" fill="url(#auraWinGrad)" fillOpacity="0.75" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
      <circle cx="8.8" cy="8.8" r="5.6" stroke="currentColor" strokeWidth="1.75" />
      <path d="M13.2 13.2L17 17" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" />
    </svg>
  );
}

export function WifiIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path
        d="M2.6 7.5C6.8 3.9 13.2 3.9 17.4 7.5"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeOpacity="0.9"
      />
      <path
        d="M5.4 10.6C8.1 8.3 11.9 8.3 14.6 10.6"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeOpacity="0.95"
      />
      <path
        d="M8.1 13.6C9.2 12.6 10.8 12.6 11.9 13.6"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
      />
      <circle cx="10" cy="16.1" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function VolumeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path
        d="M3.2 8.2C3.2 7.5 3.7 7 4.4 7H6.8L10.6 4.1C11.2 3.6 12 4 12 4.8V15.2C12 16 11.2 16.4 10.6 15.9L6.8 13H4.4C3.7 13 3.2 12.5 3.2 11.8V8.2Z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M14.6 7.3C15.5 8.1 16 9 16 10C16 11 15.5 11.9 14.6 12.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16.6 5.2C18 6.5 18.8 8.2 18.8 10C18.8 11.8 18 13.5 16.6 14.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.65"
      />
    </svg>
  );
}

export function BatteryIcon({ percent, charging }: { percent: number; charging: boolean | null }) {
  const clamped = Math.max(4, Math.min(100, percent));
  const fillWidth = (clamped / 100) * 13.5;
  const fillColor = charging
    ? '#34D399'
    : clamped <= 15
      ? '#FB7185'
      : clamped <= 30
        ? '#FBBF24'
        : 'currentColor';

  return (
    <svg width="21" height="14" viewBox="0 0 24 14" fill="none">
      <rect
        x="1.2"
        y="2.1"
        width="18.2"
        height="9.8"
        rx="2.6"
        stroke="currentColor"
        strokeOpacity="0.72"
        strokeWidth="1.35"
      />
      <rect x="20.4" y="4.9" width="2" height="4.2" rx="1" fill="currentColor" fillOpacity="0.6" />
      <rect
        x="3.1"
        y="4"
        width={fillWidth}
        height="6"
        rx="1.4"
        fill={fillColor}
      />
      {charging && (
        <path
          d="M11.2 1.8L8.4 7.1H10.7L9.8 12.2L13.1 6.7H10.8L11.2 1.8Z"
          fill="#FFFFFF"
          stroke="#0B0E14"
          strokeWidth="0.55"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path
        d="M8.5 2.4C8.7 1.9 9.2 1.6 9.7 1.6H10.3C10.8 1.6 11.3 1.9 11.5 2.4L11.8 3.3C12.3 3.5 12.8 3.7 13.2 4L14.1 3.6C14.6 3.4 15.2 3.5 15.5 3.9L16 4.4C16.4 4.7 16.5 5.3 16.3 5.8L15.9 6.7C16.2 7.1 16.4 7.6 16.6 8.1L17.5 8.4C18 8.6 18.4 9.1 18.4 9.6V10.4C18.4 10.9 18 11.4 17.5 11.6L16.6 11.9C16.4 12.4 16.2 12.9 15.9 13.3L16.3 14.2C16.5 14.7 16.4 15.3 16 15.6L15.5 16.1C15.2 16.5 14.6 16.6 14.1 16.4L13.2 16C12.8 16.3 12.3 16.5 11.8 16.7L11.5 17.6C11.3 18.1 10.8 18.4 10.3 18.4H9.7C9.2 18.4 8.7 18.1 8.5 17.6L8.2 16.7C7.7 16.5 7.2 16.3 6.8 16L5.9 16.4C5.4 16.6 4.8 16.5 4.5 16.1L4 15.6C3.6 15.3 3.5 14.7 3.7 14.2L4.1 13.3C3.8 12.9 3.6 12.4 3.4 11.9L2.5 11.6C2 11.4 1.6 10.9 1.6 10.4V9.6C1.6 9.1 2 8.6 2.5 8.4L3.4 8.1C3.6 7.6 3.8 7.1 4.1 6.7L3.7 5.8C3.5 5.3 3.6 4.7 4 4.4L4.5 3.9C4.8 3.5 5.4 3.4 5.9 3.6L6.8 4C7.2 3.7 7.7 3.5 8.2 3.3L8.5 2.4Z"
        fill="currentColor"
        fillOpacity="0.14"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.7" stroke="currentColor" strokeWidth="1.45" />
    </svg>
  );
}
