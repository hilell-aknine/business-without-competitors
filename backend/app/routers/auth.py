"""
Authentication Router - הרשמה והתחברות
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlmodel import Session, select
import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional

from ..database import get_session
from ..config import get_settings
from ..models.user import User, UserProfile
from ..schemas.user import UserCreate, UserResponse, Token, ProfileCreate, ProfileResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode('utf-8'),
        hashed_password.encode('utf-8')
    )


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(
        password.encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = session.exec(select(User).where(User.email == email)).first()
    if user is None:
        raise credentials_exception
    return user


@router.post("/register", response_model=UserResponse)
async def register(user_data: UserCreate, session: Session = Depends(get_session)):
    """Register a new user"""
    # Check if user exists
    existing_user = session.exec(select(User).where(User.email == user_data.email)).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # Create user
    user = User(
        email=user_data.email,
        password_hash=get_password_hash(user_data.password)
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        created_at=user.created_at,
        has_profile=False
    )


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session)
):
    """Login and get access token"""
    user = session.exec(select(User).where(User.email == form_data.username)).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return Token(access_token=access_token)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Get current user info"""
    profile = session.exec(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    ).first()

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        created_at=current_user.created_at,
        has_profile=profile is not None
    )


@router.post("/onboarding", response_model=ProfileResponse)
async def create_profile(
    profile_data: ProfileCreate,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Create or update user profile (onboarding)"""
    # Check for existing profile
    existing_profile = session.exec(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    ).first()

    if existing_profile:
        # Update existing profile
        existing_profile.niche = profile_data.niche
        existing_profile.target_audience = profile_data.target_audience
        existing_profile.business_goal = profile_data.business_goal
        existing_profile.updated_at = datetime.utcnow()
        if profile_data.extra_data:
            existing_profile.extra_data = profile_data.extra_data
        session.add(existing_profile)
        session.commit()
        session.refresh(existing_profile)
        return ProfileResponse(
            id=existing_profile.id,
            niche=existing_profile.niche,
            target_audience=existing_profile.target_audience,
            business_goal=existing_profile.business_goal,
            created_at=existing_profile.created_at
        )

    # Create new profile
    profile = UserProfile(
        user_id=current_user.id,
        niche=profile_data.niche,
        target_audience=profile_data.target_audience,
        business_goal=profile_data.business_goal
    )
    if profile_data.extra_data:
        profile.extra_data = profile_data.extra_data

    session.add(profile)
    session.commit()
    session.refresh(profile)

    return ProfileResponse(
        id=profile.id,
        niche=profile.niche,
        target_audience=profile.target_audience,
        business_goal=profile.business_goal,
        created_at=profile.created_at
    )


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    """Get user's profile"""
    profile = session.exec(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    ).first()

    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found. Please complete onboarding."
        )

    return ProfileResponse(
        id=profile.id,
        niche=profile.niche,
        target_audience=profile.target_audience,
        business_goal=profile.business_goal,
        created_at=profile.created_at
    )
