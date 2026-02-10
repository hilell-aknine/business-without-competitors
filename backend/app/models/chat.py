from sqlmodel import SQLModel, Field, Relationship
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from enum import Enum

if TYPE_CHECKING:
    from .user import User
    from .lesson import Lesson


class AgentType(str, Enum):
    """Available AI agents"""
    COACH = "coach"  # מאמן אישי - צביקה/תמר
    ACCELERATOR = "accelerator"  # מאיץ למידה 10X
    TOOLS = "tools"  # ארסנל כלים


class ChatSession(SQLModel, table=True):
    """Chat session with an AI agent"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    lesson_id: Optional[int] = Field(default=None, foreign_key="lesson.id", index=True)

    agent_type: AgentType

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    user: Optional["User"] = Relationship(back_populates="chat_sessions")
    lesson: Optional["Lesson"] = Relationship(back_populates="chat_sessions")
    messages: list["ChatMessage"] = Relationship(back_populates="session")


class ChatMessage(SQLModel, table=True):
    """Individual message in a chat session"""
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="chatsession.id", index=True)

    role: str  # "user" or "assistant"
    content: str

    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    session: Optional[ChatSession] = Relationship(back_populates="messages")
