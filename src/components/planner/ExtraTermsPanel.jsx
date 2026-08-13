import { useState } from 'react';
import CourseCard from './CourseCard';

export default function ExtraTermsPanel({
  extraTerms,
  courseMap,
  creditsMap,
  onRemoveCourse,
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (!extraTerms?.length) return null;

  const totalCourses = extraTerms.reduce((n, t) => n + (t.courseKeys?.length || 0), 0);
  const totalCredits = extraTerms.reduce(
    (sum, t) => sum + (t.courseKeys || []).reduce((s, k) => s + (creditsMap[k] ?? 0), 0),
    0,
  );

  if (collapsed) {
    return (
      <div className="plan-side-panel collapsed">
        <button type="button" className="plan-side-panel-expand" onClick={() => setCollapsed(false)}>
          Summer &amp; Winter Terms · {totalCourses} courses · {totalCredits || '—'} cr
        </button>
      </div>
    );
  }

  return (
    <div className="plan-side-panel extra-terms-panel">
      <div className="plan-side-panel-header">
        <div>
          <h3>Summer &amp; Winter Terms</h3>
          <p className="plan-side-panel-sub">
            Counts toward HUB and credits · not in the 8-semester grid
          </p>
        </div>
        <button
          type="button"
          className="plan-side-panel-collapse"
          onClick={() => setCollapsed(true)}
          title="Collapse"
        >
          −
        </button>
      </div>

      <div className="extra-terms-list">
        {extraTerms.map((et) => (
          <div key={et.term} className="extra-term-group">
            <div className="extra-term-label">
              {et.term}
              {et.isPostDegree && <span className="extra-term-badge">Post-degree</span>}
            </div>
            <div className="extra-term-courses">
              {(et.courseKeys || []).map((key) => (
                <CourseCard
                  key={key}
                  courseKey={key}
                  data={courseMap[key]}
                  credits={creditsMap[key]}
                  season={et.season}
                  onRemove={onRemoveCourse ? () => onRemoveCourse(et.term, key) : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
