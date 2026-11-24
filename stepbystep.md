1. register Aiven pg
2. .env
    DATABASE_URL=postgresql+psycopg2://avnadmin:pwd@pg-service-aixpertlab.k.aivencloud.com:21906/defaultdb?sslmode=require
3. (verirag) PS B:\veriRAG> uv run python -c "from backend.infra.database import engine; print(engine.connect().exec_driver_sql('select version()').scalar())"
PostgreSQL 18.7 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.3.1 20260722 (Red Hat 15.3.1-1), 64-bit
4. uv run --frozen alembic upgrade head   
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade  -> 0001_legacy, legacy schema baseline
INFO  [alembic.runtime.migration] Running upgrade 0001_legacy -> 0002_runtime, run, event, checkpoint and document catalog schema
INFO  [alembic.runtime.migration] Running upgrade 0002_runtime -> 0003_messages, append-only message journal idempotency key
INFO  [alembic.runtime.migration] Running upgrade 0003_messages -> 0004_run_reservations, run reservation, fencing and message links
INFO  [alembic.runtime.migration] Running upgrade 0004_run_reservations -> 0005_event_journal, durable run event sequence
INFO  [alembic.runtime.migration] Running upgrade 0005_event_journal -> 0006_native_checkpoints, LangGraph PostgreSQL checkpoint tables and HITL resume metadata
INFO  [alembic.runtime.migration] Running upgrade 0006_native_checkpoints -> 0007_document_publication, document catalog publication fencing and version-owned storage metadata
INFO  [alembic.runtime.migration] Running upgrade 0007_document_publication -> 0008_indexing_worker, durable indexing worker leases, cleanup queue, and heartbeats
INFO  [alembic.runtime.migration] Running upgrade 0008_indexing_worker -> 0009_skill_tool_registry, pin immutable Skill snapshots to durable Runs
INFO  [alembic.runtime.migration] Running upgrade 0009_skill_tool_registry -> 0010_guardrails_and_sandbox, persist Run guardrail context and ToolAudit policy identity
INFO  [alembic.runtime.migration] Running upgrade 0010_guardrails_and_sandbox -> 0011_refresh_token_retention, index refresh-token ledger retention scans
INFO  [alembic.runtime.migration] Running upgrade 0011_refresh_token_retention -> 0012_remove_document_compat, remove retired document compatibility schema
INFO  [alembic.runtime.migration] Running upgrade 0012_remove_document_compat -> 0013_canonical_thread_schema, rename Thread and Message persistence schema to canonical domain names
INFO  [alembic.runtime.migration] Running upgrade 0013_canonical_thread_schema -> 0014_model_control_plane, add persistent Model Profiles and role Assignments
INFO  [alembic.runtime.migration] Running upgrade 0014_model_control_plane -> 0015_run_model_snapshot, freeze non-secret Model Snapshots on Runs
INFO  [alembic.runtime.migration] Running upgrade 0015_run_model_snapshot -> 0016_rag_evaluation_runtime, add persistent RAG evaluation datasets, jobs and case results
INFO  [alembic.runtime.migration] Running upgrade 0016_rag_evaluation_runtime -> 0017_rag_eval_provider_stage, record logical provider failure stage for RAG evaluation cases
INFO  [alembic.runtime.migration] Running upgrade 0017_rag_eval_provider_stage -> 0018_capability_control_plane, add persistent Skill and custom Tool control plane

5. (verirag) PS B:\veriRAG> uv run --frozen python -c "from backend.infra.database import assert_schema_current; assert_schema_current(); print('schema current')"
schema current
(verirag) PS B:\veriRAG> 



uv run --no-sync python -m backend.workers.indexing 