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