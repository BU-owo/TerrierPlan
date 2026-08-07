import { useState } from 'react';
import SemesterColumn from './SemesterColumn';

const YEARS = [0, 1, 2, 3];

export default function SemesterBoard({
  semesters,
  courseMap,
  creditsMap,
  activeSemIndex,
  onSemesterClick,
  onRemoveCourse,
  draggingId,
}) {
  return (
    <div className="semester-board">
      {YEARS.map((year) => {
        const fallIndex = year * 2;
        const springIndex = year * 2 + 1;
        return (
          <div key={year} className="year-row">
            <div className="year-label">Year {year + 1}</div>
            <div className="year-semesters">
              <SemesterColumn
                index={fallIndex}
                courses={semesters[fallIndex]}
                courseMap={courseMap}
                creditsMap={creditsMap}
                isActive={activeSemIndex === fallIndex}
                onColumnClick={() => onSemesterClick(fallIndex)}
                onRemoveCourse={(key) => onRemoveCourse(key, fallIndex)}
                draggingId={draggingId}
              />
              <SemesterColumn
                index={springIndex}
                courses={semesters[springIndex]}
                courseMap={courseMap}
                creditsMap={creditsMap}
                isActive={activeSemIndex === springIndex}
                onColumnClick={() => onSemesterClick(springIndex)}
                onRemoveCourse={(key) => onRemoveCourse(key, springIndex)}
                draggingId={draggingId}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
