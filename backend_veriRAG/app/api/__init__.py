from fastapi import APIRouter

from app.api.auth import authRou
from app.api.capabilities import capRou
from app.api.threads import router as threads_router
from app.api.runs import runRou

# from app.api.documents import router as documents_router
# from app.api.evaluations import router as evaluations_router
# from app.api.health import router as health_router
# from app.api.models import router as models_router

router = APIRouter()
router.include_router(authRou)
router.include_router(capRou)
router.include_router(threads_router)
router.include_router(runRou)

# router.include_router(health_router)
# router.include_router(models_router)
# router.include_router(evaluations_router)
# router.include_router(documents_router)
