from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.origin import enforce_trusted_auth_origin
from app.auth.service import RefreshTokenRejected, TokenGrant, token_service
from app.auth.supabase import (
    SupabaseAuthUnavailable,
    SupabaseTokenRejected,
    verify_supabase_access_token,
)
from app.db.models import User
from app.infra.auth import get_current_user, get_db
from app.schemas import (
    AuthResponse,
    CurrentUserResponse,
    LogoutResponse,
    SupabaseExchangeRequest,
)

authRou = APIRouter(tags=["auth"])


def _auth_response(grant: TokenGrant) -> AuthResponse:
    return AuthResponse(
        access_token=grant.access_token,
        username=grant.username,
        role=grant.role,
    )


def _refresh_cookie(request: Request) -> str | None:
    return request.cookies.get(token_service.cookie_name)


def _trusted_auth_origin(request: Request) -> None:
    enforce_trusted_auth_origin(request, settings=token_service.settings)


def _reject_refresh(response: Response, exc: RefreshTokenRejected) -> NoReturn:
    token_service.clear_refresh_cookie(response)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="无效或过期的刷新令牌",
        headers={
            "WWW-Authenticate": "Bearer",
            "Set-Cookie": response.headers["set-cookie"],
        },
    ) from exc


@authRou.post("/auth/supabase/exchange", response_model=AuthResponse)
def exchange_supabase_session(
    request: SupabaseExchangeRequest,
    response: Response,
    _origin_guard: None = Depends(_trusted_auth_origin),
    db: Session = Depends(get_db),
) -> AuthResponse:
    try:
        identity = verify_supabase_access_token(
            request.access_token.get_secret_value(),
            settings=token_service.settings,
        )
    except SupabaseTokenRejected as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Supabase 登录已失效，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except SupabaseAuthUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="身份验证服务暂时不可用，请稍后重试",
        ) from exc

    user = db.query(User).filter(User.zid == identity.user_id).one_or_none()
    if user is None:
        user = db.query(User).filter(User.username == identity.email).one_or_none()
        if user is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该邮箱已关联其他账号，请联系管理员",
            )
        user = User(
            zid=identity.user_id,
            username=identity.email,
            password_hash=None,
            role="user",
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            user = db.query(User).filter(User.zid == identity.user_id).one_or_none()
            if user is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="账号创建冲突，请重试",
                ) from None

    grant = token_service.issue(db, user)
    token_service.set_refresh_cookie(response, grant.refresh_token)
    return _auth_response(grant)



@authRou.post("/auth/refresh", response_model=AuthResponse)
def refresh(request: Request,   response: Response,
    _origin_guard: None = Depends(_trusted_auth_origin),
    db: Session = Depends(get_db),
) -> AuthResponse:
    try:
        grant = token_service.rotate(db, _refresh_cookie(request))
    except RefreshTokenRejected as exc:
        _reject_refresh(response, exc)
    token_service.set_refresh_cookie(response, grant.refresh_token)
    return _auth_response(grant)


@authRou.post("/auth/logout", response_model=LogoutResponse)
def logout(
    request: Request,
    response: Response,
    _origin_guard: None = Depends(_trusted_auth_origin),
    db: Session = Depends(get_db),
) -> LogoutResponse:
    revoked = token_service.logout(db, _refresh_cookie(request))
    token_service.clear_refresh_cookie(response)
    return LogoutResponse(message="已退出登录", revoked_count=revoked)


@authRou.post("/auth/logout-all", response_model=LogoutResponse)
def logout_all(
    response: Response,
    _origin_guard: None = Depends(_trusted_auth_origin),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LogoutResponse:
    revoked = token_service.logout_all(db, user_id=current_user.id)
    token_service.clear_refresh_cookie(response)
    return LogoutResponse(message="已退出所有设备", revoked_count=revoked)


@authRou.get("/auth/me", response_model=CurrentUserResponse)
def me(current_user: User = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(username=current_user.username, role=current_user.role)
