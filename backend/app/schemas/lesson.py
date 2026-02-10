from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class LessonResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    youtube_url: str
    order: int
    is_completed: bool = False
    is_locked: bool = False

    class Config:
        from_attributes = True


class LessonListResponse(BaseModel):
    lessons: list[LessonResponse]
    total: int


class ProgressUpdate(BaseModel):
    completed: bool = False
    watch_progress_seconds: Optional[int] = None
