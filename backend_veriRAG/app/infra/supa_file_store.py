from __future__ import annotations

import os
from functools import lru_cache

from supabase import Client, create_client

from dotenv import load_dotenv

load_dotenv()


@lru_cache
def _client() -> Client:
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SECRET_KEY"],
    )


def _bucket():
    return _client().storage.from_(os.environ.get("SUPABASE_BUCKET", "aidresupadoc"))


def put_file(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    _bucket().upload(key, data, {"content-type": content_type, "upsert": "true"})


def get_file(key: str) -> bytes:
    return _bucket().download(key)


def delete_file(key: str) -> None:
    _bucket().remove([key])



# uv run python -c "from app.infra.supa_aidres_file_bucket import put_file, get_file; put_file('test/hello.txt', b'hi'); print(get_file('test/hello.txt'))"

from pathlib import Path

from app.core.settings import get_settings


def local_path(key: str) -> Path:
    root = get_settings().storage.upload_dir.resolve()
    path = (root / key).resolve()
    if root not in path.parents:
        raise ValueError(f"object key escapes upload dir: {key}")
    return path


def push_local(key: str) -> None:
    """Upload the local copy of `key` to Supabase."""
    put_file(key, local_path(key).read_bytes())


def ensure_local(key: str) -> Path:
    """Return a local path for `key`, downloading from Supabase if missing."""
    path = local_path(key)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(get_file(key))
        partial.replace(path)  # atomic: never leaves a half-written file
    return path


# uv run python -c "from app.infra.supa_file_store import put_file, ensure_local; put_file('test/a.txt', b'hi'); print(ensure_local('test/a.txt').read_bytes())"
