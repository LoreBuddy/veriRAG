from app.infra.auth import get_current_user
from fastapi import Depends, FastAPI


def test_openapi_uses_http_bearer_for_application_access_tokens():
    app = FastAPI()
    app.add_api_route(
        "/protected",
        lambda current_user=Depends(get_current_user): current_user,
        dependencies=[],
    )

    schema = app.openapi()
    assert schema["components"]["securitySchemes"] == {
        "HTTPBearer": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Application access token issued by /auth/supabase/exchange or /auth/refresh.",
        }
    }
