from pathlib import Path

from app.core.settings import get_settings
from app.documents import DocumentCatalog
from app.documents.publication import (
    DocumentPublication,
    DocumentRetirementOutcome,
)
from app.documents.retrieval import DocumentRetrievalScope
from app.indexing.document_loader import DocumentLoader
from app.indexing.embedding import embedding_service
from app.indexing.milvus_client import get_milvus_store
from app.indexing.milvus_writer import MilvusWriter
from app.indexing.parent_chunk_store import ParentChunkStore

UPLOAD_DIR = get_settings().storage.upload_dir

loader = DocumentLoader()
parent_chunk_store = ParentChunkStore()
milvus_manager = get_milvus_store()
milvus_writer = MilvusWriter(
    embedding_service=embedding_service,
    milvus_manager=milvus_manager,
)
document_catalog = DocumentCatalog()
document_publication = DocumentPublication(
    catalog=document_catalog,
    loader=loader,
    parent_store=parent_chunk_store,
    writer=milvus_writer,
)
document_retrieval_scope = DocumentRetrievalScope(document_catalog)


def delete_document_transactionally(
    filename: str,
) -> DocumentRetirementOutcome:
    """原子撤销 Catalog scope，并把物理清理留给持久 worker。"""

    return document_publication.retire(filename)


def ensure_upload_dir() -> None:
    Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
