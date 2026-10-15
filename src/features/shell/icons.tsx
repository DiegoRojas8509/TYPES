import type { ReactNode } from "react";

function Svg({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconChevron = () => (
  <Svg size={12}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Svg>
);
export const IconPlus = () => (
  <Svg>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const IconPage = () => (
  <Svg>
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3" />
  </Svg>
);
export const IconBoard = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M2 7h12M7 3v10" />
  </Svg>
);
export const IconFolder = () => (
  <Svg>
    <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />
  </Svg>
);
export const IconFolderPlus = () => (
  <Svg>
    <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />
    <path d="M8 8v3M6.5 9.5h3" />
  </Svg>
);
export const IconPencil = () => (
  <Svg>
    <path d="m3 13 .6-2.7L11 2.9a1.2 1.2 0 0 1 1.7 0l.4.4a1.2 1.2 0 0 1 0 1.7L5.7 12.4z" />
  </Svg>
);
export const IconTrash = () => (
  <Svg>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />
  </Svg>
);
export const IconImage = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="m2.5 11 3-3 3 3 2-2 3 3" />
  </Svg>
);
export const IconCode = () => (
  <Svg>
    <path d="m6 5-3 3 3 3M10 5l3 3-3 3" />
  </Svg>
);
export const IconPanel = () => (
  <Svg>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="M10 3v10" />
  </Svg>
);
export const IconClose = () => (
  <Svg>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);
