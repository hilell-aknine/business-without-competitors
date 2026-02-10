from sqlmodel import SQLModel, Field, Relationship
from datetime import datetime
from typing import Optional, TYPE_CHECKING
import json

if TYPE_CHECKING:
    from .lesson import UserProgress
    from .chat import ChatSession


class User(SQLModel, table=True):
    """User account model"""
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    profile: Optional["UserProfile"] = Relationship(back_populates="user")
    progress: list["UserProgress"] = Relationship(back_populates="user")
    chat_sessions: list["ChatSession"] = Relationship(back_populates="user")


class UserProfile(SQLModel, table=True):
    """User profile with business details for personalization"""
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", unique=True)

    # Core profile fields
    niche: str  # תחום העסק
    target_audience: str  # קהל יעד
    business_goal: str  # מטרה עסקית

    # Extended profile as JSON
    profile_json: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    user: Optional[User] = Relationship(back_populates="profile")

    @property
    def extra_data(self) -> dict:
        """Parse JSON profile data"""
        if self.profile_json:
            return json.loads(self.profile_json)
        return {}

    @extra_data.setter
    def extra_data(self, value: dict):
        self.profile_json = json.dumps(value, ensure_ascii=False)
