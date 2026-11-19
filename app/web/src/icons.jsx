// 선 아이콘 (lucide 계열 모양을 직접 그림)
const P = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  graph: <><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="8" r="2.2" /><circle cx="12" cy="18" r="2.2" /><path d="m7.8 7 8.4.6M7 8l4 8.2M17 10l-4 6.2" /></>,
  home: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v9h12v-9" /></>,
  board: <><rect x="4" y="4" width="5" height="16" rx="1.5" /><rect x="10.5" y="4" width="5" height="10" rx="1.5" /><rect x="17" y="4" width="3" height="7" rx="1" /></>,
  chev: <path d="m9 6 6 6-6 6" />,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /><path d="M8 14h2M14 14h2M8 17h2" /></>,
  panel: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M9.5 5v14" /></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5l3 1.8" /></>,
  up: <path d="M12 19V6m-6 6 6-6 6 6" />,
  play: <path d="M8 5.5v13l11-6.5z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  edit: <><path d="M4 20h4l11-11-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  doc: <><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  pause: <path d="M8 5v14M16 5v14" />,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  map: <><circle cx="12" cy="12" r="2.6" /><rect x="15.5" y="4" width="5" height="4" rx="1" /><rect x="15.5" y="16" width="5" height="4" rx="1" /><rect x="3.5" y="10" width="5" height="4" rx="1" /><path d="M14.4 10.8 15.5 6M14.4 13.2l1.1 4.8M9.4 12h0.2" /></>,
};

export function Icon({ name, size = 15, className = '' }) {
  return (
    <svg className={`ico ${className}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      {P[name]}
    </svg>
  );
}
