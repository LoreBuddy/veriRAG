from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import factory

FRONTEND_ORIGIN = "https://verirag.ucrossgram.workers.dev"


def _settings(*, origins: list[str], allow_credentials: bool):
    return SimpleNamespace(
        security=SimpleNamespace(
            cors_origins=origins,
            cors_allow_credentials=allow_credentials,
        )
    )


def test_auth_preflight_allows_configured_credentialed_frontend(monkeypatch):
    monkeypatch.setattr(
        factory,
        "get_settings",
        lambda: _settings(origins=[FRONTEND_ORIGIN], allow_credentials=True),
    )

    with TestClient(factory.create_app()) as client:
        response = client.options(
            "/auth/supabase/exchange",
            headers={
                "Origin": FRONTEND_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "POST" in response.headers["access-control-allow-methods"]


def test_auth_preflight_does_not_allow_unconfigured_frontend(monkeypatch):
    monkeypatch.setattr(
        factory,
        "get_settings",
        lambda: _settings(
            origins=["https://trusted.example.test"], allow_credentials=True
        ),
    )

    with TestClient(factory.create_app()) as client:
        response = client.options(
            "/auth/supabase/exchange",
            headers={
                "Origin": FRONTEND_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
