from fastapi import FastAPI

from backend_veriRAG import app


def create_app() -> FastAPI:
    app = FastAPI(title="veriRAG", description="RAG for Production", version="1.1.0")

    app.add_middleware(
        CORSMiddleware,
        # allow_origins=settings.ALLOWED_ORIGINS,
        # allow_credentials=True,
        allow_origins=["*"],
        allow_credentials=False,  # MUST be False when origins="*"
        allow_methods=["*"],
        allow_headers=["*"],
    )



    @app.get("/")
    def hello():
        return {"message": "Hello, World!"}

    return app