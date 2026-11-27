from app.infra.auth import get_current_user
from fastapi import Depends, FastAPI


def test_openapi_uses_oauth2_password_for_application_access_tokens():
    app = FastAPI()
    app.add_api_route(
        "/protected",
        lambda current_user=Depends(get_current_user): current_user,
        dependencies=[],
    )

    schema = app.openapi()
    assert schema["components"]["securitySchemes"] == {
        "OAuth2PasswordBearer": {
            "type": "oauth2",
            "flows": {
                "password": {
                    "scopes": {},
                    "tokenUrl": "/auth/token",
                }
            },
        }
    }
