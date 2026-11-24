import { expect, test } from '@playwright/test';

test('selects web research and sends its explicit skill activation', async ({ page }) => {
  const threadId = 'thread-web-research';
  const runId = 'run-web-research';
  const ragTrace = {
    tool_used: true,
    retrieval_mode: '网络研究',
    retrieval_pipeline: 'web-search',
    recall_count: 1,
    evidence_confidence: 0.92,
    retrieved_chunks: [
      {
        filename: 'spec.pdf',
        page_number: 4,
        rrf_rank: 1,
        rerank_score: 0.91,
        text: '来源中的核验内容。',
        chunk_id: 'chunk-1',
        document_id: 'document-1',
        document_version_id: 'version-1',
        section_id: 'section-1',
        index_version: 'index-1',
        content_hash: 'hash-1',
      },
    ],
  };
  let runRequest: Record<string, unknown> | null = null;
  let messagesRead = false;
  const unauthorizedUrls: string[] = [];

  page.on('response', (response) => {
    if (response.status() === 401) unauthorizedUrls.push(response.url());
  });

  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      json: { access_token: 'web-research-token', username: 'research-user', role: 'user' },
    });
  });
  await page.route('**/v1/capabilities', async (route) => {
    await route.fulfill({
      json: {
        schema_version: 1,
        catalog_hash: 'a'.repeat(64),
        skills: [
          {
            name: 'web-research',
            version: '1.0.0',
            description: 'Research current public information.',
            activation: '/web-research',
            available: true,
            availability_reason: null,
            required_roles: [],
            tool_names: ['web_search', 'web_fetch'],
            approval_tools: [],
            network_policies: ['restricted'],
            resource_scopes: ['public-web'],
          },
        ],
        tools: [],
      },
    });
  });
  await page.route('**/v1/threads', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        json: {
          thread_id: threadId,
          title: '新对话',
          message_count: 0,
          version: 0,
          thread_status: 'active',
          active_run_id: null,
          active_run_status: null,
          created_at: '2026-11-19T00:00:00Z',
          updated_at: '2026-11-19T00:00:00Z',
        },
      });
      return;
    }
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route('**/v1/threads/*/runs', async (route) => {
    runRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: {
        run: {
          id: runId,
          thread_id: threadId,
          status: 'running',
          idempotency_key: 'web-research-key',
          user_message_id: 1,
          assistant_message_id: 2,
          on_disconnect: 'continue',
        },
        created: true,
        thread_version: 1,
      },
    });
  });
  await page.route(`**/v1/runs/${runId}`, async (route) => {
    await route.fulfill({
      json: {
        id: runId,
        thread_id: threadId,
        status: 'succeeded',
        idempotency_key: 'web-research-key',
        user_message_id: 1,
        assistant_message_id: 2,
        on_disconnect: 'continue',
      },
    });
  });
  await page.route(`**/v1/runs/${runId}/events*`, async (route) => {
    const event = (sequence: number, type: string, data: Record<string, unknown>) => ({
      schema_version: 1,
      sequence,
      event_id: `${runId}:${sequence}`,
      run_id: runId,
      thread_id: threadId,
      type,
      timestamp: `2026-11-19T00:00:0${sequence}Z`,
      data,
    });
    const after = Number(new URL(route.request().url()).searchParams.get('after') || 0);
    const events = [
      event(1, 'run.created', { status: 'queued' }),
      event(2, 'run.started', {}),
      event(3, 'retrieval.started', {}),
      event(4, 'retrieval.completed', { duration_ms: 240 }),
      event(5, 'message.completed', {
        content: '已基于公开来源完成调研。',
        status: 'completed',
        rag_trace: ragTrace,
      }),
      event(6, 'run.completed', {}),
    ];
    const pageEvents =
      after === 0 && !messagesRead
        ? events.slice(0, 5)
        : events.filter((item) => item.sequence > after);
    await route.fulfill({
      json: {
        events: pageEvents,
        next_after: pageEvents.at(-1)?.sequence || 0,
      },
    });
  });
  await page.route(`**/v1/threads/${threadId}/messages**`, async (route) => {
    messagesRead = true;
    await route.fulfill({
      json: {
        messages: [
          {
            id: 2,
            run_id: runId,
            sequence: 2,
            status: 'completed',
            role: 'assistant',
            content: '已基于公开来源完成调研。',
            timestamp: '2026-11-19T00:00:01Z',
            rag_trace: ragTrace,
          },
        ],
        previous_cursor: null,
      },
    });
  });

  await page.goto('/');
  await expect(page.getByPlaceholder(/和喵喵说点什么/)).toBeVisible();
  const webResearch = page.getByRole('button', { name: /网络研究/ });
  await expect(webResearch).toBeEnabled();
  await webResearch.click();

  await expect(page.getByText('网络研究 · 查询公开来源')).toBeVisible();
  const input = page.getByPlaceholder('描述要调研的公开问题…');
  await input.fill('核验某公开信息');
  await page.getByRole('button', { name: '发送消息' }).click();

  await expect.poll(() => runRequest).not.toBeNull();
  expect(runRequest).toMatchObject({ message: '/web-research\n核验某公开信息' });
  expect(unauthorizedUrls, 'unexpected unauthorized response URLs').toEqual([]);
  await expect(page.getByText('运行中')).toBeVisible();
  const sourceCard = page.getByRole('button', { name: /spec\.pdf/ });
  await expect(sourceCard).toBeVisible();
  await sourceCard.click();
  await expect(page.locator('#chunk-a-run-web-research-1')).toBeInViewport();
  await expect(page.getByText('来源中的核验内容。')).toBeVisible();
  await expect(page.getByText('已基于公开来源完成调研。')).toBeVisible();
  await expect(page.getByText('证据检索已完成')).toBeVisible();
  await expect(page.getByText('92%')).toBeVisible();
  await page.locator('.recent-thread').first().click();
  await expect(page.getByText('证据检索已完成')).toBeVisible();
  await expect(page.getByRole('button', { name: /spec\.pdf/ })).toBeVisible();
});

