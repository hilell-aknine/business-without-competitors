from sqlmodel import SQLModel, create_engine, Session
from .config import get_settings

settings = get_settings()

# SQLite requires check_same_thread=False for FastAPI
connect_args = {"check_same_thread": False} if "sqlite" in settings.database_url else {}
engine = create_engine(settings.database_url, connect_args=connect_args, echo=True)


def init_db():
    """Create all tables"""
    SQLModel.metadata.create_all(engine)


def get_session():
    """Dependency for getting DB session"""
    with Session(engine) as session:
        yield session
