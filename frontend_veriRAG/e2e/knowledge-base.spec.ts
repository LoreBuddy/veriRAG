import { expect, test } from '@playwright/test';

test('admin can upload, inspect, search, and delete a knowledge document', async ({ page }) => {
  const document = {
    filename: 'guide.pdf',
    file_type: 'PDF',
    chunk_count: 7,
    document_id: 'document-1',
    current_version_id: 'version-1',
    pending_version_id: null,
    version_number: 1,
    status: 'ready',
    parent_chunk_count: 2,
    size_bytes: 4096,
    uploaded_at: '2026-11-19T00:00:00Z',
  };
  const uploadSteps = [
    { key: 'upload', label: '文档上传', percent: 100, status: 'completed', message: '上传完成' },
    { key: 'reserve', label: '候选版本准备', percent: 100, status: 'completed', message: '已预留' },
    {
      key: 'parse',
      label: '解析与版本化分块',
      percent: 100,
      status: 'completed',
      message: '已解析',
    },
    {
      key: 'parent_store',
      label: '候选父级分块写入',
      percent: 100,
      status: 'completed',
      message: '已写入',
    },
    {
      key: 'vector_store',
      label: '候选向量写入',
      percent: 100,
      status: 'completed',
      message: '已写入',
    },
    {
      key: 'verify',
      label: '索引一致性核验',
      percent: 100,
      status: 'completed',
      message: '已核验',
    },
    {
      key: 'publish',
      label: '原子发布新版本',
      percent: 100,
      status: 'completed',
      message: '已发布',
    },
  ];
  let catalog: (typeof document)[] = [];
  let uploadStarted = false;
  let deleteStarted = false;

  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      json: { access_token: 'knowledge-base-token', username: 'admin-user', role: 'admin' },
    });
  });
  await page.route('**/health/ready', async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        status: 'not_ready',
        indexing_worker: {
          required: true,
          ready: false,
          fresh_workers: 0,
          queue_counts: { index_pending: 1 },
          latest_heartbeat_at: null,
        },
      },
    });
  });
  await page.route('**/v1/capabilities', async (route) => {
    await route.fulfill({
      json: { schema_version: 1, catalog_hash: 'c'.repeat(64), skills: [], tools: [] },
    });
  });
  await page.route('**/v1/threads', async (route) => {
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route('**/documents', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { documents: catalog } });
  });
  await page.route('**/documents/upload/jobs', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/documents/upload/jobs/upload-job-1', async (route) => {
    await route.fulfill({
      json: {
        job_id: 'upload-job-1',
        filename: document.filename,
        status: 'completed',
        current_step: 'publish',
        message: '文档版本已原子发布',
        document_id: document.document_id,
        document_version_id: document.current_version_id,
        total_chunks: document.chunk_count,
        processed_chunks: document.chunk_count,
        attempts: 1,
        max_attempts: 3,
        execution_fence: 1,
        created_at: '2026-11-19T00:00:00Z',
        updated_at: '2026-11-19T00:00:01Z',
        steps: uploadSteps,
      },
    });
  });
  await page.route('**/documents/upload/async', async (route) => {
    uploadStarted = true;
    catalog = [document];
    await route.fulfill({
      status: 202,
      json: {
        job_id: 'upload-job-1',
        filename: document.filename,
        message: '文件已上传，候选版本进入持久化 worker 队列',
        document_id: document.document_id,
        document_version_id: document.current_version_id,
        version_number: document.version_number,
        status: 'pending',
      },
    });
  });
  await page.route('**/documents/delete/jobs', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/documents/delete/jobs/delete-job-1', async (route) => {
    await route.fulfill({
      json: {
        job_id: 'delete-job-1',
        filename: document.filename,
        document_id: document.document_id,
        document_version_id: document.current_version_id,
        status: 'completed',
        current_step: 'finalize',
        message: '文档物理数据已完成清理',
        total_chunks: 1,
        processed_chunks: 1,
        attempts: 1,
        max_attempts: 3,
        execution_fence: 1,
        created_at: '2026-11-19T00:00:02Z',
        updated_at: '2026-11-19T00:00:03Z',
        steps: [
          {
            key: 'prepare',
            label: '原子撤销检索范围',
            percent: 100,
            status: 'completed',
            message: '',
          },
          { key: 'milvus', label: '清理向量索引', percent: 100, status: 'completed', message: '' },
          {
            key: 'parent_store',
            label: '清理父级分块与缓存',
            percent: 100,
            status: 'completed',
            message: '',
          },
          {
            key: 'object_store',
            label: '清理版本对象',
            percent: 100,
            status: 'completed',
            message: '',
          },
          {
            key: 'finalize',
            label: '确认清理状态',
            percent: 100,
            status: 'completed',
            message: '',
          },
        ],
      },
    });
  });
  await page.route('**/documents/delete/async/guide.pdf', async (route) => {
    deleteStarted = true;
    catalog = [];
    await route.fulfill({
      status: 202,
      json: {
        job_id: 'delete-job-1',
        filename: document.filename,
        message: 'guide.pdf 已从检索目录撤销，物理清理已进入持久化队列',
      },
    });
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: '知识库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '全部文档' })).toBeVisible();
  await expect(page.getByText('Indexing Worker 尚未就绪', { exact: false })).toBeVisible();
  await expect(page.getByText('知识库还是空的')).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: document.filename,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7'),
  });
  await expect(page.locator('.selected-file').getByText('guide.pdf')).toBeVisible();
  await page.getByRole('button', { name: '开始上传' }).click();

  await expect.poll(() => uploadStarted).toBe(true);
  await expect(page.getByText('已原子发布 v1')).toBeVisible();
  await expect(page.locator('.document-chunks')).toHaveText('7');
  await page.getByRole('searchbox', { name: '搜索知识库文档' }).fill('missing');
  await expect(page.getByText('没有匹配的文档')).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索知识库文档' }).fill('guide');
  await expect(page.getByText('guide.pdf')).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索知识库文档' }).fill('');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除文档 guide.pdf' }).click();
  await expect.poll(() => deleteStarted).toBe(true);
  await expect(page.getByText('知识库还是空的')).toBeVisible();
});

