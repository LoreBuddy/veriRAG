import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import api, { getPublicError } from '@/utils/api';
import emptyKnowledge from '@/assets/images/empty-knowledge.webp';
import type {
  ActiveDeleteJob,
  DeleteJob,
  DeleteJobStatus,
  DeleteStep,
  DocumentItem,
  UploadJob,
  UploadJobStatus,
  UploadStep,
} from '@/types/document';

const ACTIVE_UPLOAD_JOB_STATUSES = new Set<UploadJobStatus>([
  'pending',
  'running',
  'retry_wait',
  'staged',
]);

const TERMINAL_UPLOAD_JOB_STATUSES = new Set<UploadJobStatus>([
  'completed',
  'failed',
  'cancelled',
  'dead_letter',
]);

const RECOVERABLE_DELETE_JOB_STATUSES = new Set<DeleteJobStatus>([
  'running',
  'cleanup_failed',
  'failed',
]);

const ACCEPTED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.html', '.htm']);
const JOB_POLL_INTERVAL_MS = 3000;

interface DocumentListResponse {
  documents: DocumentItem[];
}

interface UploadStartResponse {
  job_id: string;
  filename: string;
  message: string;
}

interface DeleteStartResponse {
  job_id: string;
  filename: string;
  message: string;
}

interface IndexingWorkerReadiness {
  required: boolean;
  ready: boolean;
  fresh_workers: number;
  queue_counts: Record<string, number>;
  latest_heartbeat_at: string | null;
}

interface ReadinessResponse {
  indexing_worker: IndexingWorkerReadiness;
}

interface DeletePollingState {
  jobId: string;
  timer: ReturnType<typeof setInterval>;
  inFlight: boolean;
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof Error && !('response' in error)) return error.message;
  const info = getPublicError(error);
  return `${info.code}: ${info.message}`;
}

function retryMessage(message: string, nextRetryAt?: string | null): string {
  if (!nextRetryAt) return message;
  const timestamp = new Date(nextRetryAt);
  if (Number.isNaN(timestamp.getTime())) return message;
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(timestamp);
  return `${message}；下次重试：${formatted}`;
}

function jobTimestamp(job: { updated_at?: string; created_at?: string }): number {
  const value = Date.parse(job.updated_at || job.created_at || '');
  return Number.isFinite(value) ? value : 0;
}

function latestJobsByKey<T extends { job_id: string; updated_at?: string; created_at?: string }>(
  jobs: T[],
  keyFor: (job: T) => string
): T[] {
  const latest = new Map<string, T>();
  [...jobs]
    .sort((left, right) => jobTimestamp(right) - jobTimestamp(left))
    .forEach((job) => {
      const key = keyFor(job);
      if (key && !latest.has(key)) latest.set(key, job);
    });
  return [...latest.values()];
}

function createUploadSteps(): UploadStep[] {
  return [
    { key: 'upload', label: '文档上传', percent: 0, status: 'pending', message: '' },
    { key: 'reserve', label: '候选版本准备', percent: 0, status: 'pending', message: '' },
    { key: 'parse', label: '解析与版本化分块', percent: 0, status: 'pending', message: '' },
    {
      key: 'parent_store',
      label: '候选父级分块写入',
      percent: 0,
      status: 'pending',
      message: '',
    },
    { key: 'vector_store', label: '候选向量写入', percent: 0, status: 'pending', message: '' },
    { key: 'verify', label: '索引一致性核验', percent: 0, status: 'pending', message: '' },
    { key: 'publish', label: '原子发布新版本', percent: 0, status: 'pending', message: '' },
  ];
}

function createDeleteSteps(): DeleteStep[] {
  return [
    { key: 'prepare', label: '原子撤销检索范围', percent: 0, status: 'pending', message: '' },
    { key: 'milvus', label: '清理向量索引', percent: 0, status: 'pending', message: '' },
    {
      key: 'parent_store',
      label: '清理父级分块与缓存',
      percent: 0,
      status: 'pending',
      message: '',
    },
    { key: 'object_store', label: '清理版本对象', percent: 0, status: 'pending', message: '' },
    { key: 'finalize', label: '确认清理状态', percent: 0, status: 'pending', message: '' },
  ];
}

