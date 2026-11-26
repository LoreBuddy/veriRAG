import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.observability.http_logging import add_http_logging_middleware
from app.api import router

logger = logging.getLogger("app.main")


def create_app() -> FastAPI:
    app = FastAPI(
        docs_url="/swagger",
    )

    app.add_middleware(
        CORSMiddleware,
        # allow_origins=settings.ALLOWED_ORIGINS,
        # allow_credentials=True,
        allow_origins=["*"],
        allow_credentials=False,  # MUST be False when origins="*"
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)

    return app
