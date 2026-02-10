from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional


class UserCreate(BaseModel):
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    created_at: datetime
    has_profile: bool = False

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ProfileCreate(BaseModel):
    niche: str  # תחום העסק
    target_audience: str  # קהל יעד
    business_goal: str  # מטרה עסקית
    extra_data: Optional[dict] = None


class ProfileResponse(BaseModel):
    id: int
    niche: str
    target_audience: str
    business_goal: str
    created_at: datetime

    class Config:
        from_attributes = True
