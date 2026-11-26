from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import router


def create_app() -> FastAPI:
    
    app = FastAPI(
        docs_url="/swagger",
        title="veriRAG",
        description="RAG for Production",
        version="1.1.1",
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
