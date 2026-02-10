"""
AI Engine - Core AI logic using Claude
"""

from anthropic import Anthropic
from typing import Optional
from ..config import get_settings
from ..models.chat import AgentType, ChatMessage
from ..models.user import UserProfile
from ..models.lesson import Lesson
from .agents import get_agent_system_prompt
from .transcript import get_relevant_chunks, format_context_for_prompt

settings = get_settings()


def get_anthropic_client() -> Anthropic:
    """Get Anthropic client instance"""
    return Anthropic(api_key=settings.anthropic_api_key)


async def get_agent_response(
    user_message: str,
    agent_type: AgentType,
    profile: Optional[UserProfile] = None,
    lesson: Optional[Lesson] = None,
    chat_history: list[ChatMessage] = None,
    tool_name: str = ""
) -> str:
    """
    Get response from the appropriate AI agent

    Args:
        user_message: The user's message
        agent_type: Which agent to use (coach, accelerator, tools)
        profile: User's business profile for personalization
        lesson: Current lesson for context
        chat_history: Previous messages in this session
        tool_name: Specific tool name if using tools agent

    Returns:
        AI response string
    """
    client = get_anthropic_client()

    # Get relevant lesson context if available
    lesson_context = ""
    if lesson and lesson.transcript_chunks:
        relevant_chunks = get_relevant_chunks(user_message, lesson.transcript_chunks)
        lesson_context = format_context_for_prompt(relevant_chunks)

    # Get system prompt for this agent
    system_prompt = get_agent_system_prompt(
        agent_type=agent_type,
        profile=profile,
        lesson_context=lesson_context,
        tool_name=tool_name
    )

    # Build message history
    messages = []
    if chat_history:
        for msg in chat_history:
            messages.append({
                "role": msg.role,
                "content": msg.content
            })

    # Add current user message
    messages.append({
        "role": "user",
        "content": user_message
    })

    # Call Claude API
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        system=system_prompt,
        messages=messages
    )

    return response.content[0].text


def get_available_tools() -> list[dict]:
    """Get list of available tools in the arsenal"""
    from .agents import TOOL_PROMPTS

    tools = [
        {
            "id": "headline_generator",
            "name": "מחולל כותרות",
            "description": "יוצר 10 כותרות שיווקיות לפי נוסחאות מוכחות",
            "icon": "✍️"
        },
        {
            "id": "email_sequence",
            "name": "רצף מיילים",
            "description": "יוצר רצף של 5 מיילים שיווקיים",
            "icon": "📧"
        },
        {
            "id": "competitor_analysis",
            "name": "ניתוח מתחרים",
            "description": "מנתח את השוק והמתחרים שלך",
            "icon": "🔍"
        },
        {
            "id": "content_calendar",
            "name": "לוח תוכן",
            "description": "יוצר לוח תוכן חודשי מפורט",
            "icon": "📅"
        },
        {
            "id": "offer_builder",
            "name": "בונה הצעות",
            "description": "עוזר לבנות הצעה בלתי ניתנת לסירוב",
            "icon": "💰"
        },
        {
            "id": "avatar_builder",
            "name": "בונה אווטאר",
            "description": "יוצר פרופיל לקוח אידיאלי מפורט",
            "icon": "👤"
        },
    ]

    return tools