test('knowledge base content scrolls within the page viewport', async ({ page }) => {
  const documents = Array.from({ length: 24 }, (_, index) => ({
    filename: `guide-${index}.pdf`,
    file_type: 'PDF',
    chunk_count: 7,
    document_id: `document-${index}`,
    current_version_id: `version-${index}`,
    pending_version_id: null,
    version_number: 1,
    status: 'ready',
    parent_chunk_count: 2,
    size_bytes: 4096,
    uploaded_at: '2026-11-19T00:00:00Z',
  }));

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      json: { access_token: 'knowledge-base-token', username: 'admin-user', role: 'admin' },
    });
  });
  await page.route('**/health/ready', async (route) => {
    await route.fulfill({
      json: {
        status: 'ready',
        indexing_worker: {
          required: true,
          ready: true,
          fresh_workers: 1,
          queue_counts: { index_pending: 0 },
          latest_heartbeat_at: '2026-11-19T00:00:00Z',
        },
      },
    });
  });
  await page.route('**/v1/capabilities', async (route) => {
    await route.fulfill({
      json: { schema_version: 1, catalog_hash: 'c'.repeat(64), skills: [], tools: [] },
    });
  });
  await page.route('**/v1/threads', async (route) => {
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route('**/documents', async (route) => {
    await route.fulfill({ json: { documents } });
  });
  await page.route('**/documents/upload/jobs', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/documents/delete/jobs', async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '知识库', exact: true }).click();
  const panel = page.locator('.settings-panel');
  await expect(page.getByText('guide-23.pdf')).toBeVisible();
  await expect.poll(() => panel.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true
  );
  await panel.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
