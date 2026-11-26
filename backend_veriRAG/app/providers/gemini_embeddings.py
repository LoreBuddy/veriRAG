from __future__ import annotations

import math
import logging
import re
from collections.abc import Sequence
from typing import Any

import httpx


_LOGGER = logging.getLogger(__name__)
_SAFE_QUOTA_LABEL_RE = re.compile(r"^[A-Za-z0-9._:/-]{1,128}$")
_SAFE_QUOTA_VALUE_RE = re.compile(r"^\d{1,12}$")


def _quota_failure_fields(response: httpx.Response) -> tuple[str, str, str] | None:
    try:
        body = response.json()
    except ValueError:
        return None
    error = body.get("error") if isinstance(body, dict) else None
    details = error.get("details") if isinstance(error, dict) else None
    if not isinstance(details, list):
        return None

    for detail in details:
        if not isinstance(detail, dict):
            continue
        type_name = detail.get("@type")
        violations = detail.get("violations")
        if (
            not isinstance(type_name, str)
            or not type_name.endswith("/google.rpc.QuotaFailure")
            or not isinstance(violations, list)
        ):
            continue
        for violation in violations:
            if not isinstance(violation, dict):
                continue
            labels: list[str] = []
            for name in ("quotaId", "quotaMetric"):
                value = violation.get(name)
                labels.append(
                    value
                    if isinstance(value, str) and _SAFE_QUOTA_LABEL_RE.fullmatch(value)
                    else "unknown"
                )
            quota_value = violation.get("quotaValue")
            safe_value = (
                quota_value
                if isinstance(quota_value, str)
                and _SAFE_QUOTA_VALUE_RE.fullmatch(quota_value)
                else "unknown"
            )
            return labels[0], labels[1], safe_value
    return None


class GeminiEmbeddingModel:
    """Gemini Embedding 2 adapter for the existing 1024-dimension runtime."""

    def __init__(
        self,
        *,
        api_key: str,
        output_dimensionality: int = 1024,
        timeout_seconds: float = 15.0,
        client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("GEMINI_API_KEY is required")
        if output_dimensionality != 1024:
            raise ValueError("Gemini embedding dimension must remain 1024")
        if timeout_seconds <= 0 or not math.isfinite(timeout_seconds):
            raise ValueError("timeout_seconds must be positive and finite")

        self.output_dimensionality = output_dimensionality
        self._api_key = api_key
        self._client = client or httpx.Client(
            timeout=httpx.Timeout(timeout_seconds),
        )

    def encode_query(self, texts: Sequence[str], **_kwargs: Any) -> list[list[float]]:
        return self._embed([f"task: search result | query: {text}" for text in texts])

    def encode_document(
        self,
        texts: Sequence[str],
        **_kwargs: Any,
    ) -> list[list[float]]:
        return self._embed([f"title: none | text: {text}" for text in texts])

    def close(self) -> None:
        self._client.close()

    def _embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []

        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-embedding-2:batchEmbedContents"
        )
        payload = {
            "requests": [
                {
                    "model": "models/gemini-embedding-2",
                    "content": {"parts": [{"text": text}]},
                    "outputDimensionality": self.output_dimensionality,
                }
                for text in texts
            ]
        }
        response = self._client.post(
            endpoint,
            headers={"x-goog-api-key": self._api_key},
            json=payload,
        )
        if response.status_code == 429:
            quota = _quota_failure_fields(response)
            if quota is None:
                _LOGGER.warning(
                    "Gemini embedding rate limited; quota details unavailable"
                )
            else:
                _LOGGER.warning(
                    "Gemini embedding rate limited: quota_id=%s quota_metric=%s "
                    "quota_value=%s",
                    *quota,
                )
        response.raise_for_status()
        body = response.json()
        embeddings = body.get("embeddings") if isinstance(body, dict) else None
        if not isinstance(embeddings, list) or len(embeddings) != len(texts):
            raise ValueError("Gemini returned an unexpected embedding count")

        vectors: list[list[float]] = []
        for embedding in embeddings:
            values = embedding.get("values") if isinstance(embedding, dict) else None
            if not isinstance(values, list) or len(values) != 1024:
                raise ValueError("Gemini embedding dimension is not 1024")
            vector: list[float] = []
            for value in values:
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ValueError("Gemini returned a non-numeric embedding value")
                number = float(value)
                if not math.isfinite(number):
                    raise ValueError("Gemini returned a non-finite embedding value")
                vector.append(number)
            vectors.append(vector)
        return vectors
