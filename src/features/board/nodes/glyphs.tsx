// Type glyphs for block headers: 14px line icons, stroke = currentColor so the
// header can tint them with the block accent. Add one per new block type.
import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const GlyphNote = () => (
  <Svg>
    <path d="M3 3.5h10M3 7h10M3 10.5h6" />
  </Svg>
);
export const GlyphImage = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="6" cy="6.8" r="1" />
    <path d="m2.5 12 3.8-3.4 2.7 2.4 1.6-1.4 3 2.4" />
  </Svg>
);
export const GlyphZone = () => (
  <Svg>
    <path d="M2.5 5.5v-2h2M11.5 3.5h2v2M13.5 10.5v2h-2M4.5 12.5h-2v-2" />
  </Svg>
);
export const GlyphUnknown = () => (
  <Svg>
    <path d="M6 6.2a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6M8 12v.1" />
  </Svg>
);
export const GlyphTable = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 6.5h12M2 9.8h12M6.2 3v10" />
  </Svg>
);
export const GlyphChart = () => (
  <Svg>
    <path d="M3 3v10h10" />
    <path d="M6 11V8M9 11V5.5M12 11V7.5" />
  </Svg>
);
export const GlyphTimeline = () => (
  <Svg>
    <path d="M5 2.5v11" />
    <circle cx="5" cy="4.5" r="1.4" />
    <circle cx="5" cy="11.5" r="1.4" />
    <path d="M8.5 4.5H13M8.5 11.5H12" />
  </Svg>
);
export const GlyphDecision = () => (
  <Svg>
    <path d="M8 2.5v4M8 6.5 3.5 10M8 6.5 12.5 10" />
    <circle cx="3.5" cy="12" r="1.3" />
    <circle cx="12.5" cy="12" r="1.3" />
  </Svg>
);
