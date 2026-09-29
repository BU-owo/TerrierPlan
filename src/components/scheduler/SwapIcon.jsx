// "Overlay ghost previews of other sections on the schedule" glyph — a
// little ghost, matching the translucent ghost blocks the button draws.
// `currentColor`-driven like PinIcon/FlagIcon, no dark-mode handling
// needed here beyond the button that hosts it. The eyes are filled dots
// rather than stroked ones: a stroked dot is too small to survive at 11px.
export default function SwapIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M5 21V10a7 7 0 0 1 14 0v11l-2.33-3-2.34 3L12 18l-2.33 3-2.34-3z" />
      <circle cx="9.5" cy="10.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="10.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
