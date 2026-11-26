from __future__ import annotations

import asyncio
import re
import secrets
from collections.abc import Awaitable, Callable
from typing import Protocol, cast

import redis.asyncio as redis_async


_KEY_PREFIX_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$")
_WINDOW_MS = 60_000

_SLIDING_WINDOW_LUA = """
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local nonce = ARGV[4]

local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local cutoff_ms = now_ms - window_ms
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff_ms)

local entries = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
local total = 0
for index = 1, #entries, 2 do
    local entry_cost = tonumber(string.match(entries[index], '^(%d+):'))
    if entry_cost == nil then
        return redis.error_reply('invalid embedding rate-limit entry')
    end
    total = total + entry_cost
end

if total + cost > limit then
    local released = 0
    for index = 1, #entries, 2 do
        local entry_cost = tonumber(string.match(entries[index], '^(%d+):'))
        released = released + entry_cost
        if total - released + cost <= limit then
            local wait_ms = tonumber(entries[index + 1]) + window_ms - now_ms
            if wait_ms < 1 then
                wait_ms = 1
            end
            return {0, math.ceil(wait_ms)}
        end
    end
    return {0, window_ms}
end

redis.call('ZADD', key, now_ms, tostring(cost) .. ':' .. nonce)
redis.call('PEXPIRE', key, window_ms * 2)
return {1, 0}
""".strip()


class EmbeddingRequestPacer(Protocol):
    async def wait(self, cost: int) -> None: ...


class RedisEvalClient(Protocol):
    def eval(
        self,
        script: str,
        numkeys: int,
        *keys_and_args: object,
    ) -> Awaitable[object]: ...

    def aclose(self) -> Awaitable[None]: ...


class EmbeddingPacerUnavailable(RuntimeError):
    """The shared Gemini quota schedule could not be checked safely."""

    def __init__(self) -> None:
        super().__init__("Gemini embedding rate limiter is unavailable")


def _response_integer(value: object, *, field_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} cannot be boolean")
    if isinstance(value, bytes):
        value = value.decode("ascii")
    if not isinstance(value, (int, str)):
        raise ValueError(f"{field_name} must be an integer")
    parsed = int(value)
    if parsed < 0:
        raise ValueError(f"{field_name} cannot be negative")
    return parsed


class RedisEmbeddingRequestPacer:
    """Enforce a weighted rolling-minute quota shared by API and worker processes."""

    def __init__(
        self,
        *,
        redis_url: str,
        key_prefix: str,
        requests_per_minute: int,
        client: RedisEvalClient | None = None,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if not isinstance(redis_url, str) or not redis_url.strip():
            raise ValueError("redis_url is required")
        if (
            not isinstance(key_prefix, str)
            or _KEY_PREFIX_RE.fullmatch(key_prefix) is None
        ):
            raise ValueError("key_prefix is invalid")
        if (
            isinstance(requests_per_minute, bool)
            or not isinstance(requests_per_minute, int)
            or requests_per_minute < 1
        ):
            raise ValueError("requests_per_minute must be a positive integer")
        if not callable(sleeper):
            raise TypeError("sleeper must be callable")

        self._redis_url = redis_url
        self._client = client
        self._close_client = client is None
        self._key = f"{key_prefix}:provider_rate_limit:gemini_embedding_2"
        self._requests_per_minute = requests_per_minute
        self._sleeper = sleeper
        self._closed = False

    async def wait(self, cost: int) -> None:
        if self._closed:
            raise EmbeddingPacerUnavailable
        if (
            isinstance(cost, bool)
            or not isinstance(cost, int)
            or cost < 1
            or cost > self._requests_per_minute
        ):
            raise ValueError("embedding batch cost must fit the configured RPM limit")

        while True:
            try:
                client = self._client
                if client is None:
                    redis_client = redis_async.Redis.from_url(
                        self._redis_url,
                        decode_responses=True,
                        socket_connect_timeout=1,
                        socket_timeout=5,
                    )
                    client = cast(RedisEvalClient, redis_client)
                    self._client = client
                response = await client.eval(
                    _SLIDING_WINDOW_LUA,
                    1,
                    self._key,
                    self._requests_per_minute,
                    _WINDOW_MS,
                    cost,
                    secrets.token_hex(16),
                )
                if not isinstance(response, (list, tuple)) or len(response) != 2:
                    raise ValueError("unexpected Redis embedding limiter response")
                allowed = _response_integer(response[0], field_name="allowed")
                wait_ms = _response_integer(response[1], field_name="wait_ms")
                if allowed not in {0, 1} or (allowed == 1 and wait_ms != 0):
                    raise ValueError("invalid Redis embedding limiter response")
            except Exception as exc:
                raise EmbeddingPacerUnavailable from exc

            if allowed:
                return
            if wait_ms < 1:
                raise EmbeddingPacerUnavailable
            await self._sleeper(wait_ms / 1000)

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        client = self._client
        if self._close_client and client is not None:
            await client.aclose()


__all__ = [
    "EmbeddingPacerUnavailable",
    "EmbeddingRequestPacer",
    "RedisEmbeddingRequestPacer",
]
