"""API package. Import the application router from app.api.router."""
from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.capabilities import router as capabilities_router
from app.api.routes.documents import router as documents_router
from app.api.routes.evaluations import router as evaluations_router
from app.api.routes.health import router as health_router
from app.api.routes.models import router as models_router
from app.api.routes.runs import router as runs_router
from app.api.routes.threads import router as threads_router

router = APIRouter()
router.include_router(health_router)
router.include_router(auth_router)
router.include_router(capabilities_router)
router.include_router(models_router)
router.include_router(evaluations_router)
router.include_router(threads_router)
router.include_router(documents_router)
router.include_router(runs_router)
