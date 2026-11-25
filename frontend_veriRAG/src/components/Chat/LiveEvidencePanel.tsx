import { useEffect, useState, type CSSProperties } from 'react';
import type { RunEventState, RunTimelineItem } from '@/events/runEventReducer';
import type { RagTrace } from '@/types/chat';
import emptyEvidence from '@/assets/images/empty-evidence.webp';

interface EvidenceSource {
  filename: string;
  page_number?: number;
  rrf_rank?: number;
  rerank_score?: number | null;
  text?: string;
}

interface EvidenceTrace {
  tool_used?: boolean;
  retrieval_mode?: string;
  retrieval_pipeline?: string;
  complexity?: string;
  sub_agent_count?: number;
  recall_count?: number | null;
  retrieved_chunks?: EvidenceSource[];
  rerank_applied?: boolean | null;
  rerank_enabled?: boolean | null;
  rerank_model?: string;
  evidence_confidence?: number | null;
}

export interface EvidenceMessage {
  id: string;
  runId?: string;
  text: string;
  isUser: boolean;
  isThinking?: boolean;
  isHitlRequest?: boolean;
  status?: string;
  ragTrace?: RagTrace | null;
  runTimeline?: RunTimelineItem[];
  runActiveDurationMs?: number;
  runActiveStartedAt?: string | null;
}

interface LiveEvidencePanelProps {
  threadId: string;
  messages: EvidenceMessage[];
  runState: RunEventState | null;
  isSending: boolean;
  eventError: string;
  onSourceClick: (messageId: string, chunkIndex: number) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asEvidenceSource(value: unknown): EvidenceSource | null {
  const record = asRecord(value);
  if (!record || typeof record.filename !== 'string') return null;
  return {
    filename: record.filename,
    page_number: typeof record.page_number === 'number' ? record.page_number : undefined,
    rrf_rank: typeof record.rrf_rank === 'number' ? record.rrf_rank : undefined,
    rerank_score:
      typeof record.rerank_score === 'number' || record.rerank_score === null
        ? record.rerank_score
        : undefined,
    text: typeof record.text === 'string' ? record.text : undefined,
  };
}

function asEvidenceTrace(value: unknown): EvidenceTrace | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    tool_used: typeof record.tool_used === 'boolean' ? record.tool_used : undefined,
    retrieval_mode: typeof record.retrieval_mode === 'string' ? record.retrieval_mode : undefined,
    retrieval_pipeline:
      typeof record.retrieval_pipeline === 'string' ? record.retrieval_pipeline : undefined,
    complexity: typeof record.complexity === 'string' ? record.complexity : undefined,
    sub_agent_count:
      typeof record.sub_agent_count === 'number' ? record.sub_agent_count : undefined,
    recall_count:
      typeof record.recall_count === 'number' || record.recall_count === null
        ? record.recall_count
        : undefined,
    retrieved_chunks: Array.isArray(record.retrieved_chunks)
      ? record.retrieved_chunks.map(asEvidenceSource).filter((source) => source !== null)
      : undefined,
    rerank_applied:
      typeof record.rerank_applied === 'boolean' || record.rerank_applied === null
        ? record.rerank_applied
        : undefined,
    rerank_enabled:
      typeof record.rerank_enabled === 'boolean' || record.rerank_enabled === null
        ? record.rerank_enabled
        : undefined,
    rerank_model: typeof record.rerank_model === 'string' ? record.rerank_model : undefined,
    evidence_confidence:
      typeof record.evidence_confidence === 'number' || record.evidence_confidence === null
        ? record.evidence_confidence
        : undefined,
  };
}

