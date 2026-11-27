from fastapi import APIRouter

from app.api.auth import authRou
from app.api.capabilities import capRou
from app.api.threads import router as threads_router
from app.api.runs import runRou

from app.api.documents import docRou
from app.api.evaluations import evaRou
from app.api.health import healthRou
from app.api.models import modelRou

router = APIRouter()
router.include_router(authRou)
router.include_router(capRou)
router.include_router(threads_router)
router.include_router(runRou)

router.include_router(healthRou)
router.include_router(modelRou)
router.include_router(evaRou)
router.include_router(docRou)
