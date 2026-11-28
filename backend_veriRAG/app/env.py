"""从 backend 根目录加载 .env；由入口在导入其它 backend 模块前调用一次。"""

from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parent
ENV_FILE = BACKEND_ROOT / ".env"
_LOADED = False


def load_env() -> None:
    global _LOADED
    if _LOADED: return
    load_dotenv(ENV_FILE)
    _LOADED = True
