import unittest
from unittest.mock import patch

from backend.providers.embedding_rate_limit import RedisEmbeddingRequestPacer


class FakeRedisClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.closed = False

    async def eval(self, script, numkeys, *keys_and_args):
        self.calls.append((script, numkeys, *keys_and_args))
        return self.responses.pop(0)

    async def aclose(self):
        self.closed = True


class RedisEmbeddingRequestPacerTests(unittest.IsolatedAsyncioTestCase):
    async def test_construction_does_not_create_redis_client(self):
        with patch(
            "backend.providers.embedding_rate_limit.redis_async.Redis.from_url",
            side_effect=AssertionError("Redis client created before runtime start"),
        ):
            pacer = RedisEmbeddingRequestPacer(
                redis_url="redis://localhost:6379/0",
                key_prefix="test",
                requests_per_minute=60,
            )

        await pacer.aclose()

    async def test_batch_cost_is_counted_per_text_and_waits_for_window_capacity(self):
        client = FakeRedisClient([[1, 0], [0, 16_000], [1, 0]])
        sleeps = []

        async def sleeper(seconds):
            sleeps.append(seconds)

        pacer = RedisEmbeddingRequestPacer(
            redis_url="redis://localhost:6379/0",
            key_prefix="test",
            requests_per_minute=60,
            client=client,
            sleeper=sleeper,
        )

        await pacer.wait(16)
        await pacer.wait(16)

        self.assertEqual([16.0], sleeps)
        self.assertEqual([16, 16, 16], [call[5] for call in client.calls])
        self.assertTrue(all(call[1] == 1 for call in client.calls))
        script, _numkeys, *arguments = client.calls[0]
        self.assertIn("redis.call('TIME')", script)
        self.assertIn("redis.call('ZREMRANGEBYSCORE'", script)
        self.assertIn("redis.call('ZRANGE'", script)
        self.assertIn("redis.call('ZADD'", script)
        self.assertEqual("test:provider_rate_limit:gemini_embedding_2", arguments[0])
        self.assertEqual([60, 60_000, 16], arguments[1:4])

    async def test_instances_share_the_same_redis_key_for_api_and_worker(self):
        api_client = FakeRedisClient([[1, 0]])
        worker_client = FakeRedisClient([[1, 0]])
        api_pacer = RedisEmbeddingRequestPacer(
            redis_url="redis://localhost:6379/0",
            key_prefix="supermew",
            requests_per_minute=60,
            client=api_client,
        )
        worker_pacer = RedisEmbeddingRequestPacer(
            redis_url="redis://localhost:6379/0",
            key_prefix="supermew",
            requests_per_minute=60,
            client=worker_client,
        )

        await api_pacer.wait(1)
        await worker_pacer.wait(1)

        self.assertEqual(api_client.calls[0][2], worker_client.calls[0][2])

    async def test_batch_larger_than_rpm_is_rejected(self):
        pacer = RedisEmbeddingRequestPacer(
            redis_url="redis://localhost:6379/0",
            key_prefix="test",
            requests_per_minute=8,
            client=FakeRedisClient([]),
        )

        with self.assertRaisesRegex(ValueError, "fit the configured RPM"):
            await pacer.wait(9)

    async def test_unavailable_redis_fails_closed(self):
        class UnavailableRedisClient:
            async def eval(self, *_args):
                raise ConnectionError("private redis connection detail")

            async def aclose(self):
                return None

        pacer = RedisEmbeddingRequestPacer(
            redis_url="redis://localhost:6379/0",
            key_prefix="test",
            requests_per_minute=60,
            client=UnavailableRedisClient(),
        )

        with self.assertRaisesRegex(RuntimeError, "rate limiter is unavailable") as exc:
            await pacer.wait(1)
        self.assertNotIn("private redis connection detail", str(exc.exception))


if __name__ == "__main__":
    unittest.main()
