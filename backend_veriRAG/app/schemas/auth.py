from pydantic import BaseModel, ConfigDict, Field, SecretStr


class SupabaseExchangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: SecretStr = Field(min_length=1, max_length=8192, repr=False)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    role: str


class CurrentUserResponse(BaseModel):
    username: str
    role: str


class LogoutResponse(BaseModel):
    message: str
    revoked_count: int = 0
