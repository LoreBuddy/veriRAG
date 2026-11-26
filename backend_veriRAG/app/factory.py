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
        allow_origins=[
            "https://verirag.ucrossgram.workers.dev",
            "http://localhost:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)

    return app
