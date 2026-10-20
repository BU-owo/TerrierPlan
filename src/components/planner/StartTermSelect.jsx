import { startTermOptions, termLabel } from '../../utils/term';

// Fall/Spring "when did you start" dropdown (see startTermOptions). `value`
// is a term code or ''; '' shows the disabled `placeholder` option, so
// onChange only ever gets a picked code.
export default function StartTermSelect({ id, value = '', today, placeholder, ariaLabel, onChange }) {
  const options = startTermOptions(today);
  // A saved start term outside the range still shows as selected.
  if (value && !options.includes(value)) options.push(value);
  return (
    <select
      id={id}
      className="search-sem-select"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder != null && <option value="" disabled>{placeholder}</option>}
      {options.map((code) => (
        <option key={code} value={code}>{termLabel(code)}</option>
      ))}
    </select>
  );
}
