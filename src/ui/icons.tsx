// Thin line icons for the sidebar (the same set as the design). Apps without one fall back to their emoji.
const PATHS: Record<string, string> = {
  home: "M4 11l8-7 8 7v9H4v-9z M10 20v-6h4v6",
  life: "M12 21v-8 M12 13c0-4 3-6 7-6 0 4-3 6-7 6 M12 15c0-3-2-5-6-5 0 3 2 5 6 5",
  todo: "M4 7l2 2 3-3 M12 8h8 M4 15l2 2 3-3 M12 16h8",
  projects: "M12 3l9 5-9 5-9-5 9-5z M3 12.5l9 5 9-5",
  journal: "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z M8 4v13 M11 8h5",
  jobs: "M4 8h16v11H4z M9 8V5h6v3 M4 13h16",
  library: "M4 4h4v16H4z M10 4h4v16h-4z M16 6l4-1 2 15-4 1z",
  courses: "M2 9l10-5 10 5-10 5-10-5z M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5 M22 9v6",
  saved: "M6 4h12v17l-6-4-6 4V4z",
  creator: "M3 7h18v12H3z M3 11h18 M7 7l2-3 M12 7l2-3 M10 14l4 2-4 2z",
  wisdom: "M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z",
  recipes: "M7 11a3.5 3.5 0 112-6.5 3.5 3.5 0 015 0A3.5 3.5 0 1117 11v8H7v-8z M7 15h10",
  wardrobe: "M12 7a2.5 2.5 0 10-2.5-2.5 M12 7v2l9 6a1.5 1.5 0 01-1 2.7H4a1.5 1.5 0 01-1-2.7l9-6",
  medical: "M12 20s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 9c0 6-8 11-8 11z M7 12h3l1.5-3 2 6 1.5-3h2",
  organization: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  finance: "M12 3a9 9 0 100 18 9 9 0 000-18z M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5 M12 6.5V8 M12 16v1.5",
  family: "M9 11a3 3 0 100-6 3 3 0 000 6z M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6 M17 10a2.5 2.5 0 100-5 M17 14c2.5 0 4.5 2 4.5 5",
  photos: "M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15 9.5a1 1 0 100-2",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6z M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.6h4.4l.4-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  search: "M11 4.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z M16 16l4 4",
};

export function hasIcon(id: string): boolean {
  return id in PATHS;
}

export function Icon({ id, fallback, size = 20 }: { id: string; fallback?: string; size?: number }) {
  const d = PATHS[id];
  if (!d) return <span>{fallback}</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(" M").map((seg, i) => (
        <path key={i} d={(i === 0 ? "" : "M") + seg} />
      ))}
    </svg>
  );
}