function displayFileType(filename: string): string {
  const suffix = filename.split('.').pop()?.toLowerCase();
  if (suffix === 'pdf') return 'PDF';
  if (suffix === 'doc' || suffix === 'docx') return 'Word';
  if (suffix === 'xls' || suffix === 'xlsx') return 'Excel';
  if (suffix === 'html' || suffix === 'htm') return 'HTML';
  return 'Document';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(fileType: string): string {
  if (fileType === 'PDF') return 'fa-regular fa-file-pdf';
  if (fileType === 'Word') return 'fa-regular fa-file-word';
  if (fileType === 'Excel') return 'fa-regular fa-file-excel';
  return 'fa-regular fa-file-lines';
}

function fileTone(fileType: string): string {
  if (fileType === 'PDF') return 'pdf';
  if (fileType === 'Word') return 'word';
  if (fileType === 'Excel') return 'excel';
  return 'generic';
}

function stepIcon(status: UploadStep['status']): string {
  if (status === 'completed') return 'fa-solid fa-check';
  if (status === 'running') return 'fa-solid fa-spinner fa-spin';
  if (status === 'failed') return 'fa-solid fa-xmark';
  return 'fa-solid fa-circle';
}

function uploadVersionLabel(doc: DocumentItem): string {
  if (doc.status === 'updating') return '候选版本构建中，旧版本仍可用';
  if (doc.status === 'indexing' || doc.status === 'pending') return '候选版本构建中';
  if (doc.status === 'failed') {
    return doc.error_code ? `候选版本构建失败 · ${doc.error_code}` : '候选版本构建失败';
  }
  if (doc.version_number) return `已原子发布 v${doc.version_number}`;
  return '已建立混合索引';
}

function uploadStatusLabel(doc: DocumentItem, job?: ActiveDeleteJob): string {
  if (job?.status === 'running') return '删除中';
  if (job?.status === 'completed') return '已删除';
  if (job?.status === 'cleanup_failed') return '已撤销，清理失败';
  if (job?.status === 'failed') return '删除失败';
  if (doc.status === 'updating') return '更新中';
  if (doc.status === 'indexing' || doc.status === 'pending') return '构建中';
  if (doc.status === 'failed') return '入库失败';
  if (doc.status === 'deleted') return '已删除';
  return '可检索';
}

function uploadStatusIcon(doc: DocumentItem, job?: ActiveDeleteJob): string {
  if (job?.status === 'running') return 'fa-solid fa-spinner fa-spin';
  if (job?.status === 'failed' || job?.status === 'cleanup_failed') {
    return 'fa-solid fa-triangle-exclamation';
  }
  if (doc.status === 'updating' || doc.status === 'indexing' || doc.status === 'pending') {
    return 'fa-solid fa-spinner fa-spin';
  }
  if (doc.status === 'failed') return 'fa-solid fa-triangle-exclamation';
  return 'fa-solid fa-circle-check';
}

function isDeleteActionLocked(job?: ActiveDeleteJob): boolean {
  return Boolean(
    job &&
    (job.status === 'running' || job.status === 'completed' || job.status === 'cleanup_failed')
  );
}

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadSteps, setUploadSteps] = useState<UploadStep[]>([]);
  const [uploadProgressCollapsed, setUploadProgressCollapsed] = useState(false);
  const [deleteJobs, setDeleteJobs] = useState<Record<string, ActiveDeleteJob>>({});
  const [indexingWorker, setIndexingWorker] = useState<IndexingWorkerReadiness | null>(null);
  const [workerReadinessError, setWorkerReadinessError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentsRef = useRef<DocumentItem[]>([]);
  const deleteJobsRef = useRef<Record<string, ActiveDeleteJob>>({});
  const lifecycleRef = useRef(0);
  const readinessRequestRef = useRef(0);
  const activeUploadJobIdRef = useRef('');
  const uploadPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadPollInFlightRef = useRef(false);
  const deletePollTimersRef = useRef(new Map<string, DeletePollingState>());

  const replaceDocuments = useCallback((next: DocumentItem[]) => {
    documentsRef.current = next;
    setDocuments(next);
  }, []);

  const replaceDeleteJobs = useCallback((next: Record<string, ActiveDeleteJob>) => {
    deleteJobsRef.current = next;
    setDeleteJobs(next);
  }, []);

  const refreshWorkerReadiness = useCallback(async () => {
    const generation = lifecycleRef.current;
    const requestId = ++readinessRequestRef.current;
    try {
      const response = await api.get<ReadinessResponse>('/health/ready', {
        validateStatus: (status) => status === 200 || status === 503,
      });
      if (generation !== lifecycleRef.current || requestId !== readinessRequestRef.current) return;
      const worker = response.data?.indexing_worker;
      if (!worker || typeof worker.ready !== 'boolean') {
        throw new Error('服务就绪响应未包含索引 Worker 状态。');
      }
      setIndexingWorker(worker);
      setWorkerReadinessError('');
    } catch (error) {
      if (generation !== lifecycleRef.current || requestId !== readinessRequestRef.current) return;
      setIndexingWorker(null);
      setWorkerReadinessError(publicErrorMessage(error));
    }
  }, []);

  const mergeDocumentsWithActiveDeletes = useCallback((incoming: DocumentItem[]) => {
    const merged = [...incoming];
    Object.entries(deleteJobsRef.current).forEach(([filename, job]) => {
      if (job.status === 'failed' || merged.some((doc) => doc.filename === filename)) return;
      const existing = documentsRef.current.find((doc) => doc.filename === filename);
      if (existing) merged.push(existing);
    });
    return merged;
  }, []);

  const setDeleteJob = useCallback(
    (filename: string, nextJob: Partial<ActiveDeleteJob>) => {
      const current = deleteJobsRef.current[filename] || {
        status: 'running' as const,
        message: '',
        collapsed: false,
        steps: createDeleteSteps(),
      };
      replaceDeleteJobs({
        ...deleteJobsRef.current,
        [filename]: { ...current, ...nextJob },
      });
    },
    [replaceDeleteJobs]
  );

  const removeDeleteJob = useCallback(
    (filename: string) => {
      const { [filename]: _removed, ...remaining } = deleteJobsRef.current;
      replaceDeleteJobs(remaining);
    },
    [replaceDeleteJobs]
  );

  const stopUploadPolling = useCallback(() => {
    if (uploadPollTimerRef.current !== null) {
      clearInterval(uploadPollTimerRef.current);
      uploadPollTimerRef.current = null;
    }
  }, []);

  const stopDeletePolling = useCallback((filename: string) => {
    const polling = deletePollTimersRef.current.get(filename);
    if (!polling) return;
    clearInterval(polling.timer);
    deletePollTimersRef.current.delete(filename);
  }, []);

  const updateUploadStep = useCallback(
    (key: string, percent: number, status: UploadStep['status'] = 'running', message = '') => {
      setUploadSteps((current) => {
        const steps = current.length ? current : createUploadSteps();
        return steps.map((step) =>
          step.key === key
            ? {
                ...step,
                percent: Math.max(0, Math.min(100, Math.round(percent || 0))),
                status,
                message,
              }
            : step
        );
      });
    },
    []
  );

  const syncUploadJob = useCallback((job: UploadJob) => {
    activeUploadJobIdRef.current = job.job_id;
    setUploadProgress(retryMessage(job.message || '', job.next_retry_at));
    if (Array.isArray(job.steps)) {
      setUploadSteps(
        job.steps.map((step) => ({
          key: step.key,
          label: step.label,
          percent: step.percent,
          status: step.status,
          message: step.message || '',
        }))
      );
    }
    if (job.status === 'completed') setUploadProgressCollapsed(true);
  }, []);

  const loadDocuments = useCallback(async () => {
    const generation = lifecycleRef.current;
    const response = await api.get<DocumentListResponse>('/documents');
    if (lifecycleRef.current !== generation) return;
    replaceDocuments(mergeDocumentsWithActiveDeletes(response.data.documents || []));
  }, [mergeDocumentsWithActiveDeletes, replaceDocuments]);

  const pollUploadJob = useCallback(
    async (jobId: string) => {
      if (uploadPollInFlightRef.current || activeUploadJobIdRef.current !== jobId) return;
      uploadPollInFlightRef.current = true;
      const generation = lifecycleRef.current;
      try {
        const response = await api.get<UploadJob>(
          `/documents/upload/jobs/${encodeURIComponent(jobId)}`
        );
        if (lifecycleRef.current !== generation || activeUploadJobIdRef.current !== jobId) {
          return;
        }

        const job = response.data;
        syncUploadJob(job);
        if (job.status === 'completed') {
          stopUploadPolling();
          activeUploadJobIdRef.current = '';
          setIsUploading(false);
          setSelectedFile(null);
          try {
            await loadDocuments();
          } catch (error) {
            setUploadProgress(
              `${job.message || '文档版本已发布'}；目录刷新失败：${publicErrorMessage(error)}`
            );
          }
        } else if (TERMINAL_UPLOAD_JOB_STATUSES.has(job.status)) {
          stopUploadPolling();
          activeUploadJobIdRef.current = '';
          setIsUploading(false);
        }
      } catch (error) {
        if (lifecycleRef.current === generation && activeUploadJobIdRef.current === jobId) {
          setUploadProgress(
            `进度连接中断：${publicErrorMessage(error)}；后台任务仍在继续，3 秒后自动重试`
          );
        }
      } finally {
        uploadPollInFlightRef.current = false;
      }
    },
    [loadDocuments, stopUploadPolling, syncUploadJob]
  );

  const startUploadPolling = useCallback(
    (jobId: string) => {
      stopUploadPolling();
      activeUploadJobIdRef.current = jobId;
      uploadPollTimerRef.current = setInterval(
        () => void pollUploadJob(jobId),
        JOB_POLL_INTERVAL_MS
      );
      void pollUploadJob(jobId);
    },
    [pollUploadJob, stopUploadPolling]
  );

  const setDeleteJobFromResponse = useCallback(
    (filename: string, job: DeleteJob) => {
      const current = deleteJobsRef.current[filename] || {};
      if (
        current.jobId === job.job_id &&
        current.status !== 'running' &&
        job.status === 'running'
      ) {
        return;
      }
      setDeleteJob(filename, {
        jobId: job.job_id,
        documentId: job.document_id,
        documentVersionId: job.document_version_id,
        deadLetterJobIds: Array.isArray(job.dead_letter_job_ids)
          ? [...job.dead_letter_job_ids]
          : [],
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        nextRetryAt: job.next_retry_at,
        status: job.status,
        message: retryMessage(job.message || '', job.next_retry_at),
        collapsed:
          job.status === 'completed' || job.status === 'cleanup_failed'
            ? true
            : Boolean(current.collapsed),
        steps: Array.isArray(job.steps)
          ? job.steps.map((step) => ({
              key: step.key,
              label: step.label,
              percent: step.percent,
              status: step.status,
              message: step.message || '',
            }))
          : createDeleteSteps(),
      });
    },
    [setDeleteJob]
  );

  const finalizeDeletedDocument = useCallback(
    async (filename: string) => {
      replaceDocuments(documentsRef.current.filter((doc) => doc.filename !== filename));
      removeDeleteJob(filename);
      try {
        await loadDocuments();
      } catch (error) {
        setWorkspaceNotice(`文档已删除，但目录刷新失败：${publicErrorMessage(error)}`);
      }
    },
    [loadDocuments, removeDeleteJob, replaceDocuments]
  );

  const pollDeleteJob = useCallback(
    async (filename: string, jobId: string) => {
      const polling = deletePollTimersRef.current.get(filename);
      if (!polling || polling.jobId !== jobId || polling.inFlight) return;
      polling.inFlight = true;
      const generation = lifecycleRef.current;
      try {
        const response = await api.get<DeleteJob>(
          `/documents/delete/jobs/${encodeURIComponent(jobId)}`
        );
        if (
          lifecycleRef.current !== generation ||
          deletePollTimersRef.current.get(filename)?.jobId !== jobId
        ) {
          return;
        }
        const job = response.data;
        setDeleteJobFromResponse(filename, job);
        if (job.status === 'completed') {
          stopDeletePolling(filename);
          await finalizeDeletedDocument(filename);
        } else if (job.status === 'cleanup_failed' || job.status === 'failed') {
          stopDeletePolling(filename);
        }
      } catch (error) {
        if (
          lifecycleRef.current === generation &&
          deletePollTimersRef.current.get(filename)?.jobId === jobId
        ) {
          setDeleteJob(filename, {
            status: 'running',
            message: `删除进度连接中断：${publicErrorMessage(error)}；后台清理仍在继续，3 秒后自动重试`,
            collapsed: false,
          });
        }
      } finally {
        const current = deletePollTimersRef.current.get(filename);
        if (current?.jobId === jobId) current.inFlight = false;
      }
    },
    [finalizeDeletedDocument, setDeleteJob, setDeleteJobFromResponse, stopDeletePolling]
  );

  const startDeletePolling = useCallback(
    (filename: string, jobId: string) => {
      stopDeletePolling(filename);
      const timer = setInterval(
        () => void pollDeleteJob(filename, jobId),
        JOB_POLL_INTERVAL_MS
      );
      deletePollTimersRef.current.set(filename, { jobId, timer, inFlight: false });
      void pollDeleteJob(filename, jobId);
    },
    [pollDeleteJob, stopDeletePolling]
  );

  const restoreDurableUploadJob = useCallback(async () => {
    const generation = lifecycleRef.current;
    const response = await api.get<UploadJob[]>('/documents/upload/jobs');
    if (lifecycleRef.current !== generation) return;
    const jobs = Array.isArray(response.data) ? response.data : [];
    const latestPerDocument = latestJobsByKey(jobs, (job) => job.filename || job.job_id);
    const activeJob = latestPerDocument
      .filter((job) => ACTIVE_UPLOAD_JOB_STATUSES.has(job.status))
      .sort((left, right) => jobTimestamp(right) - jobTimestamp(left))[0];
    if (!activeJob) return;

    setIsUploading(true);
    setSelectedFile(null);
    setUploadProgressCollapsed(false);
    syncUploadJob(activeJob);
    startUploadPolling(activeJob.job_id);
  }, [startUploadPolling, syncUploadJob]);

  const restoreDurableDeleteJobs = useCallback(async () => {
    const generation = lifecycleRef.current;
    const response = await api.get<DeleteJob[]>('/documents/delete/jobs');
    if (lifecycleRef.current !== generation) return;
    const jobs = Array.isArray(response.data) ? response.data : [];
    const latestPerDocument = latestJobsByKey(
      jobs,
      (job) => job.filename || job.document_id || job.job_id
    );

    latestPerDocument.forEach((job) => {
      const filename = job.filename?.trim();
      if (!filename) return;

      const document = documentsRef.current.find((item) => item.filename === filename);
      const documentTime = document?.uploaded_at ? Date.parse(document.uploaded_at) : NaN;
      const retirementTime = job.created_at ? Date.parse(job.created_at) : NaN;
      if (
        job.status !== 'failed' &&
        Number.isFinite(documentTime) &&
        Number.isFinite(retirementTime) &&
        documentTime > retirementTime
      ) {
        stopDeletePolling(filename);
        removeDeleteJob(filename);
        return;
      }
      if (job.status === 'completed') {
        if (deleteJobsRef.current[filename]) {
          setDeleteJobFromResponse(filename, job);
          void finalizeDeletedDocument(filename);
        }
        return;
      }
      if (!RECOVERABLE_DELETE_JOB_STATUSES.has(job.status)) return;

      setDeleteJobFromResponse(filename, job);
      if (!documentsRef.current.some((documentItem) => documentItem.filename === filename)) {
        replaceDocuments([
          ...documentsRef.current,
          {
            filename,
            file_type: displayFileType(filename),
            chunk_count: 0,
            document_id: job.document_id || undefined,
            current_version_id: null,
            pending_version_id: null,
            status: 'deleted',
          },
        ]);
      }
      if (job.status === 'running') startDeletePolling(filename, job.job_id);
      else stopDeletePolling(filename);
    });
  }, [
    finalizeDeletedDocument,
    removeDeleteJob,
    replaceDocuments,
    setDeleteJobFromResponse,
    startDeletePolling,
    stopDeletePolling,
  ]);

  const initializeDocumentWorkspace = useCallback(async () => {
    const generation = lifecycleRef.current;
    setDocumentsLoading(true);
    setWorkspaceNotice('');
    void refreshWorkerReadiness();
    try {
      const initialResults = await Promise.allSettled([loadDocuments(), restoreDurableUploadJob()]);
      const deleteResults = await Promise.allSettled([restoreDurableDeleteJobs()]);
      if (lifecycleRef.current !== generation) return;

      const failures = [...initialResults, ...deleteResults]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => publicErrorMessage(result.reason));
      if (failures.length) setWorkspaceNotice(`知识库同步失败：${failures.join('；')}`);
    } finally {
      if (lifecycleRef.current === generation) setDocumentsLoading(false);
    }
  }, [loadDocuments, refreshWorkerReadiness, restoreDurableDeleteJobs, restoreDurableUploadJob]);

  useEffect(() => {
    lifecycleRef.current += 1;
    void initializeDocumentWorkspace();
    return () => {
      lifecycleRef.current += 1;
      stopUploadPolling();
      activeUploadJobIdRef.current = '';
      deletePollTimersRef.current.forEach(({ timer }) => clearInterval(timer));
      deletePollTimersRef.current.clear();
    };
  }, [initializeDocumentWorkspace, stopUploadPolling]);

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter(
      (doc) =>
        doc.filename.toLowerCase().includes(query) || doc.file_type.toLowerCase().includes(query)
    );
  }, [documents, searchQuery]);

  const totalChunks = useMemo(
    () => documents.reduce((total, doc) => total + Number(doc.chunk_count || 0), 0),
    [documents]
  );

  const selectFile = (file?: File) => {
    if (!file) return;
    const suffix = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
    if (!ACCEPTED_EXTENSIONS.has(suffix)) {
      setWorkspaceNotice('文件格式不受支持，请选择 PDF、Word、Excel 或 HTML 文件。');
      return;
    }
    setWorkspaceNotice('');
    setSelectedFile(file);
    setUploadProgress('');
    setUploadSteps(createUploadSteps());
    setUploadProgressCollapsed(false);
    activeUploadJobIdRef.current = '';
  };

  const onFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const onFileDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!isUploading) selectFile(event.dataTransfer.files[0]);
  };

  const uploadDocument = async () => {
    if (!selectedFile || isUploading) return;
    const generation = lifecycleRef.current;
    setIsUploading(true);
    setUploadProgress('正在上传...');
    setUploadSteps(createUploadSteps());
    setUploadProgressCollapsed(false);
    updateUploadStep('upload', 0, 'running', '准备上传');

    const formData = new FormData();
    formData.append('file', selectedFile);
    try {
      const response = await api.post<UploadStartResponse>('/documents/upload/async', formData, {
        onUploadProgress: (progressEvent) => {
          if (!progressEvent.total || lifecycleRef.current !== generation) return;
          const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
          updateUploadStep('upload', percent, 'running', `已上传 ${percent}%`);
        },
      });
      if (lifecycleRef.current !== generation) return;
      updateUploadStep('upload', 100, 'completed', '文档上传完成');
      setUploadProgress(response.data.message);
      activeUploadJobIdRef.current = response.data.job_id;
      startUploadPolling(response.data.job_id);
    } catch (error) {
      if (lifecycleRef.current !== generation) return;
      const detail = publicErrorMessage(error);
      updateUploadStep('upload', 100, 'failed', detail);
      setUploadProgress(`上传失败：${detail}`);
      setWorkspaceNotice(`上传文档失败：${detail}`);
      setIsUploading(false);
    }
  };

  const deleteDocument = async (filename: string) => {
    if (isDeleteActionLocked(deleteJobsRef.current[filename])) return;
    if (!window.confirm(`确定要删除文档 "${filename}" 吗？这将同时删除相关索引数据。`)) return;

    setDeleteJob(filename, {
      status: 'running',
      message: '正在提交删除任务...',
      collapsed: false,
      steps: createDeleteSteps().map((step) =>
        step.key === 'prepare'
          ? { ...step, percent: 1, status: 'running' as const, message: '正在提交删除任务' }
          : step
      ),
    });
    const generation = lifecycleRef.current;
    try {
      const response = await api.delete<DeleteStartResponse>(
        `/documents/delete/async/${encodeURIComponent(filename)}`
      );
      if (lifecycleRef.current !== generation) return;
      setDeleteJob(filename, {
        jobId: response.data.job_id,
        status: 'running',
        message: response.data.message || `正在删除 ${filename}`,
        collapsed: false,
      });
      startDeletePolling(filename, response.data.job_id);
    } catch (error) {
      if (lifecycleRef.current !== generation) return;
      const detail = publicErrorMessage(error);
      setDeleteJob(filename, {
        status: 'failed',
        message: `删除文档失败：${detail}`,
        collapsed: false,
      });
      setWorkspaceNotice(`删除文档失败：${detail}`);
    }
  };

  const toggleDeleteJobCollapsed = (filename: string) => {
    const job = deleteJobsRef.current[filename];
    if (job) setDeleteJob(filename, { collapsed: !job.collapsed });
  };

  const selectedFileSize = selectedFile ? formatFileSize(selectedFile.size) : '';
  const completedUploadSteps = uploadSteps.filter((step) => step.status === 'completed').length;
  const queuedIndexJobs = indexingWorker?.queue_counts.index_pending ?? 0;
  const workerUnavailable = Boolean(
    indexingWorker && !indexingWorker.ready && (indexingWorker.required || queuedIndexJobs > 0)
  );
  const indexingWorkerStatus = documentsLoading
    ? '同步中'
    : workerReadinessError
      ? '状态未知'
      : !indexingWorker
        ? '检查中'
        : indexingWorker.ready
          ? 'Worker 在线'
          : 'Worker 未就绪';

  return (
    <div className="settings-panel">
      <header className="settings-header">
        <div>
          <span className="panel-eyebrow">Mew memory</span>
          <h1>知识库</h1>
          <p>管理喵喵可以检索的文档、索引与数据源。</p>
        </div>
        <button
          type="button"
          className="settings-refresh-btn"
          disabled={documentsLoading}
          onClick={() => void initializeDocumentWorkspace()}
        >
          <i className={`fa-solid fa-rotate${documentsLoading ? ' fa-spin' : ''}`} />
          刷新数据
        </button>
      </header>

      {workspaceNotice && (
        <p className="operation-notice" role="status" aria-live="polite">
          {workspaceNotice}
        </p>
      )}
      {workerReadinessError && (
        <p className="operation-notice" role="status" aria-live="polite">
          无法读取 Indexing Worker 状态：{workerReadinessError}
        </p>
      )}
      {workerUnavailable && (
        <p className="operation-notice" role="status" aria-live="polite">
          Indexing Worker 尚未就绪（在线 Worker：{indexingWorker?.fresh_workers ?? 0}；
          排队任务：{queuedIndexJobs}）。已保存的候选版本会留在队列中，直到 Worker 恢复。
          可在仓库根目录运行 <code>uv run --no-sync python -m backend.workers.indexing</code>。
        </p>
      )}

      <section className="settings-stats" aria-label="知识库概况">
        <article>
          <span>文档总数</span>
          <strong>{documents.length}</strong>
          <small>当前知识空间</small>
        </article>
        <article>
          <span>可检索片段</span>
          <strong>{totalChunks.toLocaleString('zh-CN')}</strong>
          <small>Milvus 叶子分块</small>
        </article>
        <article>
          <span>索引状态</span>
          <strong>{indexingWorkerStatus}</strong>
          <small>
            {isUploading
              ? '正在处理新文档'
              : queuedIndexJobs > 0
                ? `${queuedIndexJobs} 个任务排队中`
                : '文档目录已同步'}
          </small>
        </article>
        <article>
          <span>支持格式</span>
          <strong>4 类</strong>
          <small>PDF · Word · Excel · HTML</small>
        </article>
      </section>

      <div className="settings-grid">
        <section className="documents-section" aria-labelledby="documents-heading">
          <div className="documents-section-head">
            <div>
              <h2 id="documents-heading">全部文档</h2>
              <p>{filteredDocuments.length} 份资料可供喵喵检索</p>
            </div>
            <label className="document-search">
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <input
                type="search"
                placeholder="搜索文档名称…"
                aria-label="搜索知识库文档"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          </div>

          <div className="document-table-head" aria-hidden="true">
            <span>名称</span>
            <span>片段</span>
            <span>状态</span>
            <span />
          </div>

          {documentsLoading ? (
            <div className="loading-indicator" role="status">
              <span className="loading-orb">
                <i className="fa-solid fa-spinner fa-spin" />
              </span>
              <strong>正在同步知识库</strong>
              <p>正在读取 Document Catalog 与当前版本统计。</p>
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="empty-documents">
              {!searchQuery && (
                <img
                  src={emptyKnowledge}
                  className="empty-illustration empty-knowledge-illustration"
                  alt=""
                />
              )}
              {searchQuery && (
                <span className="empty-icon">
                  <i className="fa-solid fa-magnifying-glass" />
                </span>
              )}
              <h3>{searchQuery ? '没有匹配的文档' : '知识库还是空的'}</h3>
              <p>{searchQuery ? '换一个关键词试试。' : '从右侧上传第一份资料，让喵喵开始学习。'}</p>
            </div>
          ) : (
            <div className="documents-list">
              {filteredDocuments.map((doc) => {
                const deleteJob = deleteJobs[doc.filename];
                const failedDelete = deleteJob?.status === 'failed';
                return (
                  <article
                    key={doc.filename}
                    className={`document-item${deleteJob?.status === 'running' ? ' deleting' : ''}`}
                  >
                    <div className="document-row">
                      <div className="document-info">
                        <span className={`document-icon ${fileTone(doc.file_type)}`}>
                          <i className={fileIcon(doc.file_type)} />
                        </span>
                        <span className="document-details">
                          <strong className="document-name" title={doc.filename}>
                            {doc.filename}
                          </strong>
                          <small>
                            {doc.file_type} · {uploadVersionLabel(doc)}
                          </small>
                        </span>
                      </div>
                      <span className="document-chunks">
                        {Number(doc.chunk_count || 0).toLocaleString('zh-CN')}
                      </span>
                      <span
                        className={`document-status${failedDelete || doc.status === 'failed' ? ' failed' : ''}`}
                      >
                        <i className={uploadStatusIcon(doc, deleteJob)} />
                        {uploadStatusLabel(doc, deleteJob)}
                      </span>
                      <button
                        type="button"
                        className="btn-danger"
                        aria-label={`${failedDelete ? '重试删除' : '删除文档'} ${doc.filename}`}
                        title={
                          failedDelete
                            ? '重试删除'
                            : deleteJob?.status === 'cleanup_failed'
                              ? '已不可检索，物理清理失败，需管理员受控重试'
                              : '删除文档'
                        }
                        disabled={isDeleteActionLocked(deleteJob)}
                        onClick={() => void deleteDocument(doc.filename)}
                      >
                        <i
                          className={
                            deleteJob?.status === 'running'
                              ? 'fa-solid fa-spinner fa-spin'
                              : deleteJob?.status === 'completed'
                                ? 'fa-solid fa-check'
                                : deleteJob?.status === 'cleanup_failed'
                                  ? 'fa-solid fa-triangle-exclamation'
                                  : 'fa-solid fa-trash'
                          }
                        />
                      </button>
                    </div>

                    {deleteJob && (
                      <div
                        className={`upload-progress delete-progress${deleteJob.collapsed ? ' collapsed' : ''}`}
                      >
                        <button
                          type="button"
                          className="upload-progress-header"
                          aria-expanded={!deleteJob.collapsed}
                          onClick={() => toggleDeleteJobCollapsed(doc.filename)}
                        >
                          <span>
                            <strong>{deleteJob.message || '删除进度'}</strong>
                            <small>
                              {deleteJob.status === 'completed'
                                ? '清理完成'
                                : deleteJob.status === 'cleanup_failed'
                                  ? '检索范围已撤销，物理清理失败，需管理员处理'
                                  : '正在同步各存储层'}
                            </small>
                          </span>
                          <span className="upload-toggle">
                            {deleteJob.collapsed ? '展开' : '收起'}
                            <i
                              className={
                                deleteJob.collapsed
                                  ? 'fa-solid fa-chevron-down'
                                  : 'fa-solid fa-chevron-up'
                              }
                            />
                          </span>
                        </button>
                        {!deleteJob.collapsed && (
                          <div className="upload-step-list">
                            {deleteJob.steps.map((step) => (
                              <div
                                key={step.key}
                                className={`upload-step upload-step-${step.status}`}
                              >
                                <div className="upload-step-header">
                                  <span className="upload-step-label">{step.label}</span>
                                  <span className="upload-step-percent">{step.percent}%</span>
                                </div>
                                <div className="upload-step-bar">
                                  <div
                                    className="upload-step-fill"
                                    style={{ width: `${step.percent}%` }}
                                  />
                                </div>
                                {step.message && (
                                  <div className="upload-step-message">{step.message}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="upload-section" aria-labelledby="upload-heading">
          <div className="upload-section-head">
            <span className="upload-title-icon">
              <i className="fa-solid fa-cloud-arrow-up" />
            </span>
            <div>
              <h2 id="upload-heading">快速入库</h2>
              <p>解析结构、三级分块并写入混合索引。</p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.html,.htm"
            aria-label="选择要入库的文件"
            hidden
            onChange={onFileSelect}
          />
          <button
            type="button"
            className="upload-dropzone"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onFileDrop}
          >
            <span className="dropzone-icon">
              <i className="fa-solid fa-arrow-up-from-bracket" />
            </span>
            <strong>{selectedFile ? selectedFile.name : '拖放文件到这里'}</strong>
            <span>
              {selectedFile ? selectedFileSize : '或点击选择 PDF、Word、Excel、HTML 文件'}
            </span>
          </button>

          {selectedFile && (
            <div className="selected-file">
              <span className="selected-file-icon">
                <i className="fa-regular fa-file-lines" />
              </span>
              <span className="selected-file-copy">
                <strong title={selectedFile.name}>{selectedFile.name}</strong>
                <small>{selectedFileSize} · 等待上传</small>
              </span>
              <button
                type="button"
                className="btn-primary"
                disabled={isUploading}
                onClick={() => void uploadDocument()}
              >
                <i
                  className={isUploading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-up'}
                />
                {isUploading ? '处理中' : '开始上传'}
              </button>
            </div>
          )}

          {uploadSteps.length > 0 && (
            <div className={`upload-progress${uploadProgressCollapsed ? ' collapsed' : ''}`}>
              <button
                type="button"
                className="upload-progress-header"
                aria-expanded={!uploadProgressCollapsed}
                onClick={() => setUploadProgressCollapsed((collapsed) => !collapsed)}
              >
                <span>
                  <strong>{uploadProgress || '上传进度'}</strong>
                  <small>
                    {completedUploadSteps} / {uploadSteps.length} 个阶段完成
                  </small>
                </span>
                <span className="upload-toggle">
                  {uploadProgressCollapsed ? '展开' : '收起'}
                  <i
                    className={
                      uploadProgressCollapsed
                        ? 'fa-solid fa-chevron-down'
                        : 'fa-solid fa-chevron-up'
                    }
                  />
                </span>
              </button>
              {!uploadProgressCollapsed && (
                <div className="upload-step-list">
                  {uploadSteps.map((step) => (
                    <div key={step.key} className={`upload-step upload-step-${step.status}`}>
                      <div className="upload-step-header">
                        <span className="upload-step-label">
                          <i className={stepIcon(step.status)} />
                          {step.label}
                        </span>
                        <span className="upload-step-percent">{step.percent}%</span>
                      </div>
                      <div className="upload-step-bar">
                        <div className="upload-step-fill" style={{ width: `${step.percent}%` }} />
                      </div>
                      {step.message && <div className="upload-step-message">{step.message}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="upload-pipeline-note">
            <div>
              <span>01</span>
              <p>
                <strong>结构解析</strong>
                <small>识别章节、表格与页面</small>
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>三级分块</strong>
                <small>保留父子上下文关系</small>
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>混合索引</strong>
                <small>Dense + BM25 同步写入</small>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