function formatMilliseconds(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return '';
  return milliseconds < 1000
    ? `${milliseconds}ms`
    : `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fallbackTimeline(
  trace: EvidenceTrace | null,
  sourceCount: number,
  isRunning: boolean
): RunTimelineItem[] {
  if (!trace) {
    return [
      {
        id: 'answer',
        sequence: 1,
        kind: 'retrieval',
        eventType: 'retrieval.progress',
        status: isRunning ? 'running' : 'completed',
        title: isRunning ? '正在连接喵喵 Agent' : '直接回答已完成',
        detail: isRunning ? '准备理解问题与选择工具' : '本次未产生检索轨迹',
        timestamp: '',
        toolName: null,
        toolCallId: null,
        durationMs: null,
        resultSize: null,
        guardrailDecision: null,
        guardrailReasonCode: null,
        error: null,
      },
    ];
  }

  const steps: Array<{ key: string; title: string; detail: string }> = [];
  if (trace.complexity) {
    steps.push({
      key: 'complexity',
      title: '意图与复杂度判断',
      detail: trace.complexity === 'complex' ? '复杂问题 · 多步处理' : '简单问题 · 快速路径',
    });
  }
  if (trace.sub_agent_count) {
    steps.push({
      key: 'sub-agents',
      title: '子问题并行处理',
      detail: `${trace.sub_agent_count} 路 Agent`,
    });
  }
  if (trace.tool_used || trace.retrieval_mode) {
    const output = trace.retrieved_chunks?.length;
    steps.push({
      key: 'retrieve',
      title: trace.retrieval_mode || '知识库检索',
      detail:
        trace.recall_count != null && output !== undefined
          ? `${trace.recall_count} → ${output} 个片段`
          : trace.retrieval_pipeline || '混合召回',
    });
  }
  if (trace.rerank_applied || trace.rerank_enabled) {
    steps.push({
      key: 'rerank',
      title: '证据精排',
      detail: trace.rerank_model || 'Rerank',
    });
  }
  steps.push({
    key: 'synthesis',
    title: '证据合成',
    detail: sourceCount ? `${sourceCount} 个来源已对齐` : '回答生成完成',
  });

  return steps.map((step, index) => ({
    id: `trace:${step.key}`,
    sequence: index + 1,
    kind: 'retrieval',
    eventType: 'retrieval.progress',
    status: 'completed',
    title: step.title,
    detail: step.detail,
    timestamp: '',
    toolName: null,
    toolCallId: null,
    durationMs: null,
    resultSize: null,
    guardrailDecision: null,
    guardrailReasonCode: null,
    error: null,
  }));
}

function timelineIcon(status: RunTimelineItem['status']): string {
  if (status === 'running') return 'fa-solid fa-spinner fa-spin';
  if (status === 'completed') return 'fa-solid fa-check';
  if (status === 'warning') return 'fa-solid fa-triangle-exclamation';
  if (status === 'denied') return 'fa-solid fa-shield-halved';
  if (status === 'failed') return 'fa-solid fa-xmark';
  return 'fa-regular fa-clock';
}

function confidenceDescription(confidence: number | null, sourceCount: number): string {
  if (confidence === null) {
    return sourceCount ? '已找到引用来源，等待证据评分。' : '本次回答没有可用的证据评分。';
  }
  if (confidence >= 85) return '来源相关性较高，证据之间未发现明显冲突。';
  if (confidence >= 60) return '证据基本可用，建议同时查看原始引用。';
  return '证据支撑较弱，请谨慎使用并进一步核验。';
}

export default function LiveEvidencePanel({
  threadId,
  messages,
  runState,
  isSending,
  eventError,
  onSourceClick,
}: LiveEvidencePanelProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());
  const latestMessage =
    [...messages].reverse().find((message) => !message.isUser && !message.isHitlRequest) || null;
  const runMatchesLatest = Boolean(
    runState && latestMessage?.runId && latestMessage.runId === runState.runId
  );
  const currentRun = runMatchesLatest ? runState : null;
  const trace = asEvidenceTrace(latestMessage?.ragTrace) || asEvidenceTrace(currentRun?.ragTrace);
  const sources = trace?.retrieved_chunks || [];
  const runIsBusy =
    currentRun !== null &&
    ['creating', 'queued', 'pending', 'running', 'cancelling'].includes(currentRun.status);
  const isRunning = isSending || Boolean(latestMessage?.isThinking) || runIsBusy;
  const isWaitingForInput =
    latestMessage?.isHitlRequest ||
    latestMessage?.status === 'waiting_input' ||
    currentRun?.status === 'waiting_input';
  const isFailed =
    latestMessage?.status === 'failed' ||
    latestMessage?.status === 'cancelled' ||
    latestMessage?.status === 'incomplete';
  const timeline = currentRun?.timeline.length
    ? currentRun.timeline
    : latestMessage?.runTimeline?.length
      ? latestMessage.runTimeline
      : fallbackTimeline(trace, sources.length, isRunning);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  let totalDuration: number;
  let durationRecorded = false;
  const recordedDuration = currentRun?.activeDurationMs ?? latestMessage?.runActiveDurationMs;
  if (recordedDuration !== undefined) {
    totalDuration = Math.max(recordedDuration, 0);
    durationRecorded = true;
    const activeStartedAt = currentRun?.activeStartedAt ?? latestMessage?.runActiveStartedAt;
    const startedTimestamp = activeStartedAt ? Date.parse(activeStartedAt) : Number.NaN;
    if (isRunning && Number.isFinite(startedTimestamp)) {
      totalDuration += Math.max(currentTime - startedTimestamp, 0);
    }
  } else {
    totalDuration =
      latestMessage?.runTimeline?.reduce(
        (latest, item) => Math.max(latest, item.durationMs || 0),
        0
      ) || 0;
  }
  const confidenceRaw = trace?.evidence_confidence;
  const confidence =
    confidenceRaw === null || confidenceRaw === undefined || !Number.isFinite(Number(confidenceRaw))
      ? null
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              Number(confidenceRaw) <= 1 ? Number(confidenceRaw) * 100 : Number(confidenceRaw)
            )
          )
        );
  const statusLabel = isRunning
    ? '运行中'
    : isWaitingForInput
      ? '等待补充'
      : isFailed
        ? '未完成'
        : latestMessage
          ? '已完成'
          : '待命';

  return (
    <aside className="knowledge-context">
      <div className="context-header">
        <div>
          <span className="panel-eyebrow">Live evidence</span>
          <h2>知识脉络</h2>
        </div>
        <span className={`context-status${isRunning ? ' running' : ''}`}>
          <i
            className={isRunning ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-circle-check'}
            aria-hidden="true"
          />
          {statusLabel}
        </span>
      </div>

      {!latestMessage && !isRunning ? (
        <>
          <div className="context-empty">
            <img src={emptyEvidence} className="context-empty-illustration" alt="" />
            <h3>等待一次提问</h3>
            <p>检索步骤、证据置信度和引用来源会实时出现在这里。</p>
          </div>
          {eventError && (
            <p className="live-evidence-error" role="alert">
              {eventError}
            </p>
          )}
        </>
      ) : (
        <>
          <section className="context-card run-card">
            <div className="context-card-heading">
              <div>
                <strong>本次 Agent 运行</strong>
                <small>{threadId.replace('thread_', '').slice(-8)}</small>
              </div>
              {(durationRecorded || totalDuration > 0) && (
                <span>{formatMilliseconds(totalDuration)}</span>
              )}
            </div>
            <div className="run-timeline" aria-label="工具执行时间线">
              {timeline.map((item) => {
                const showGuardrail =
                  item.guardrailDecision === 'DENY' ||
                  item.guardrailDecision === 'REQUIRE_APPROVAL';
                return (
                  <article className="run-step" key={item.id}>
                    <span
                      className={`run-step-dot${item.status === 'running' ? ' active' : ''}`}
                      aria-hidden="true"
                    >
                      <i className={timelineIcon(item.status)} />
                    </span>
                    <div className="run-step-copy">
                      <strong>{item.title}</strong>
                      {item.detail && <small>{item.detail}</small>}
                      {(item.toolName || showGuardrail) && (
                        <small>
                          {item.toolName}
                          {showGuardrail &&
                            ` · ${item.guardrailDecision === 'REQUIRE_APPROVAL' ? '需要审批' : '策略拒绝'}`}
                        </small>
                      )}
                      {item.error && (
                        <div className="run-step-error">
                          <small>
                            {item.error.code}: {item.error.message}
                          </small>
                          <details
                            className="run-error-details"
                            open={item.status === 'failed' || item.status === 'warning'}
                          >
                            <summary>错误诊断</summary>
                            <dl>
                              <div>
                                <dt>错误码</dt>
                                <dd>
                                  <code>{item.error.code}</code>
                                </dd>
                              </div>
                              {item.error.category && (
                                <div>
                                  <dt>类别</dt>
                                  <dd>{item.error.category}</dd>
                                </div>
                              )}
                              {item.error.stage && (
                                <div>
                                  <dt>阶段</dt>
                                  <dd>{item.error.stage}</dd>
                                </div>
                              )}
                              {item.error.provider && (
                                <div>
                                  <dt>Provider</dt>
                                  <dd>{item.error.provider}</dd>
                                </div>
                              )}
                              <div>
                                <dt>可重试</dt>
                                <dd>{item.error.retryable ? '是' : '否'}</dd>
                              </div>
                              {item.error.retryAfterSeconds !== undefined && (
                                <div>
                                  <dt>建议等待</dt>
                                  <dd>{item.error.retryAfterSeconds} 秒</dd>
                                </div>
                              )}
                              {item.error.requestId && (
                                <div>
                                  <dt>请求 ID</dt>
                                  <dd>{item.error.requestId}</dd>
                                </div>
                              )}
                            </dl>
                          </details>
                        </div>
                      )}
                    </div>
                    {(item.durationMs !== null || item.resultSize !== null) && (
                      <span className="run-step-time">
                        {formatDuration(item.durationMs)}
                        {item.resultSize !== null &&
                          `${item.durationMs !== null ? ' · ' : ''}${formatBytes(item.resultSize)}`}
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
            {eventError && (
              <p className="live-evidence-error" role="status">
                运行轨迹暂时不可用：{eventError}
              </p>
            )}
          </section>

          <section className="context-card confidence-card">
            <div
              className="confidence-ring"
              style={{ '--confidence': `${confidence ?? 0}%` } as CSSProperties}
            >
              <strong>{confidence === null ? '—' : `${confidence}%`}</strong>
            </div>
            <div>
              <strong>证据置信度</strong>
              <p>{confidenceDescription(confidence, sources.length)}</p>
            </div>
          </section>

          <div className="context-section-heading">
            <strong>引用来源</strong>
            <span>{sources.length ? `${sources.length} 个片段` : '暂无引用'}</span>
          </div>
          {sources.length ? (
            <div className="context-sources">
              {sources.slice(0, 5).map((source, index) => (
                <button
                  type="button"
                  key={`${source.filename}:${index}`}
                  className="context-source-card"
                  onClick={() => latestMessage && onSourceClick(latestMessage.id, index + 1)}
                  disabled={!latestMessage}
                >
                  <span className="context-file-icon">
                    <i className="fa-regular fa-file-lines" aria-hidden="true" />
                  </span>
                  <span className="context-source-copy">
                    <strong>{source.filename}</strong>
                    <small>
                      {source.page_number ? `第 ${source.page_number} 页 · ` : ''}
                      RRF #{source.rrf_rank || index + 1}
                    </small>
                  </span>
                  <span className="context-source-score">
                    {source.rerank_score === null || source.rerank_score === undefined
                      ? '—'
                      : Number(source.rerank_score).toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="context-no-sources">
              <i className="fa-solid fa-route" aria-hidden="true" />
              <span>
                {trace?.tool_used === false
                  ? '本次为直接回答，未调用知识库。'
                  : isRunning
                    ? '正在等待可引用证据。'
                    : '本次回答没有可用的引用来源。'}
              </span>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