test('shows structured provider failure details in live evidence', async ({ page }) => {
  const threadId = 'thread-model-failure';
  const runId = 'run-model-failure';
  const error = {
    code: 'MODEL_RATE_LIMITED',
    message: '模型服务暂时不可用，请稍后重试',
    retryable: true,
    category: 'provider',
    stage: 'model',
    provider: 'answer-provider',
    retry_after_seconds: 12,
    request_id: 'request-123',
  };

  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      json: { access_token: 'model-failure-token', username: 'research-user', role: 'user' },
    });
  });
  await page.route('**/v1/capabilities', async (route) => {
    await route.fulfill({
      json: { schema_version: 1, catalog_hash: 'b'.repeat(64), skills: [], tools: [] },
    });
  });
  await page.route('**/v1/threads', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        json: {
          thread_id: threadId,
          title: '新对话',
          message_count: 0,
          version: 0,
          thread_status: 'active',
          active_run_id: null,
          active_run_status: null,
          created_at: '2026-11-19T00:00:00Z',
          updated_at: '2026-11-19T00:00:00Z',
        },
      });
      return;
    }
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route('**/v1/threads/*/runs', async (route) => {
    await route.fulfill({
      status: 201,
      json: {
        run: {
          id: runId,
          thread_id: threadId,
          status: 'failed',
          idempotency_key: 'model-failure-key',
          user_message_id: 1,
          assistant_message_id: 2,
          on_disconnect: 'continue',
          error,
        },
        created: true,
        thread_version: 1,
      },
    });
  });
  await page.route(`**/v1/runs/${runId}/events*`, async (route) => {
    const event = (sequence: number, type: string, data: Record<string, unknown>) => ({
      schema_version: 1,
      sequence,
      event_id: `${runId}:${sequence}`,
      run_id: runId,
      thread_id: threadId,
      type,
      timestamp: `2026-11-19T00:00:0${sequence}Z`,
      data,
    });
    const events = [
      event(1, 'run.created', { status: 'queued' }),
      event(2, 'run.started', {}),
      event(3, 'warning.created', error),
      event(4, 'run.failed', { error }),
    ];
    const after = Number(new URL(route.request().url()).searchParams.get('after') || 0);
    const pageEvents = events.filter((item) => item.sequence > after);
    await route.fulfill({
      json: { events: pageEvents, next_after: pageEvents.at(-1)?.sequence || after },
    });
  });

  await page.goto('/');
  const input = page.getByPlaceholder(/和喵喵说点什么/);
  await expect(input).toBeVisible();
  await input.fill('测试模型服务错误详情');
  await page.getByRole('button', { name: '发送消息' }).click();

  await expect(page.getByText('MODEL_RATE_LIMITED', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('answer-provider', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('12 秒', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('request-123', { exact: true }).first()).toBeVisible();
});

test('admin can enable web research from the capability control page', async ({ page }) => {
  let enabled = false;
  let updatePayload: Record<string, unknown> | null = null;
  const controlPlane = () => ({
    schema_version: 1,
    web_research: {
      enabled,
      provider: 'tavily-keyless',
      api_key_required: false,
    },
    sql_assistant: {
      enabled: false,
      dsn_secret_name: 'SQL_ASSISTANT_DSN',
      dsn_configured: false,
      expected_role: '',
      allowed_schemas: [],
      allowed_tables: [],
      sensitive_columns: [],
      statement_timeout_seconds: 10,
      max_rows: 200,
      max_result_bytes: 262144,
      max_estimated_cost: 100000,
      max_estimated_rows: 100000,
      max_estimated_bytes: 8388608,
      catalog_cache_ttl_seconds: 300,
      updated_at: '2026-11-19T00:00:00Z',
    },
    skills: [],
    custom_tools: [],
    builtin_tools: [],
  });

  await page.route('**/auth/refresh', async (route) => {
    await route.fulfill({
      json: { access_token: 'admin-token', username: 'admin-user', role: 'admin' },
    });
  });
  await page.route('**/v1/threads', async (route) => {
    await route.fulfill({ json: { threads: [] } });
  });
  await page.route('**/v1/capabilities', async (route) => {
    await route.fulfill({
      json: {
        schema_version: 1,
        catalog_hash: 'b'.repeat(64),
        skills: [
          {
            name: 'web-research',
            version: '1.0.0',
            description: 'Research current public information.',
            activation: '/web-research',
            available: enabled,
            availability_reason: enabled ? null : 'not_configured',
            required_roles: [],
            tool_names: ['web_search', 'web_fetch'],
            approval_tools: [],
            network_policies: ['restricted'],
            resource_scopes: ['public-web'],
          },
        ],
        tools: [],
      },
    });
  });
  await page.route('**/v1/capabilities/control-plane', async (route) => {
    await route.fulfill({ json: controlPlane() });
  });
  await page.route('**/v1/capabilities/web-research', async (route) => {
    updatePayload = route.request().postDataJSON();
    enabled = updatePayload.enabled === true;
    await route.fulfill({ json: controlPlane() });
  });

  await page.goto('/');
  await expect(page.getByText('admin-user')).toBeVisible();
  await page.getByRole('button', { name: 'Skill / Tool' }).click();

  await expect(page.getByRole('heading', { name: 'Tavily Keyless' })).toBeVisible();
  await expect(page.getByText(/不需要 API Key/)).toBeVisible();
  await page.getByRole('button', { name: '启用网络研究' }).click();

  await expect(page.getByText('Tavily Keyless Web Research 已启用')).toBeVisible();
  expect(updatePayload).toEqual({ enabled: true });

  await page.getByRole('button', { name: '智能对话' }).click();
  await expect(page.getByRole('button', { name: /网络研究/ })).toBeEnabled();
});
