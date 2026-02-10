from sqlmodel import SQLModel, Field, Relationship
from datetime import datetime
from typing import Optional, TYPE_CHECKING
import json

if TYPE_CHECKING:
    from .user import User
    from .chat import ChatSession


class Lesson(SQLModel, table=True):
    """Course lesson with video and transcript"""
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    youtube_url: str

    # Transcript data
    transcript: Optional[str] = None  # Full transcript
    transcript_chunks_json: Optional[str] = None  # JSON array of chunks for RAG

    # Ordering and unlocking
    order: int = Field(default=0, index=True)
    is_published: bool = Field(default=True)

    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    progress: list["UserProgress"] = Relationship(back_populates="lesson")
    chat_sessions: list["ChatSession"] = Relationship(back_populates="lesson")

    @property
    def transcript_chunks(self) -> list[str]:
        """Parse transcript chunks from JSON"""
        if self.transcript_chunks_json:
            return json.loads(self.transcript_chunks_json)
        return []

    @transcript_chunks.setter
    def transcript_chunks(self, chunks: list[str]):
        self.transcript_chunks_json = json.dumps(chunks, ensure_ascii=False)


class UserProgress(SQLModel, table=True):
    """Tracks user progress through lessons"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    lesson_id: int = Field(foreign_key="lesson.id", index=True)

    completed: bool = Field(default=False)
    completed_at: Optional[datetime] = None

    # Optional: track watch progress
    watch_progress_seconds: int = Field(default=0)

    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    user: Optional["User"] = Relationship(back_populates="progress")
    lesson: Optional[Lesson] = Relationship(back_populates="progress")
