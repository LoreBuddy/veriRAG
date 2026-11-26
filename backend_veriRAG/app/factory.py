from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="veriRAG", description="RAG for Production", version="1.1.0")

    @app.get("/")
    def hello():
        return {"message": "Hello, World!"}

    return app