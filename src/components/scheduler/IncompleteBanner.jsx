import { Fragment } from 'react';

const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

// "Not complete yet: CAS CH 110 needs a Laboratory · CAS PY 212 needs a
// Discussion" above the preview grid. Each item jumps to that component's group
// in the draft. `info` is [{ courseKey, label, missing: [{ key, label }] }].
export default function IncompleteBanner({ info, onFocusGroup }) {
  if (!info || info.length === 0) return null;
  const items = info.flatMap((course) => course.missing.map((m) => ({
    id: `${course.courseKey}|${m.key}`,
    courseKey: course.courseKey,
    groupKey: m.key,
    text: m.label === 'Other sections'
      ? `${course.label} needs one of the ungrouped sections`
      : `${course.label} needs ${article(m.label)} ${m.label}`,
  })));
  return (
    <div className="sched-incomplete-banner" role="status">
      Not complete yet:{' '}
      {items.map((item, i) => (
        <Fragment key={item.id}>
          {i > 0 && ' · '}
          <button
            type="button"
            className="sched-incomplete-banner-item"
            onClick={() => onFocusGroup(item.courseKey, item.groupKey)}
            title="Go to it in your draft"
          >
            {item.text}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
