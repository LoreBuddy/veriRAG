"""Indexing Adapter for the shared asynchronous Embedding Runtime."""

from app.providers.embedding import EmbeddingScope, EmbeddingService
from app.providers.runtime import provider_runtime


embedding_service = provider_runtime.embedding_service


__all__ = ["EmbeddingScope", "EmbeddingService", "embedding_service"]
