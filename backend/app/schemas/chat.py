from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from ..models.chat import AgentType


class ChatRequest(BaseModel):
    message: str
    agent_type: AgentType
    lesson_id: Optional[int] = None
    session_id: Optional[int] = None  # Continue existing session


class ChatResponse(BaseModel):
    message: str
    session_id: int
    agent_type: AgentType


class MessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True


class ChatHistoryResponse(BaseModel):
    session_id: int
    agent_type: AgentType
    messages: list[MessageResponse]
