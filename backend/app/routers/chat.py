"""
Chat Router - שיחות עם סוכני AI
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from datetime import datetime
from typing import Optional

from ..database import get_session
from ..models.user import User, UserProfile
from ..models.lesson import Lesson
from ..models.chat import ChatSession, ChatMessage, AgentType
from ..schemas.chat import ChatRequest, ChatResponse, ChatHistoryResponse, MessageResponse
from ..services.ai_engine import get_agent_response
from .auth import get_current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/", response_model=ChatResponse)
async def send_message(
    chat_request: ChatRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Send a message to an AI agent"""
    # Get user profile for personalization
    profile = session.exec(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    ).first()

    # Get lesson if provided
    lesson = None
    if chat_request.lesson_id:
        lesson = session.get(Lesson, chat_request.lesson_id)

    # Get or create chat session
    chat_session = None
    if chat_request.session_id:
        chat_session = session.get(ChatSession, chat_request.session_id)
        if chat_session and chat_session.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to this chat session"
            )

    if not chat_session:
        # Create new session
        chat_session = ChatSession(
            user_id=current_user.id,
            lesson_id=chat_request.lesson_id,
            agent_type=chat_request.agent_type
        )
        session.add(chat_session)
        session.commit()
        session.refresh(chat_session)

    # Get chat history
    history = session.exec(
        select(ChatMessage)
        .where(ChatMessage.session_id == chat_session.id)
        .order_by(ChatMessage.created_at)
    ).all()

    # Save user message
    user_message = ChatMessage(
        session_id=chat_session.id,
        role="user",
        content=chat_request.message
    )
    session.add(user_message)
    session.commit()

    # Get AI response
    ai_response = await get_agent_response(
        user_message=chat_request.message,
        agent_type=chat_request.agent_type,
        profile=profile,
        lesson=lesson,
        chat_history=list(history)
    )

    # Save AI response
    assistant_message = ChatMessage(
        session_id=chat_session.id,
        role="assistant",
        content=ai_response
    )
    session.add(assistant_message)

    # Update session timestamp
    chat_session.updated_at = datetime.utcnow()
    session.add(chat_session)
    session.commit()

    return ChatResponse(
        message=ai_response,
        session_id=chat_session.id,
        agent_type=chat_request.agent_type
    )


@router.get("/history/{lesson_id}", response_model=list[ChatHistoryResponse])
async def get_chat_history(
    lesson_id: int,
    agent_type: Optional[AgentType] = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get chat history for a lesson"""
    query = select(ChatSession).where(
        ChatSession.user_id == current_user.id,
        ChatSession.lesson_id == lesson_id
    )

    if agent_type:
        query = query.where(ChatSession.agent_type == agent_type)

    sessions = session.exec(query.order_by(ChatSession.updated_at.desc())).all()

    result = []
    for chat_session in sessions:
        messages = session.exec(
            select(ChatMessage)
            .where(ChatMessage.session_id == chat_session.id)
            .order_by(ChatMessage.created_at)
        ).all()

        result.append(ChatHistoryResponse(
            session_id=chat_session.id,
            agent_type=chat_session.agent_type,
            messages=[
                MessageResponse(
                    id=msg.id,
                    role=msg.role,
                    content=msg.content,
                    created_at=msg.created_at
                )
                for msg in messages
            ]
        ))

    return result


@router.get("/sessions", response_model=list[ChatHistoryResponse])
async def get_all_sessions(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get all chat sessions for the current user"""
    sessions = session.exec(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.updated_at.desc())
    ).all()

    result = []
    for chat_session in sessions:
        messages = session.exec(
            select(ChatMessage)
            .where(ChatMessage.session_id == chat_session.id)
            .order_by(ChatMessage.created_at)
        ).all()

        result.append(ChatHistoryResponse(
            session_id=chat_session.id,
            agent_type=chat_session.agent_type,
            messages=[
                MessageResponse(
                    id=msg.id,
                    role=msg.role,
                    content=msg.content,
                    created_at=msg.created_at
                )
                for msg in messages
            ]
        ))

    return result
