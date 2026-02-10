from .auth import router as auth_router
from .lessons import router as lessons_router
from .chat import router as chat_router
from .tools import router as tools_router

__all__ = [
    "auth_router",
    "lessons_router",
    "chat_router",
    "tools_router",
]
