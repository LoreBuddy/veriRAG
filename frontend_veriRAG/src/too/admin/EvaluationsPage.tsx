import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  cancelRagEvaluationJob,
  createRagEvaluationDataset,
  createRagEvaluationJob,
  getRagEvaluationJob,
  listRagEvaluationCases,
  listRagEvaluationDatasets,
  listRagEvaluationJobs,
} from '@/evaluations/evaluationClient';
import { normalizeRagEvaluationDataset } from '@/evaluations/datasetValidation';
import { getModelControlPlane } from '@/models/modelClient';
import type { ModelControlPlane } from '@/types/models';
import type {
  RagEvaluationCaseResult,
  RagEvaluationDataset,
  RagEvaluationDatasetRecord,
  RagEvaluationJob,
  RagEvaluationJobStatus,
} from '@/types/evaluations';
import { getPublicError } from '@/utils/api';
import './evaluations-page.css';

type JobFilter = 'all' | 'active' | 'succeeded' | 'failed';

const ACTIVE_STATUSES = new Set<RagEvaluationJobStatus>(['queued', 'running', 'cancelling']);
const FILTERS: Array<{ value: JobFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '运行中' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '异常' },
];

const STATUS_LABELS: Record<RagEvaluationJobStatus, string> = {
  queued: '排队中',
  running: '运行中',
  cancelling: '取消中',
  cancelled: '已取消',
  succeeded: '已完成',
  failed: '失败',
};

const STATUS_ICONS: Record<RagEvaluationJobStatus, string> = {
  queued: 'fa-regular fa-clock',
  running: 'fa-solid fa-spinner fa-spin',
  cancelling: 'fa-solid fa-spinner fa-spin',
  cancelled: 'fa-solid fa-ban',
  succeeded: 'fa-solid fa-check',
  failed: 'fa-solid fa-xmark',
};

const METRIC_LABELS: Record<string, string> = {
  answer_correctness: 'Answer correctness',
  groundedness: 'Groundedness',
  answer_relevance: 'Answer relevance',
  completeness: 'Completeness',
  context_relevance: 'Context relevance',
  unsupported_claim_rate: 'Unsupported claims',
  conflict_disclosure_rate: 'Conflict disclosure',
  route_accuracy: 'Route accuracy',
  outcome_accuracy: 'Outcome accuracy',
  case_pass_rate: 'Case pass rate',
  latency_p95_ms: 'Latency p95',
  recall_at_5: 'Recall@5',
  recall_at_10: 'Recall@10',
  hit_at_5: 'Hit@5',
  hit_at_10: 'Hit@10',
  gold_chunk_coverage: 'Gold chunk coverage',
};

