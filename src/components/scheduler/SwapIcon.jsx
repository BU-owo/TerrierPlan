// "Browse other sections for this slot" glyph — two overlapping cards,
// standing in for "there are alternatives stacked behind this one."
// `currentColor`-driven like PinIcon/FlagIcon, no dark-mode handling
// needed here beyond the button that hosts it.
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
      <rect x="3" y="7" width="13" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    </svg>
  );
}
