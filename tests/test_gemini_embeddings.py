from __future__ import annotations

import json
import logging

import httpx
import pytest

from backend.providers.gemini_embeddings import GeminiEmbeddingModel


def test_gemini_embedding_requests_and_validates_1024_dimensions():
    requests_seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append(request)
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={"embeddings": [{"values": [0.1] * 1024} for _ in body["requests"]]},
        )

    model = GeminiEmbeddingModel(
        api_key="test-key",
        output_dimensionality=1024,
        timeout_seconds=2,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    try:
        assert len(model.encode_query(["question"])) == 1
        assert len(model.encode_document(["document"])) == 1
    finally:
        model.close()

    query_request, document_request = requests_seen
    query_payload = json.loads(query_request.content)
    document_payload = json.loads(document_request.content)
    assert query_request.headers["x-goog-api-key"] == "test-key"
    assert query_payload["requests"][0]["outputDimensionality"] == 1024
    assert (
        query_payload["requests"][0]["content"]["parts"][0]["text"]
        == "task: search result | query: question"
    )
    assert (
        document_payload["requests"][0]["content"]["parts"][0]["text"]
        == "title: none | text: document"
    )


def test_gemini_embedding_rejects_non_1024_configuration():
    with pytest.raises(ValueError, match="dimension must remain 1024"):
        GeminiEmbeddingModel(api_key="test-key", output_dimensionality=768)


def test_gemini_embedding_rejects_malformed_vector_dimension():
    model = GeminiEmbeddingModel(
        api_key="test-key",
        output_dimensionality=1024,
        timeout_seconds=2,
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(
                    200,
                    json={"embeddings": [{"values": [0.1] * 768}]},
                )
            )
        ),
    )
    try:
        with pytest.raises(ValueError, match="dimension is not 1024"):
            model.encode_query(["question"])
    finally:
        model.close()


def test_gemini_embedding_logs_only_safe_quota_details(caplog):
    model = GeminiEmbeddingModel(
        api_key="test-key-never-log",
        output_dimensionality=1024,
        timeout_seconds=2,
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    429,
                    request=request,
                    json={
                        "error": {
                            "message": "sensitive upstream message",
                            "details": [
                                {
                                    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                                    "violations": [
                                        {
                                            "quotaId": "EmbedContentRequestsPerMinutePerUserPerProject-FreeTier",
                                            "quotaMetric": "generativelanguage.googleapis.com/embed_content_free_tier_requests",
                                            "quotaValue": "100",
                                        }
                                    ],
                                }
                            ],
                        }
                    },
                )
            )
        ),
    )
    caplog.set_level(logging.WARNING)
    try:
        with pytest.raises(httpx.HTTPStatusError):
            model.encode_query(["question"])
    finally:
        model.close()

    assert (
        "quota_id=EmbedContentRequestsPerMinutePerUserPerProject-FreeTier"
        in caplog.text
    )
    assert "quota_value=100" in caplog.text
    assert "test-key-never-log" not in caplog.text
    assert "sensitive upstream message" not in caplog.text
