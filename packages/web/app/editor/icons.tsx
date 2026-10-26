/**
 * The icons of the mockup, drawn inline. Each one is decoration: the text
 * beside it says the same thing, so every icon is hidden from a screen reader.
 */
interface IconProps {
  size?: number;
  className?: string;
}

const Stroke = ({ size = 14, className, children }: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={`flex-none ${className ?? ''}`}
  >
    {children}
  </svg>
);

export const ChevronDown = (props: IconProps) => (
  <Stroke {...props}>
    <path d="m6 9 6 6 6-6" />
  </Stroke>
);

export const Repository = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
  </Stroke>
);

export const Branch = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <path d="M6 8.5v7" />
    <path d="M18 10.5c0 4-6 3-11 5.5" />
  </Stroke>
);

export const Commit = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M2 12h6.5" />
    <path d="M15.5 12H22" />
  </Stroke>
);

export const PanelFold = (props: IconProps) => (
  <Stroke {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <path d="m16 9-3 3 3 3" />
  </Stroke>
);

export const Copy = (props: IconProps) => (
  <Stroke {...props}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Stroke>
);

export const External = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
  </Stroke>
);

export const Undo = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M4 4v5h5" />
    <path d="M4.5 9a8 8 0 1 1-.5 5" />
  </Stroke>
);

export const ArrowRight = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Stroke>
);

export const TableView = (props: IconProps) => (
  <Stroke {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18" />
    <path d="M9 10v10" />
  </Stroke>
);

export const KeyView = (props: IconProps) => (
  <Stroke {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M10 4v16" />
  </Stroke>
);

export const Plus = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Stroke>
);

export const Info = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 11v5.5" />
    <path d="M12 7.5h.01" />
  </Stroke>
);

export const Alert = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16.5h.01" />
  </Stroke>
);

export const Refused = (props: IconProps) => (
  <Stroke {...props}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="m9 9 6 6" />
    <path d="m15 9-6 6" />
  </Stroke>
);

export const Send = (props: IconProps) => (
  <Stroke {...props}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </Stroke>
);

export const Retry = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Stroke>
);

export const FileIcon = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
  </Stroke>
);

export const Lock = (props: IconProps) => (
  <Stroke {...props}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Stroke>
);

export const Wrench = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </Stroke>
);

export const Github = (props: IconProps) => (
  <Stroke {...props}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </Stroke>
);

/** A turning arc. `quiet` is the one inside a disabled button. */
export const Published = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="flex-none">
    <circle cx="12" cy="12" r="10" fill="#146C3A" />
    <path
      d="m7.5 12.5 3 3 6-6.5"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * The mark of a state, inside its badge. The three differ by their shape, so
 * a state reads without its colour: a dashed ring, a half disc, a full disc.
 */
export const StateMark = ({ state }: { state: 'missing' | 'review' | 'proposed' | 'published' }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none">
    {state === 'missing' && (
      <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 1.8" />
    )}
    {state === 'review' && (
      <>
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 3.4v3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="6" cy="8.5" r="0.85" fill="currentColor" />
      </>
    )}
    {state === 'proposed' && (
      <>
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 1.4a4.6 4.6 0 0 1 0 9.2Z" fill="currentColor" />
      </>
    )}
    {state === 'published' && (
      <>
        <circle cx="6" cy="6" r="5.4" fill="currentColor" />
        <path
          d="m3.6 6.2 1.6 1.6 3.2-3.4"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    )}
  </svg>
);
