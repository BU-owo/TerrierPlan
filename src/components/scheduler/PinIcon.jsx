// Lock/pin glyph — replaces the 📌/📍 emoji pair that used to mark
// "locked into every generated schedule" on grid blocks and section rows.
// `currentColor` so it inherits whatever color the button/badge already
// uses (muted/locked-amber/hover), same pattern as CourseSearch's PawIcon
// and ScheduleStepper's FlagIcon — no extra dark-mode handling needed.
export default function PinIcon({ filled }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M9 4h6l-.7 6.2L18 13v2h-6.2L11 21l-.8-6H4v-2l3.7-2.8z" />
    </svg>
  );
}
