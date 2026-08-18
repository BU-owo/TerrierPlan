// A literal flag-on-a-pole glyph — deliberately NOT a star, since the
// saved-schedules list already uses ★/☆ for "favorited." Bookmarking a
// generated combination as a candidate (see ScheduleStepper) is a
// different, lighter-weight action than favoriting something already
// saved, so it gets its own shape rather than overloading the same symbol
// for two meanings. `currentColor` so it inherits the button's color
// (muted / amber-on-hover / amber-when-flagged) with no extra dark-mode
// handling, same pattern as CourseSearch's PawIcon.
export default function FlagIcon({ filled }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M5 21V4" fill="none" />
      <path d="M5 4h13l-2.5 4L18 12H5z" fill={filled ? 'currentColor' : 'none'} />
    </svg>
  );
}
