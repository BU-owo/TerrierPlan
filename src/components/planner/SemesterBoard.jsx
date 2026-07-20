import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import SemesterColumn from './SemesterColumn';
import CourseCard from './CourseCard';

export default function SemesterBoard({
  semesters,
  courseMap,
  creditsMap,
  activeSemIndex,
  onSemesterClick,
  onMoveCourse,
  onRemoveCourse,
}) {
  const [draggingId, setDraggingId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function handleDragStart({ active }) {
    setDraggingId(active.id);
  }

  function handleDragEnd({ active, over }) {
    setDraggingId(null);
    if (!over) return;
    const courseKey = active.id;
    const match = over.id.match(/^col-(\d+)$/);
    if (!match) return;
    const destIndex = parseInt(match[1], 10);
    const srcIndex = semesters.findIndex((sem) => sem.includes(courseKey));
    if (srcIndex === -1 || srcIndex === destIndex) return;
    onMoveCourse(courseKey, srcIndex, destIndex);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <div className="semester-board">
        {semesters.map((semCourses, i) => (
          <SemesterColumn
            key={i}
            index={i}
            courses={semCourses}
            courseMap={courseMap}
            creditsMap={creditsMap}
            isActive={activeSemIndex === i}
            onColumnClick={() => onSemesterClick(i)}
            onRemoveCourse={(key) => onRemoveCourse(key, i)}
            draggingId={draggingId}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {draggingId ? (
          <CourseCard
            courseKey={draggingId}
            data={courseMap[draggingId]}
            credits={creditsMap[draggingId]}
            isDragOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
