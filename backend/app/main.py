"""
FastAPI Main Application - עסק ללא מתחרים LMS
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import init_db
from .routers import auth_router, lessons_router, chat_router, tools_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup"""
    init_db()
    yield


app = FastAPI(
    title="עסק ללא מתחרים - LMS",
    description="מערכת למידה עם סוכני AI",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router)
app.include_router(lessons_router)
app.include_router(chat_router)
app.include_router(tools_router)


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "עסק ללא מתחרים LMS API",
        "version": "1.0.0"
    }


@app.get("/api/health")
async def health_check():
    """API health check"""
    return {"status": "healthy"}
