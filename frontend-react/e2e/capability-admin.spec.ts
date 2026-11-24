import { expect, test } from '@playwright/test';

test('admin can configure SQL Assistant and enable or disable Skills and Tools', async ({
  page,
}) => {
  let sqlEnabled = false;
  let skillEnabled = true;
  let toolEnabled = true;
  let sqlUpdatePayload: Record<string, unknown> | null = null;
  let skillUpdatePayload: Record<string, unknown> | null = null;
  let toolUpdatePayload: Record<string, unknown> | null = null;
  let skillCreatePayload: Record<string, unknown> | null = null;
  let toolCreatePayload: Record<string, unknown> | null = null;
  const additionalSkills: Record<string, unknown>[] = [];
  const additionalTools: Record<string, unknown>[] = [];

  const controlPlane = () => ({
    schema_version: 1,
    web_research: {
      enabled: false,
      provider: 'tavily-keyless',
      api_key_required: false,
    },
    sql_assistant: {
      enabled: sqlEnabled,
      dsn_secret_name: 'SQL_ASSISTANT_DSN',
      dsn_configured: false,
      expected_role: 'analytics_reader',
      allowed_schemas: ['analytics'],
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
    skills: [
      {
        name: 'custom-research',
        version: '1.0.0',
        description: 'Research a configured topic.',
        instructions: '# Workflow\n\nResearch the requested topic.',
        allowed_tools: ['release_lookup'],
        required_roles: [],
        required_secrets: [],
        enabled: skillEnabled,
        source: 'custom',
        created_at: '2026-11-19T00:00:00Z',
        updated_at: '2026-11-19T00:00:00Z',
      },
      ...additionalSkills,
    ],
    custom_tools: [
      {
        name: 'release_lookup',
        version: '1.0.0',
        description: 'Look up a release.',
        group: 'custom-http',
        endpoint: 'https://api.example.com/releases',
        method: 'POST',
        input_schema: { type: 'object', additionalProperties: false },
        static_headers: {},
        secret_headers: {},
        required_roles: [],
        requires_approval: false,
        idempotent: true,
        timeout_seconds: 20,
        max_response_bytes: 262144,
        enabled: toolEnabled,
        created_at: '2026-11-19T00:00:00Z',
        updated_at: '2026-11-19T00:00:00Z',
      },
      ...additionalTools,
    ],
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
      json: { schema_version: 1, catalog_hash: 'c'.repeat(64), skills: [], tools: [] },
    });
  });
  await page.route('**/v1/capabilities/control-plane', async (route) => {
    await route.fulfill({ json: controlPlane() });
  });
  await page.route('**/v1/capabilities/sql-assistant', async (route) => {
    sqlUpdatePayload = route.request().postDataJSON() as Record<string, unknown>;
    sqlEnabled = sqlUpdatePayload.enabled === true;
    await route.fulfill({ json: controlPlane() });
  });
  await page.route('**/v1/capabilities/skills/custom-research', async (route) => {
    skillUpdatePayload = route.request().postDataJSON() as Record<string, unknown>;
    skillEnabled = skillUpdatePayload.enabled === true;
    await route.fulfill({ json: controlPlane() });
  });
  await page.route('**/v1/capabilities/skills', async (route) => {
    skillCreatePayload = route.request().postDataJSON() as Record<string, unknown>;
    additionalSkills.push({
      ...skillCreatePayload,
      version: '1.0.0',
      source: 'custom',
      created_at: '2026-11-19T00:00:00Z',
      updated_at: '2026-11-19T00:00:00Z',
    });
    await route.fulfill({ json: controlPlane() });
  });
  await page.route('**/v1/capabilities/skills/runbook-helper', async (route) => {
    additionalSkills.splice(
      additionalSkills.findIndex((skill) => skill.name === 'runbook-helper'),
      1
    );
    await route.fulfill({ json: { name: 'runbook-helper', deleted: true } });
  });
  await page.route('**/v1/capabilities/tools/release_lookup', async (route) => {
    toolUpdatePayload = route.request().postDataJSON() as Record<string, unknown>;
    toolEnabled = toolUpdatePayload.enabled === true;
    await route.fulfill({ json: controlPlane() });
  });
  await page.route('**/v1/capabilities/tools', async (route) => {
    toolCreatePayload = route.request().postDataJSON() as Record<string, unknown>;
    additionalTools.push({
      ...toolCreatePayload,
      version: '1.0.0',
      created_at: '2026-11-19T00:00:00Z',
      updated_at: '2026-11-19T00:00:00Z',
    });
    await route.fulfill({ json: controlPlane() });
  });
  await page.route('**/v1/capabilities/tools/runbook_lookup', async (route) => {
    additionalTools.splice(
      additionalTools.findIndex((tool) => tool.name === 'runbook_lookup'),
      1
    );
    await route.fulfill({ json: { name: 'runbook_lookup', deleted: true } });
  });

  await page.goto('/');
  await expect(page.getByText('admin-user')).toBeVisible();
  await page.getByRole('button', { name: 'Skill / Tool' }).click();
  await expect(page.getByRole('heading', { name: 'SQL Assistant 配置' })).toBeVisible();
  const adminPage = page.locator('.capability-admin-page');
  await expect
    .poll(() => adminPage.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await adminPage.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(page.getByRole('heading', { name: '自定义 HTTPS Tools' })).toBeInViewport();

  await page.locator('.capability-sql-form').getByRole('checkbox').check();
  await page.getByRole('button', { name: '保存 SQL 配置' }).click();
  await expect.poll(() => sqlUpdatePayload).not.toBeNull();
  expect(sqlUpdatePayload).toMatchObject({ enabled: true, dsn_secret_name: 'SQL_ASSISTANT_DSN' });

  await page.getByRole('button', { name: '编辑 custom-research' }).click();
  await page.getByRole('checkbox', { name: '启用 Skill' }).uncheck();
  await page.getByRole('button', { name: '保存 Skill' }).click();
  await expect.poll(() => skillUpdatePayload).not.toBeNull();
  expect(skillUpdatePayload).toMatchObject({ enabled: false });

  await page.getByRole('button', { name: '新建 Skill' }).click();
  await page.getByLabel('Skill 名称').fill('runbook-helper');
  await page.getByLabel('描述', { exact: true }).fill('Prepare a runbook.');
  await page.getByRole('button', { name: '保存 Skill' }).click();
  await expect.poll(() => skillCreatePayload).not.toBeNull();
  expect(skillCreatePayload).toMatchObject({ name: 'runbook-helper', enabled: true });

  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '删除 runbook-helper' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'runbook-helper' })).toHaveCount(0);

  await page.getByRole('button', { name: '编辑 release_lookup' }).click();
  await page.getByRole('checkbox', { name: '启用自定义 Tool' }).uncheck();
  await page.getByRole('button', { name: '保存 Tool' }).click();
  await expect.poll(() => toolUpdatePayload).not.toBeNull();
  expect(toolUpdatePayload).toMatchObject({ enabled: false });

  await page.getByRole('button', { name: '新建 Tool' }).click();
  await page.getByLabel('Tool 名称').fill('runbook_lookup');
  await page.getByLabel('描述', { exact: true }).fill('Look up a runbook.');
  await page.getByLabel('固定 HTTPS Endpoint').fill('https://api.example.com/runbooks');
  await page.getByRole('button', { name: '保存 Tool' }).click();
  await expect.poll(() => toolCreatePayload).not.toBeNull();
  expect(toolCreatePayload).toMatchObject({ name: 'runbook_lookup', enabled: true });

  await page.getByRole('button', { name: '删除 runbook_lookup' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'runbook_lookup' })).toHaveCount(0);
});
