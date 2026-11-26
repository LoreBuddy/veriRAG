from __future__ import annotations

from uuid import UUID

import httpx
import pytest
from pydantic import SecretStr, ValidationError
from starlette.responses import Response

from app.api.routes import auth as auth_routes
from app.auth.supabase import (
    SupabaseAuthUnavailable,
    SupabaseIdentity,
    SupabaseTokenRejected,
    verify_supabase_access_token,
)
from app.auth.service import TokenGrant
from app.core.settings import SecuritySettings
from app.db.models import User
from app.schemas import SupabaseExchangeRequest


def _settings() -> SecuritySettings:
    return SecuritySettings(
        _env_file=None,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key=SecretStr("sb_publishable_test-key"),
    )


def _mock_client(
    monkeypatch: pytest.MonkeyPatch,
    handler: httpx.MockTransport,
) -> None:
    original_client = httpx.Client

    def make_client(**kwargs: object) -> httpx.Client:
        return original_client(transport=handler, **kwargs)

    monkeypatch.setattr("backend.auth.supabase.httpx.Client", make_client)


def test_verified_supabase_user_is_resolved_without_exposing_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://project.supabase.co/auth/v1/user"
        assert request.headers["apikey"] == "sb_publishable_test-key"
        assert request.headers["authorization"] == "Bearer provider-token"
        return httpx.Response(
            200,
            json={
                "id": "ef8b1808-286f-4d54-a006-7a29b91684d8",
                "email": "User@Example.com",
                "email_confirmed_at": "2026-11-19T12:00:00Z",
            },
        )

    _mock_client(monkeypatch, httpx.MockTransport(respond))

    identity = verify_supabase_access_token("provider-token", settings=_settings())

    assert str(identity.user_id) == "ef8b1808-286f-4d54-a006-7a29b91684d8"
    assert identity.email == "user@example.com"


@pytest.mark.parametrize("status_code", [401, 403])
def test_rejected_supabase_token_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
) -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(status_code, json={"message": "invalid"})
    )
    _mock_client(monkeypatch, transport)

    with pytest.raises(SupabaseTokenRejected):
        verify_supabase_access_token("bad-token", settings=_settings())


def test_unconfirmed_email_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            json={
                "id": "ef8b1808-286f-4d54-a006-7a29b91684d8",
                "email": "user@example.com",
                "email_confirmed_at": None,
            },
        )
    )
    _mock_client(monkeypatch, transport)

    with pytest.raises(SupabaseTokenRejected):
        verify_supabase_access_token("unconfirmed-token", settings=_settings())


def test_supabase_outage_is_not_treated_as_an_invalid_or_empty_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("unavailable")

    _mock_client(monkeypatch, httpx.MockTransport(fail))

    with pytest.raises(SupabaseAuthUnavailable):
        verify_supabase_access_token("provider-token", settings=_settings())


class _Query:
    def __init__(self, users: list[User]) -> None:
        self.users = users
        self.column = ""
        self.value: object = None

    def filter(self, condition: object) -> _Query:
        self.column = condition.left.key  # type: ignore[attr-defined]
        self.value = condition.right.value  # type: ignore[attr-defined]
        return self

    def one_or_none(self) -> User | None:
        return next(
            (
                user
                for user in self.users
                if getattr(user, self.column) == self.value
            ),
            None,
        )


class _Database:
    def __init__(self) -> None:
        self.users: list[User] = []

    def query(self, _model: type[User]) -> _Query:
        return _Query(self.users)

    def add(self, user: User) -> None:
        user.id = len(self.users) + 1
        self.users.append(user)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass


def test_exchange_maps_supabase_uuid_and_never_accepts_client_role(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity = SupabaseIdentity(
        user_id=UUID("ef8b1808-286f-4d54-a006-7a29b91684d8"),
        email="user@example.com",
    )
    monkeypatch.setattr(
        auth_routes,
        "verify_supabase_access_token",
        lambda _token, *, settings: identity,
    )
    monkeypatch.setattr(
        auth_routes.token_service,
        "issue",
        lambda _db, user: TokenGrant(
            access_token="app-access",
            refresh_token="server-refresh",
            username=user.username,
            role=user.role,
        ),
    )
    monkeypatch.setattr(
        auth_routes.token_service,
        "set_refresh_cookie",
        lambda response, _token: response.set_cookie(
            "supermew_refresh", "server-refresh", httponly=True
        ),
    )
    db = _Database()

    result = auth_routes.exchange_supabase_session(
        SupabaseExchangeRequest(access_token="provider-access"),
        Response(),
        None,
        db,  # type: ignore[arg-type]
    )

    assert len(db.users) == 1
    assert db.users[0].zid == identity.user_id
    assert db.users[0].username == identity.email
    assert db.users[0].role == "user"
    assert db.users[0].password_hash is None
    assert result.role == "user"

    second_result = auth_routes.exchange_supabase_session(
        SupabaseExchangeRequest(access_token="provider-access"),
        Response(),
        None,
        db,  # type: ignore[arg-type]
    )
    assert len(db.users) == 1
    assert second_result.username == result.username
    assert second_result.role == "user"

    with pytest.raises(ValidationError):
        SupabaseExchangeRequest(access_token="provider-access", role="admin")
