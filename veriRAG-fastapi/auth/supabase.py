from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit
from uuid import UUID

import httpx

from backend.core.settings import SecuritySettings


class SupabaseTokenRejected(ValueError):
    pass


class SupabaseAuthUnavailable(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class SupabaseIdentity:
    user_id: UUID
    email: str


def verify_supabase_access_token(
    access_token: str,
    *,
    settings: SecuritySettings,
) -> SupabaseIdentity:
    project_url = settings.supabase_url.strip().rstrip("/")
    publishable_key = settings.supabase_publishable_key.get_secret_value().strip()
    parsed_url = urlsplit(project_url)
    http_is_local = parsed_url.hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        not project_url
        or parsed_url.scheme not in {"https", "http"}
        or (parsed_url.scheme == "http" and not http_is_local)
        or not parsed_url.netloc
        or parsed_url.path not in {"", "/"}
        or parsed_url.username is not None
        or parsed_url.password is not None
        or parsed_url.query
        or parsed_url.fragment
        or not publishable_key
    ):
        raise SupabaseAuthUnavailable("Supabase Auth is not configured")

    try:
        with httpx.Client(timeout=5.0, follow_redirects=False) as client:
            response = client.get(
                f"{project_url}/auth/v1/user",
                headers={
                    "apikey": publishable_key,
                    "Authorization": f"Bearer {access_token}",
                },
            )
    except httpx.TimeoutException as exc:
        raise SupabaseAuthUnavailable("Supabase Auth request timed out") from exc
    except httpx.RequestError as exc:
        raise SupabaseAuthUnavailable("Supabase Auth is unavailable") from exc

    if response.status_code in {401, 403}:
        raise SupabaseTokenRejected("Supabase access token was rejected")
    if response.status_code != 200:
        raise SupabaseAuthUnavailable("Supabase Auth returned an unexpected response")

    try:
        payload = response.json()
    except ValueError as exc:
        raise SupabaseAuthUnavailable("Supabase Auth returned invalid data") from exc
    if not isinstance(payload, dict):
        raise SupabaseAuthUnavailable("Supabase Auth returned invalid data")

    raw_id = payload.get("id")
    email = payload.get("email")
    confirmed_at = payload.get("email_confirmed_at")
    if (
        not isinstance(raw_id, str)
        or not isinstance(email, str)
        or not email.strip()
        or not isinstance(confirmed_at, str)
        or not confirmed_at
    ):
        raise SupabaseTokenRejected("A confirmed Supabase email is required")
    try:
        user_id = UUID(raw_id)
    except ValueError as exc:
        raise SupabaseAuthUnavailable("Supabase Auth returned an invalid user ID") from exc

    return SupabaseIdentity(user_id=user_id, email=email.strip().casefold())


__all__ = [
    "SupabaseAuthUnavailable",
    "SupabaseIdentity",
    "SupabaseTokenRejected",
    "verify_supabase_access_token",
]
