/**
 * Minimal inline SVG icon set for the app shell.
 *
 * Self-contained on purpose: no icon dependency, and every glyph inherits
 * `currentColor` so it themes off the surrounding CSS.
 */
import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </Glyph>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Glyph {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Glyph>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </Glyph>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1Z" />
    </Glyph>
  );
}

export function IconStar({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Glyph fill={filled ? "currentColor" : "none"} {...props}>
      <path d="m12 3.5 2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 16.9l-5.25 2.76 1-5.86L3.5 9.66l5.9-.86L12 3.5Z" />
    </Glyph>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
    </Glyph>
  );
}

export function IconMore(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16" />
      <path d="M10 7V4.5h4V7" />
      <path d="M6.5 7 7.6 20h8.8L17.5 7" />
      <line x1="10.5" y1="10.5" x2="10.5" y2="16.5" />
      <line x1="13.5" y1="10.5" x2="13.5" y2="16.5" />
    </Glyph>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m9 6 6 6-6 6" />
    </Glyph>
  );
}

export function IconDoc(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 3.5h7.5L18 8v12.5H6V3.5Z" />
      <path d="M13.5 3.5V8H18" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="15.5" x2="15" y2="15.5" />
    </Glyph>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 6.5h6l1.6 2h9.4v9H3.5v-11Z" />
    </Glyph>
  );
}

export function IconBook(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 6.5C10 4.8 7.2 4.5 4 5v13c3.2-.5 6-.2 8 1.5 2-1.7 4.8-2 8-1.5V5c-3.2-.5-6-.2-8 1.5Z" />
      <line x1="12" y1="6.5" x2="12" y2="19.5" />
    </Glyph>
  );
}

export function IconGrip(props: IconProps) {
  return (
    <Glyph fill="currentColor" stroke="none" {...props}>
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </Glyph>
  );
}

export function IconCode(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M8.5 6 3.5 12l5 6" />
      <path d="m15.5 6 5 6-5 6" />
    </Glyph>
  );
}

export function IconLink(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M8.2 8.2 6 10.4a3.4 3.4 0 0 0 4.8 4.8l2.2-2.2" />
      <path d="m15.8 15.8 2.2-2.2a3.4 3.4 0 0 0-4.8-4.8l-2.2 2.2" />
    </Glyph>
  );
}

export function IconBulletList(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="5" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1.2" fill="currentColor" stroke="none" />
      <line x1="9.5" y1="7" x2="20" y2="7" />
      <line x1="9.5" y1="12" x2="20" y2="12" />
      <line x1="9.5" y1="17" x2="20" y2="17" />
    </Glyph>
  );
}

export function IconOrderedList(props: IconProps) {
  return (
    <Glyph {...props}>
      <line x1="10" y1="7" x2="20" y2="7" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="10" y1="17" x2="20" y2="17" />
      <path d="M4 5.5 5.4 5v3.4" strokeWidth={1.3} />
      <path d="M3.8 11.2c.2-.8 1.2-1 1.7-.5.5.5.4 1.1 0 1.6L3.8 14h2" strokeWidth={1.3} />
      <path d="M3.8 16.4h1.8l-1 1.2c.7 0 1.2.4 1.2 1 0 .6-.5 1-1.2 1-.5 0-.8-.2-1-.5" strokeWidth={1.3} />
    </Glyph>
  );
}

export function IconQuote(props: IconProps) {
  return (
    <Glyph {...props}>
      <line x1="5" y1="5" x2="5" y2="19" />
      <line x1="9.5" y1="8" x2="19" y2="8" />
      <line x1="9.5" y1="12" x2="19" y2="12" />
      <line x1="9.5" y1="16" x2="16" y2="16" />
    </Glyph>
  );
}

export function IconCodeBlock(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="m10 9.5-2.5 2.5L10 14.5" />
      <path d="m14 9.5 2.5 2.5L14 14.5" />
    </Glyph>
  );
}

export function IconUser(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.6-3.6 3.8-5.6 7.5-5.6s6.9 2 7.5 5.6" />
    </Glyph>
  );
}
