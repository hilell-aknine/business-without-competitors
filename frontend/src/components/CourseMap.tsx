'use client';

import { useRouter } from 'next/navigation';
import { Lesson } from '@/types';

interface CourseMapProps {
  lessons: Lesson[];
}

export default function CourseMap({ lessons }: CourseMapProps) {
  const router = useRouter();

  if (lessons.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p>אין שיעורים זמינים עדיין</p>
      </div>
    );
  }

  const handleLessonClick = (lesson: Lesson) => {
    if (!lesson.is_locked) {
      router.push(`/lesson/${lesson.id}`);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {lessons.map((lesson, index) => (
        <div
          key={lesson.id}
          onClick={() => handleLessonClick(lesson)}
          className={`lesson-card ${
            lesson.is_completed
              ? 'lesson-card-completed'
              : lesson.is_locked
              ? 'lesson-card-locked'
              : 'lesson-card-unlocked'
          }`}
        >
          {/* Lesson Number Badge */}
          <div className="flex items-start justify-between mb-3">
            <span
              className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                lesson.is_completed
                  ? 'bg-accent-500 text-white'
                  : lesson.is_locked
                  ? 'bg-gray-300 text-gray-500'
                  : 'bg-primary-500 text-white'
              }`}
            >
              {index + 1}
            </span>

            {/* Status Icon */}
            {lesson.is_completed && (
              <span className="text-accent-500 text-xl">✓</span>
            )}
            {lesson.is_locked && (
              <span className="text-gray-400 text-xl">🔒</span>
            )}
          </div>

          {/* Title */}
          <h3
            className={`font-semibold text-lg mb-2 ${
              lesson.is_locked ? 'text-gray-400' : 'text-gray-900'
            }`}
          >
            {lesson.title}
          </h3>

          {/* Description */}
          {lesson.description && (
            <p
              className={`text-sm line-clamp-2 ${
                lesson.is_locked ? 'text-gray-400' : 'text-gray-600'
              }`}
            >
              {lesson.description}
            </p>
          )}

          {/* CTA */}
          {!lesson.is_locked && !lesson.is_completed && (
            <div className="mt-4 text-primary-500 text-sm font-medium">
              התחל לצפות &larr;
            </div>
          )}
          {lesson.is_completed && (
            <div className="mt-4 text-accent-600 text-sm font-medium">
              צפה שוב &larr;
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
