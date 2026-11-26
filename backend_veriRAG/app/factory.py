from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="My Project")

    @app.get("/")
    def hello():
        return {"message": "Hello, World!"}

    return app