function formatDate(value: string | null): string {
  if (!value) return '尚未开始';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatMetric(name: string, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (name.includes('duration') || name.includes('latency') || name.endsWith('_ms')) {
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  }
  if (Math.abs(value) <= 1.000001) return `${Math.round(value * 100)}%`;
  return value.toFixed(2);
}

function metricLabel(name: string): string {
  return METRIC_LABELS[name] ?? name.replaceAll('_', ' ');
}

function isActive(job: RagEvaluationJob): boolean {
  return ACTIVE_STATUSES.has(job.status);
}

export default function EvaluationsPage() {
  const [datasets, setDatasets] = useState<RagEvaluationDatasetRecord[]>([]);
  const [jobs, setJobs] = useState<RagEvaluationJob[]>([]);
  const [cases, setCases] = useState<RagEvaluationCaseResult[]>([]);
  const [modelPlane, setModelPlane] = useState<ModelControlPlane | null>(null);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [baselineJobId, setBaselineJobId] = useState('');
  const [filter, setFilter] = useState<JobFilter>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [datasetText, setDatasetText] = useState('');
  const [datasetPreview, setDatasetPreview] = useState<RagEvaluationDataset | null>(null);
  const [importError, setImportError] = useState('');

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [nextDatasets, nextJobs] = await Promise.all([
        listRagEvaluationDatasets(),
        listRagEvaluationJobs(),
      ]);
      setDatasets(nextDatasets);
      setJobs(nextJobs);
      setSelectedDatasetId((current) => current || nextDatasets[0]?.id || '');
      setSelectedJobId((current) =>
        current && nextJobs.some((job) => job.id === current) ? current : nextJobs[0]?.id || ''
      );
      const plane = await getModelControlPlane().catch(() => null);
      setModelPlane(plane);
    } catch (reason: unknown) {
      setError(getPublicError(reason).message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const activeJobCount = jobs.filter(isActive).length;
  const completedJobs = jobs.filter((job) => job.status === 'succeeded' && job.report);
  const readyForEvaluation = Boolean(
    modelPlane?.api_key_configured &&
    (['answer', 'fast', 'grader', 'evaluator'] as const).every(
      (role) => modelPlane.assignments[role]?.enabled
    )
  );
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId);
  const baselines = completedJobs.filter(
    (job) => job.dataset_fingerprint === selectedDataset?.fingerprint
  );
  const filteredJobs = useMemo(() => {
    if (filter === 'active') return jobs.filter(isActive);
    if (filter === 'succeeded') return jobs.filter((job) => job.status === 'succeeded');
    if (filter === 'failed')
      return jobs.filter((job) => ['failed', 'cancelled'].includes(job.status));
    return jobs;
  }, [filter, jobs]);
  const gatePassRate = completedJobs.length
    ? `${Math.round((completedJobs.filter((job) => job.report?.passed).length / completedJobs.length) * 100)}%`
    : '—';

  useEffect(() => {
    if (!selectedJobId) {
      setCases([]);
      return;
    }
    let stale = false;
    Promise.all([getRagEvaluationJob(selectedJobId), listRagEvaluationCases(selectedJobId)])
      .then(([job, nextCases]) => {
        if (stale) return;
        setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
        setCases(nextCases);
      })
      .catch((reason: unknown) => {
        if (!stale) setError(getPublicError(reason).message);
      });
    return () => {
      stale = true;
    };
  }, [selectedJobId]);

  useEffect(() => {
    if (!activeJobCount) return;
    const timer = window.setInterval(() => void refresh(false), 1800);
    return () => window.clearInterval(timer);
  }, [activeJobCount, refresh]);

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setDatasetText(await file.text());
      setDatasetPreview(null);
      setImportError('');
    } catch {
      setImportError('无法读取所选 JSON 文件');
    }
    event.target.value = '';
  };

  const previewDataset = () => {
    setImportError('');
    setDatasetPreview(null);
    try {
      setDatasetPreview(normalizeRagEvaluationDataset(JSON.parse(datasetText)));
    } catch (reason: unknown) {
      setImportError(reason instanceof Error ? reason.message : 'Dataset JSON 无效');
    }
  };

  const importDataset = async () => {
    if (!datasetPreview) return;
    setSaving(true);
    setError('');
    try {
      const created = await createRagEvaluationDataset(datasetPreview);
      setDatasets((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedDatasetId(created.id);
      setNotice(`已导入评估数据集「${created.name}」`);
      setImportOpen(false);
      setDatasetText('');
      setDatasetPreview(null);
    } catch (reason: unknown) {
      setError(getPublicError(reason).message);
    } finally {
      setSaving(false);
    }
  };

  const startEvaluation = async () => {
    if (!selectedDatasetId || !readyForEvaluation || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const job = await createRagEvaluationJob({
        dataset_id: selectedDatasetId,
        baseline_job_id: baselineJobId || null,
      });
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setSelectedJobId(job.id);
      setCases([]);
      setNotice(`Evaluation Job ${job.id.slice(-8)} 已排队`);
    } catch (reason: unknown) {
      setError(getPublicError(reason).message);
    } finally {
      setSaving(false);
    }
  };

  const cancelSelectedJob = async () => {
    if (!selectedJob || !isActive(selectedJob) || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = await cancelRagEvaluationJob(selectedJob.id);
      setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
      setNotice('已请求取消 Evaluation Job');
    } catch (reason: unknown) {
      setError(getPublicError(reason).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="evaluation-page">
      <header className="evaluation-heading">
        <div>
          <span className="evaluation-kicker">RAG OBSERVABILITY / 01</span>
          <h1>RAG 评估</h1>
          <p>管理评估数据集，追踪运行结果与质量门禁。</p>
        </div>
        <div className="evaluation-heading-actions">
          <button
            type="button"
            className="evaluation-button is-secondary"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <i className={`fa-solid fa-rotate${loading ? ' fa-spin' : ''}`} aria-hidden="true" />
            刷新
          </button>
          <button
            type="button"
            className="evaluation-button is-primary"
            onClick={() => setImportOpen(true)}
          >
            <i className="fa-solid fa-file-arrow-up" aria-hidden="true" />
            导入 Dataset
          </button>
        </div>
      </header>

      {error && (
        <div className="evaluation-alert is-error" role="alert">
          {error}
          <button type="button" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      )}
      {notice && (
        <div className="evaluation-alert is-success" role="status">
          {notice}
          <button type="button" aria-label="关闭提示" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}

      <section className="evaluation-summary" aria-label="RAG 评估概览">
        <article>
          <span>DATASETS</span>
          <strong>{datasets.length}</strong>
          <small>{datasets.reduce((sum, item) => sum + item.case_count, 0)} 个标注 Case</small>
        </article>
        <article>
          <span>ACTIVE JOBS</span>
          <strong>{activeJobCount}</strong>
          <small>{activeJobCount ? 'Worker 正在自动评估' : '当前没有运行任务'}</small>
        </article>
        <article>
          <span>GATE PASS RATE</span>
          <strong>{gatePassRate}</strong>
          <small>最近 {completedJobs.length} 次成功运行</small>
        </article>
        <article className={readyForEvaluation ? 'is-ready' : 'is-warning'}>
          <span>EVALUATION RUNTIME</span>
          <strong>{readyForEvaluation ? '已就绪' : '需要配置'}</strong>
          <small>
            {modelPlane?.api_key_configured ? '检查四个模型角色分配' : '检查服务端密钥与模型角色'}
          </small>
        </article>
      </section>

      <section className="evaluation-launch">
        <div className="evaluation-launch-copy">
          <span className="evaluation-kicker">NEW EXPERIMENT</span>
          <h2>启动自动评估</h2>
          <p>新任务会固定 Dataset、Baseline 与模型配置快照。</p>
        </div>
        <label>
          <span>Evaluation Dataset</span>
          <select
            value={selectedDatasetId}
            onChange={(event) => {
              setSelectedDatasetId(event.target.value);
              setBaselineJobId('');
            }}
          >
            <option value="">选择 Dataset</option>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name} · {dataset.case_count} cases
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Baseline（可选）</span>
          <select
            value={baselineJobId}
            onChange={(event) => setBaselineJobId(event.target.value)}
            disabled={!selectedDatasetId}
          >
            <option value="">不比较 baseline</option>
            {baselines.map((job) => (
              <option key={job.id} value={job.id}>
                #{job.id.slice(-8)} · {formatDate(job.finished_at || job.created_at)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="evaluation-button is-primary evaluation-run-button"
          disabled={!selectedDatasetId || !readyForEvaluation || saving}
          title={
            !selectedDatasetId
              ? '请先选择 Dataset'
              : !readyForEvaluation
                ? '请先配置 Evaluation Runtime'
                : '创建持久化 Evaluation Job'
          }
          onClick={() => void startEvaluation()}
        >
          <i
            className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-play'}`}
            aria-hidden="true"
          />
          启动 Job
        </button>
      </section>

      <section className="evaluation-workbench" aria-label="Evaluation Jobs 工作区">
        <aside className="evaluation-job-sidebar">
          <div className="evaluation-job-heading">
            <div>
              <span className="evaluation-kicker">EXPERIMENT HISTORY</span>
              <h2>Evaluation Jobs</h2>
            </div>
            <strong>{filteredJobs.length}</strong>
          </div>
          <div className="evaluation-filters" role="group" aria-label="Job 状态筛选">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={filter === item.value ? 'is-active' : ''}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="evaluation-job-list">
            {loading && !jobs.length ? (
              <div className="evaluation-empty">
                <i className="fa-solid fa-spinner fa-spin" />
                <strong>正在读取历史 Job</strong>
              </div>
            ) : null}
            {!loading && !filteredJobs.length ? (
              <div className="evaluation-empty">
                <i className="fa-regular fa-folder-open" />
                <strong>没有匹配的 Job</strong>
                <p>导入 Dataset 并启动第一次自动评估。</p>
              </div>
            ) : null}
            {filteredJobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={`evaluation-job-item${job.id === selectedJobId ? ' is-selected' : ''}`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <span className="evaluation-job-meta">
                  <span className={`evaluation-status is-${job.status}`}>
                    <i className={STATUS_ICONS[job.status]} aria-hidden="true" />
                    {STATUS_LABELS[job.status]}
                  </span>
                  <small>#{job.id.slice(-8)}</small>
                </span>
                <strong>{job.dataset_name}</strong>
                <span className="evaluation-progress">
                  <i style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </span>
                <span className="evaluation-job-meta">
                  <small>
                    {job.completed_cases}/{job.total_cases} cases
                  </small>
                  <small>{formatDate(job.created_at)}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="evaluation-report">
          {!selectedJob ? (
            <div className="evaluation-report-empty">
              <span>
                <i className="fa-solid fa-chart-line" />
              </span>
              <h2>选择一个 Evaluation Job</h2>
              <p>运行进度、质量门禁与 Case 级评分证据会显示在这里。</p>
            </div>
          ) : (
            <>
              <header className="evaluation-report-heading">
                <div>
                  <div className="evaluation-report-identity">
                    <span className={`evaluation-status is-${selectedJob.status}`}>
                      <i className={STATUS_ICONS[selectedJob.status]} aria-hidden="true" />
                      {STATUS_LABELS[selectedJob.status]}
                    </span>
                    <code>{selectedJob.id}</code>
                  </div>
                  <h2>{selectedJob.dataset_name}</h2>
                  <p>
                    Dataset {selectedJob.dataset_fingerprint.slice(0, 10)} · Catalog{' '}
                    {selectedJob.model_catalog_hash.slice(0, 10)} ·{' '}
                    {selectedJob.created_by || 'system'}
                  </p>
                </div>
                <div className="evaluation-report-actions">
                  <button
                    type="button"
                    className="evaluation-icon-button"
                    aria-label="刷新当前 Job"
                    title="刷新当前 Job"
                    onClick={() => void refresh(false)}
                  >
                    <i className="fa-solid fa-rotate" />
                  </button>
                  {isActive(selectedJob) && (
                    <button
                      type="button"
                      className="evaluation-button is-danger"
                      disabled={saving || selectedJob.status === 'cancelling'}
                      onClick={() => void cancelSelectedJob()}
                    >
                      取消任务
                    </button>
                  )}
                </div>
              </header>
              {selectedJob.status === 'failed' && (
                <div className="evaluation-alert is-error">
                  任务执行失败{selectedJob.error_code ? ` · ${selectedJob.error_code}` : ''}
                </div>
              )}
              <div className="evaluation-progress-summary">
                <div>
                  <span>完成进度</span>
                  <strong>
                    {selectedJob.completed_cases} / {selectedJob.total_cases}
                  </strong>
                </div>
                <span className="evaluation-progress is-large">
                  <i style={{ width: `${Math.round(selectedJob.progress * 100)}%` }} />
                </span>
                <strong>{Math.round(selectedJob.progress * 100)}%</strong>
              </div>
              {selectedJob.report ? (
                <>
                  <div className="evaluation-report-summary">
                    <div className={selectedJob.report.passed ? 'is-pass' : 'is-fail'}>
                      <span>QUALITY GATE</span>
                      <strong>{selectedJob.report.passed ? '全部通过' : '存在未通过项'}</strong>
                      <small>
                        {selectedJob.report.gates.filter((gate) => gate.status === 'failed').length}{' '}
                        项门禁未通过
                      </small>
                    </div>
                    <div>
                      <span>OBSERVATIONS</span>
                      <strong>{selectedJob.report.observation_count}</strong>
                      <small>{selectedJob.report.case_count} 个评估 Case</small>
                    </div>
                    <div>
                      <span>DATASET</span>
                      <strong>{selectedJob.report.dataset_name}</strong>
                      <small>{selectedJob.report.dataset_fingerprint.slice(0, 12)}</small>
                    </div>
                  </div>
                  <section className="evaluation-detail-section">
                    <div className="evaluation-section-heading">
                      <div>
                        <span className="evaluation-kicker">REPORT</span>
                        <h3>核心指标</h3>
                      </div>
                    </div>
                    <div className="evaluation-metrics">
                      {Object.entries(selectedJob.report.metrics).map(([name, metric]) => (
                        <article key={name}>
                          <span>{metricLabel(name)}</span>
                          <strong>{formatMetric(name, metric.value)}</strong>
                          <small>{metric.eligible_cases} eligible cases</small>
                        </article>
                      ))}
                    </div>
                  </section>
                  <section className="evaluation-detail-section">
                    <div className="evaluation-section-heading">
                      <div>
                        <span className="evaluation-kicker">QUALITY GATES</span>
                        <h3>质量门禁</h3>
                      </div>
                    </div>
                    <div className="evaluation-gates">
                      {selectedJob.report.gates.map((gate, index) => (
                        <article key={`${gate.name}-${index}`}>
                          <span className={`evaluation-gate-icon is-${gate.status}`}>
                            <i
                              className={
                                gate.status === 'passed'
                                  ? 'fa-solid fa-check'
                                  : gate.status === 'failed'
                                    ? 'fa-solid fa-xmark'
                                    : 'fa-solid fa-minus'
                              }
                            />
                          </span>
                          <div>
                            <strong>{gate.name}</strong>
                            <p>{gate.detail}</p>
                          </div>
                          <span className={`evaluation-gate-result is-${gate.status}`}>
                            {gate.status === 'passed'
                              ? '通过'
                              : gate.status === 'failed'
                                ? '未通过'
                                : '跳过'}
                          </span>
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <div className="evaluation-live-state">
                  <span className="evaluation-live-indicator" />
                  <div>
                    <strong>
                      {selectedJob.status === 'failed'
                        ? 'Job 执行失败'
                        : isActive(selectedJob)
                          ? '评估正在运行'
                          : '尚无评估报告'}
                    </strong>
                    <p>
                      {selectedJob.status === 'failed'
                        ? '请检查任务状态后重试。'
                        : '任务完成后，指标与质量门禁将在此显示。'}
                    </p>
                  </div>
                </div>
              )}
              <section className="evaluation-detail-section">
                <div className="evaluation-section-heading">
                  <div>
                    <span className="evaluation-kicker">CASE RESULTS</span>
                    <h3>
                      Case 结果 <small>{cases.length}</small>
                    </h3>
                  </div>
                </div>
                {cases.length ? (
                  <div className="evaluation-case-list">
                    {cases.map((item) => (
                      <article key={item.id}>
                        <div>
                          <strong>{item.case_id}</strong>
                          <span
                            className={`evaluation-status is-${item.status === 'completed' ? (selectedJob.report?.cases.find((result) => result.case_id === item.case_id)?.passed ? 'succeeded' : 'failed') : item.status}`}
                          >
                            <i
                              className={
                                item.status === 'completed'
                                  ? 'fa-solid fa-check'
                                  : 'fa-solid fa-circle'
                              }
                            />
                            {item.status === 'completed' ? '已完成' : item.status}
                          </span>
                        </div>
                        <p>{item.question}</p>
                        {item.generated_answer && <small>{item.generated_answer}</small>}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="evaluation-case-empty">
                    {loading ? '正在读取 Case 结果…' : '暂无 Case 结果'}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </section>

      {importOpen && (
        <div
          className="evaluation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setImportOpen(false);
          }}
        >
          <section
            className="evaluation-import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evaluation-import-title"
          >
            <header>
              <div>
                <span className="evaluation-kicker">DATASET LIBRARY</span>
                <h2 id="evaluation-import-title">导入 Evaluation Dataset</h2>
              </div>
              <button
                type="button"
                className="evaluation-icon-button"
                aria-label="关闭"
                onClick={() => setImportOpen(false)}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </header>
            <label className="evaluation-file-picker">
              <i className="fa-solid fa-file-arrow-up" />
              <span>选择 JSON 文件</span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => void handleImportFile(event)}
              />
            </label>
            <label className="evaluation-json-input">
              <span>Dataset JSON</span>
              <textarea
                value={datasetText}
                onChange={(event) => {
                  setDatasetText(event.target.value);
                  setDatasetPreview(null);
                }}
                placeholder={
                  '{\n  "schema_version": 1,\n  "name": "My evaluation",\n  "cases": [...]\n}'
                }
              />
            </label>
            {importError && (
              <p className="evaluation-import-error" role="alert">
                {importError}
              </p>
            )}
            {datasetPreview && (
              <p className="evaluation-import-preview" role="status">
                <i className="fa-solid fa-circle-check" />
                {datasetPreview.name} · {datasetPreview.cases.length} cases，格式有效
              </p>
            )}
            <footer>
              <button
                type="button"
                className="evaluation-button is-secondary"
                onClick={() => setImportOpen(false)}
                disabled={saving}
              >
                取消
              </button>
              <button
                type="button"
                className="evaluation-button is-secondary"
                onClick={previewDataset}
                disabled={!datasetText.trim() || saving}
              >
                验证 JSON
              </button>
              <button
                type="button"
                className="evaluation-button is-primary"
                onClick={() => void importDataset()}
                disabled={!datasetPreview || saving}
              >
                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-plus'}`} />
                导入 Dataset
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
