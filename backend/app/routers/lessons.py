"""
Lessons Router - שיעורים והתקדמות
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from datetime import datetime
from typing import Optional

from ..database import get_session
from ..models.user import User
from ..models.lesson import Lesson, UserProgress
from ..schemas.lesson import LessonResponse, LessonListResponse, ProgressUpdate
from .auth import get_current_user

router = APIRouter(prefix="/api/lessons", tags=["lessons"])


def check_lesson_locked(
    lesson: Lesson,
    user_id: int,
    session: Session
) -> bool:
    """
    Check if a lesson is locked for a user.
    A lesson is locked if the previous lesson hasn't been completed.
    First lesson (order=0) is always unlocked.
    """
    if lesson.order == 0:
        return False

    # Find previous lesson
    previous_lesson = session.exec(
        select(Lesson)
        .where(Lesson.order == lesson.order - 1)
        .where(Lesson.is_published == True)
    ).first()

    if not previous_lesson:
        return False

    # Check if previous lesson is completed
    progress = session.exec(
        select(UserProgress)
        .where(UserProgress.user_id == user_id)
        .where(UserProgress.lesson_id == previous_lesson.id)
        .where(UserProgress.completed == True)
    ).first()

    return progress is None


@router.get("/", response_model=LessonListResponse)
async def list_lessons(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get all lessons with progress status"""
    lessons = session.exec(
        select(Lesson)
        .where(Lesson.is_published == True)
        .order_by(Lesson.order)
    ).all()

    # Get user's progress
    progress_records = session.exec(
        select(UserProgress)
        .where(UserProgress.user_id == current_user.id)
    ).all()
    progress_map = {p.lesson_id: p for p in progress_records}

    lesson_responses = []
    for lesson in lessons:
        progress = progress_map.get(lesson.id)
        is_completed = progress.completed if progress else False
        is_locked = check_lesson_locked(lesson, current_user.id, session)

        lesson_responses.append(LessonResponse(
            id=lesson.id,
            title=lesson.title,
            description=lesson.description,
            youtube_url=lesson.youtube_url,
            order=lesson.order,
            is_completed=is_completed,
            is_locked=is_locked
        ))

    return LessonListResponse(
        lessons=lesson_responses,
        total=len(lesson_responses)
    )


@router.get("/{lesson_id}", response_model=LessonResponse)
async def get_lesson(
    lesson_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get a specific lesson"""
    lesson = session.get(Lesson, lesson_id)
    if not lesson or not lesson.is_published:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lesson not found"
        )

    # Check if locked
    is_locked = check_lesson_locked(lesson, current_user.id, session)
    if is_locked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This lesson is locked. Complete the previous lesson first."
        )

    # Get progress
    progress = session.exec(
        select(UserProgress)
        .where(UserProgress.user_id == current_user.id)
        .where(UserProgress.lesson_id == lesson_id)
    ).first()

    return LessonResponse(
        id=lesson.id,
        title=lesson.title,
        description=lesson.description,
        youtube_url=lesson.youtube_url,
        order=lesson.order,
        is_completed=progress.completed if progress else False,
        is_locked=False
    )


@router.post("/{lesson_id}/progress")
async def update_progress(
    lesson_id: int,
    progress_data: ProgressUpdate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Update user's progress on a lesson"""
    lesson = session.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lesson not found"
        )

    # Get or create progress record
    progress = session.exec(
        select(UserProgress)
        .where(UserProgress.user_id == current_user.id)
        .where(UserProgress.lesson_id == lesson_id)
    ).first()

    if not progress:
        progress = UserProgress(
            user_id=current_user.id,
            lesson_id=lesson_id
        )

    # Update progress
    if progress_data.completed:
        progress.completed = True
        progress.completed_at = datetime.utcnow()

    if progress_data.watch_progress_seconds is not None:
        progress.watch_progress_seconds = progress_data.watch_progress_seconds

    session.add(progress)
    session.commit()

    return {"status": "success", "completed": progress.completed}
