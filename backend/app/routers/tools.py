"""
Tools Router - ארסנל כלים
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import Optional

from ..database import get_session
from ..models.user import User, UserProfile
from ..models.chat import AgentType
from ..services.ai_engine import get_available_tools, get_agent_response
from .auth import get_current_user

router = APIRouter(prefix="/api/tools", tags=["tools"])


class ToolRequest(BaseModel):
    tool_id: str
    input_data: Optional[str] = None


class ToolResponse(BaseModel):
    tool_id: str
    result: str


@router.get("/")
async def list_tools():
    """Get list of available tools in the arsenal"""
    return get_available_tools()


@router.post("/execute", response_model=ToolResponse)
async def execute_tool(
    request: ToolRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Execute a specific tool from the arsenal"""
    # Validate tool exists
    available_tools = get_available_tools()
    tool = next((t for t in available_tools if t["id"] == request.tool_id), None)

    if not tool:
        raise HTTPException(
            status_code=404,
            detail=f"Tool '{request.tool_id}' not found"
        )

    # Get user profile
    profile = session.exec(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    ).first()

    # Build the user message based on input
    if request.input_data:
        user_message = request.input_data
    else:
        user_message = f"בצע את הכלי: {tool['name']}"

    # Get AI response using the tools agent
    result = await get_agent_response(
        user_message=user_message,
        agent_type=AgentType.TOOLS,
        profile=profile,
        tool_name=request.tool_id
    )

    return ToolResponse(
        tool_id=request.tool_id,
        result=result
    )
