import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  buildManagedHttpToolPayload,
  buildManagedSkillPayload,
  buildSqlAssistantPayload,
  type HttpToolFormDraft,
  type SkillFormDraft,
  type SqlAssistantFormDraft,
} from '@/capabilities/capabilityForms';
import {
  createManagedSkill,
  createManagedTool,
  deleteManagedSkill,
  deleteManagedTool,
  getCapabilityControlPlane,
  updateManagedSkill,
  updateManagedTool,
  updateSqlAssistantConfig,
  updateWebResearchConfig,
} from '@/capabilities/capabilityClient';
import type {
  CapabilityControlPlane,
  ManagedHttpTool,
  ManagedSkill,
  SqlAssistantConfig,
} from '@/types/capabilities';
import './capability-admin-page.css';

interface CapabilityAdminPageProps {
  onWebResearchUpdated: () => Promise<void>;
}

const initialSkillDraft = (): SkillFormDraft => ({
  description: '',
  instructions: '# Workflow\n\n描述目标、步骤、边界和输出要求。',
  allowedTools: [],
  requiredRoles: '',
  requiredSecrets: '',
  enabled: true,
});

const initialToolDraft = (): HttpToolFormDraft => ({
  description: '',
  group: 'custom-http',
  endpoint: '',
  method: 'POST',
  inputSchema: JSON.stringify(
    {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    },
    null,
    2
  ),
  staticHeaders: '{}',
  secretHeaders: '{}',
  requiredRoles: '',
  requiresApproval: false,
  idempotent: true,
  timeoutSeconds: 20,
  maxResponseBytes: 262_144,
  enabled: true,
});

const initialSqlDraft = (): SqlAssistantFormDraft => ({
  enabled: false,
  dsnSecretName: 'SQL_ASSISTANT_DSN',
  expectedRole: '',
  allowedSchemas: '',
  allowedTables: '',
  sensitiveColumns: '',
  statementTimeoutSeconds: 10,
  maxRows: 200,
  maxResultBytes: 262_144,
  maxEstimatedCost: 100_000,
  maxEstimatedRows: 100_000,
  maxEstimatedBytes: 8_388_608,
  catalogCacheTtlSeconds: 300,
});

function sqlDraftFromConfig(config: SqlAssistantConfig): SqlAssistantFormDraft {
  return {
    enabled: config.enabled,
    dsnSecretName: config.dsn_secret_name,
    expectedRole: config.expected_role,
    allowedSchemas: config.allowed_schemas.join('\n'),
    allowedTables: config.allowed_tables.join('\n'),
    sensitiveColumns: config.sensitive_columns.join('\n'),
    statementTimeoutSeconds: config.statement_timeout_seconds,
    maxRows: config.max_rows,
    maxResultBytes: config.max_result_bytes,
    maxEstimatedCost: config.max_estimated_cost,
    maxEstimatedRows: config.max_estimated_rows,
    maxEstimatedBytes: config.max_estimated_bytes,
    catalogCacheTtlSeconds: config.catalog_cache_ttl_seconds,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export default function CapabilityAdminPage({ onWebResearchUpdated }: CapabilityAdminPageProps) {
  const [controlPlane, setControlPlane] = useState<CapabilityControlPlane | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sqlDraft, setSqlDraft] = useState<SqlAssistantFormDraft>(initialSqlDraft);
  const [sqlFormError, setSqlFormError] = useState('');
  const [modal, setModal] = useState<'skill' | 'tool' | null>(null);
  const [editingSkill, setEditingSkill] = useState<ManagedSkill | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillDraft, setSkillDraft] = useState<SkillFormDraft>(initialSkillDraft);
  const [skillFormError, setSkillFormError] = useState('');
  const [editingTool, setEditingTool] = useState<ManagedHttpTool | null>(null);
  const [toolName, setToolName] = useState('');
  const [toolDraft, setToolDraft] = useState<HttpToolFormDraft>(initialToolDraft);
  const [toolFormError, setToolFormError] = useState('');

  const loadControlPlane = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError('');
    try {
      const current = await getCapabilityControlPlane();
      setControlPlane(current);
      setSqlDraft(sqlDraftFromConfig(current.sql_assistant));
      return true;
    } catch (reason: unknown) {
      setError(errorMessage(reason, '能力控制面加载失败。'));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadControlPlane();
  }, [loadControlPlane]);

  const selectableTools = useMemo(() => {
    if (!controlPlane) return [];
    return [
      ...controlPlane.builtin_tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        kind: '内建',
        enabled: true,
      })),
      ...controlPlane.custom_tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        kind: '自定义',
        enabled: tool.enabled,
      })),
    ].sort((left, right) => left.name.localeCompare(right.name));
  }, [controlPlane]);

  const enabledSkillCount = controlPlane?.skills.filter((skill) => skill.enabled).length ?? 0;
  const customSkillCount =
    controlPlane?.skills.filter((skill) => skill.source === 'custom').length ?? 0;
  const enabledToolCount = controlPlane?.custom_tools.filter((tool) => tool.enabled).length ?? 0;

  async function mutate(
    operation: () => Promise<CapabilityControlPlane>,
    successNotice: string
  ): Promise<CapabilityControlPlane | null> {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = await operation();
      setControlPlane(updated);
      setNotice(successNotice);
      return updated;
    } catch (reason: unknown) {
      setError(errorMessage(reason, '保存能力配置失败。'));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function toggleWebResearch() {
    if (!controlPlane) return;
    const enabled = !controlPlane.web_research.enabled;
    const updated = await mutate(
      () => updateWebResearchConfig(enabled),
      `Tavily Keyless Web Research 已${enabled ? '启用' : '停用'}`
    );
    if (!updated) return;
    try {
      await onWebResearchUpdated();
    } catch (reason: unknown) {
      setError(errorMessage(reason, '网络研究状态刷新失败。'));
    }
  }

  async function saveSqlAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSqlFormError('');
    try {
      const payload = buildSqlAssistantPayload(sqlDraft);
      const updated = await mutate(
        () => updateSqlAssistantConfig(payload),
        'SQL Assistant 配置已保存'
      );
      if (updated) setSqlDraft(sqlDraftFromConfig(updated.sql_assistant));
    } catch (reason: unknown) {
      setSqlFormError(errorMessage(reason, 'SQL Assistant 配置无效'));
    }
  }

  function openCreateSkill() {
    setEditingSkill(null);
    setSkillName('');
    setSkillDraft(initialSkillDraft());
    setSkillFormError('');
    setModal('skill');
  }

  function openEditSkill(skill: ManagedSkill) {
    setEditingSkill(skill);
    setSkillName(skill.name);
    setSkillDraft({
      description: skill.description,
      instructions: skill.instructions,
      allowedTools: [...skill.allowed_tools],
      requiredRoles: skill.required_roles.join('\n'),
      requiredSecrets: skill.required_secrets.join('\n'),
      enabled: skill.enabled,
    });
    setSkillFormError('');
    setModal('skill');
  }

  function closeModal() {
    if (saving) return;
    setModal(null);
    setEditingSkill(null);
    setEditingTool(null);
    setSkillFormError('');
    setToolFormError('');
  }

  async function saveSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSkillFormError('');
    const name = skillName.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      setSkillFormError('Skill 名称必须使用小写 kebab-case');
      return;
    }
    try {
      const payload = buildManagedSkillPayload(skillDraft);
      const updated = editingSkill
        ? await mutate(() => updateManagedSkill(name, payload), `已更新 Skill「${name}」`)
        : await mutate(() => createManagedSkill({ name, ...payload }), `已创建 Skill「${name}」`);
      if (updated) closeModal();
    } catch (reason: unknown) {
      setSkillFormError(errorMessage(reason, 'Skill 配置无效'));
    }
  }

  async function removeSkill(skill: ManagedSkill) {
    if (!window.confirm(`确定删除自定义 Skill「${skill.name}」吗？`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await deleteManagedSkill(skill.name);
      if (await loadControlPlane()) setNotice(`已删除 Skill「${skill.name}」`);
    } catch (reason: unknown) {
      setError(errorMessage(reason, '删除 Skill 失败。'));
    } finally {
      setSaving(false);
    }
  }

  function openCreateTool() {
    setEditingTool(null);
    setToolName('');
    setToolDraft(initialToolDraft());
    setToolFormError('');
    setModal('tool');
  }

  function openEditTool(tool: ManagedHttpTool) {
    setEditingTool(tool);
    setToolName(tool.name);
    setToolDraft({
      description: tool.description,
      group: tool.group,
      endpoint: tool.endpoint,
      method: tool.method,
      inputSchema: JSON.stringify(tool.input_schema, null, 2),
      staticHeaders: JSON.stringify(tool.static_headers, null, 2),
      secretHeaders: JSON.stringify(tool.secret_headers, null, 2),
      requiredRoles: tool.required_roles.join('\n'),
      requiresApproval: tool.requires_approval,
      idempotent: tool.idempotent,
      timeoutSeconds: tool.timeout_seconds,
      maxResponseBytes: tool.max_response_bytes,
      enabled: tool.enabled,
    });
    setToolFormError('');
    setModal('tool');
  }

  async function saveTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setToolFormError('');
    const name = toolName.trim();
    if (!/^[a-z][a-z0-9_.-]*$/.test(name)) {
      setToolFormError('Tool 名称必须以小写字母开头，并仅包含小写字母、数字、点、下划线或连字符');
      return;
    }
    try {
      const payload = buildManagedHttpToolPayload(toolDraft);
      const updated = editingTool
        ? await mutate(() => updateManagedTool(name, payload), `已更新 Tool「${name}」`)
        : await mutate(() => createManagedTool({ name, ...payload }), `已创建 Tool「${name}」`);
      if (updated) closeModal();
    } catch (reason: unknown) {
      setToolFormError(errorMessage(reason, 'Tool 配置无效'));
    }
  }

  async function removeTool(tool: ManagedHttpTool) {
    if (!window.confirm(`确定删除自定义 Tool「${tool.name}」吗？`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await deleteManagedTool(tool.name);
      if (await loadControlPlane()) setNotice(`已删除 Tool「${tool.name}」`);
    } catch (reason: unknown) {
      setError(errorMessage(reason, '删除 Tool 失败。'));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !controlPlane) {
    return (
      <div className="capability-admin-page" role="status">
        <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
        正在读取能力控制面…
      </div>
    );
  }

  return (
    <div className="capability-admin-page">
      <header className="capability-admin-header">
        <div>
          <span className="panel-eyebrow">Capability control plane</span>
          <h1>Skill 与 Tool 管理</h1>
          <p>配置内建与自定义 Skill、受限 HTTPS Tool，以及 SQL Assistant 和网页检索。</p>
        </div>
        <div className="capability-admin-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={loading}
            onClick={() => void loadControlPlane()}
          >
            <i className={`fa-solid fa-rotate${loading ? ' fa-spin' : ''}`} aria-hidden="true" />
            刷新
          </button>
          <button type="button" className="btn-primary" onClick={openCreateSkill}>
            <i className="fa-solid fa-plus" aria-hidden="true" />
            新建 Skill
          </button>
          <button type="button" className="btn-primary is-lilac" onClick={openCreateTool}>
            <i className="fa-solid fa-plug" aria-hidden="true" />
            新建 Tool
          </button>
        </div>
      </header>

      {error && (
        <div className="operation-notice is-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadControlPlane()}>
            重试
          </button>
        </div>
      )}
      {notice && (
        <div className="operation-notice" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice('')}>
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
      )}

      {controlPlane && (
        <>
          <section className="capability-summary-grid" aria-label="能力控制面摘要">
            <article>
              <span className="summary-icon is-mint">
                <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
              </span>
              <div>
                <small>Skills</small>
                <strong>{controlPlane.skills.length} 个</strong>
                <p>
                  {enabledSkillCount} 个已启用，包含 {customSkillCount} 个自定义 Skill。
                </p>
              </div>
            </article>
            <article>
              <span className="summary-icon is-lilac">
                <i className="fa-solid fa-plug-circle-bolt" aria-hidden="true" />
              </span>
              <div>
                <small>Custom Tools</small>
                <strong>{controlPlane.custom_tools.length} 个</strong>
                <p>{enabledToolCount} 个已启用；仅允许固定公共 HTTPS JSON Endpoint。</p>
              </div>
            </article>
          </section>

          <section className="capability-provider-grid">
            <article className="capability-provider-card">
              <div className="capability-provider-heading">
                <span className="provider-icon">
                  <i className="fa-solid fa-globe" aria-hidden="true" />
                </span>
                <div>
                  <span className="panel-eyebrow">Web research</span>
                  <h2>Tavily Keyless</h2>
                </div>
                <span
                  className={`status-pill${controlPlane.web_research.enabled ? ' is-enabled' : ' is-disabled'}`}
                >
                  {controlPlane.web_research.enabled ? '已启用' : '已停用'}
                </span>
              </div>
              <p>
                使用 <code>X-Tavily-Access-Mode: keyless</code>，不需要 API Key。搜索仍经过 DNS
                Pin、SSRF、超时与响应大小边界。
              </p>
              <button
                type="button"
                className="btn-primary web-research-action"
                aria-pressed={controlPlane.web_research.enabled}
                disabled={saving}
                onClick={() => void toggleWebResearch()}
              >
                {saving && <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />}
                {controlPlane.web_research.enabled ? '停用网络研究' : '启用网络研究'}
              </button>
              <div className="provider-meta">
                <span>
                  <i className="fa-solid fa-key" aria-hidden="true" /> 无 API Key
                </span>
                <span>
                  <i className="fa-solid fa-shield-halved" aria-hidden="true" /> Public HTTPS only
                </span>
              </div>
            </article>
            <article className="capability-provider-card">
              <div className="capability-provider-heading">
                <span className="provider-icon is-lilac">
                  <i className="fa-solid fa-database" aria-hidden="true" />
                </span>
                <div>
                  <span className="panel-eyebrow">Private data</span>
                  <h2>SQL Assistant</h2>
                </div>
                <span
                  className={`status-pill${controlPlane.sql_assistant.enabled ? ' is-enabled' : ' is-disabled'}`}
                >
                  {controlPlane.sql_assistant.enabled ? '已启用' : '已停用'}
                </span>
              </div>
              <p>DSN 本身不会写入数据库或返回前端；这里只保存服务端环境变量名称与只读策略。</p>
              <div className="provider-meta">
                <span>
                  <i className="fa-solid fa-vault" aria-hidden="true" />
                  {controlPlane.sql_assistant.dsn_secret_name}
                </span>
                <span className={controlPlane.sql_assistant.dsn_configured ? '' : 'is-danger'}>
                  <i className="fa-solid fa-circle" aria-hidden="true" />
                  {controlPlane.sql_assistant.dsn_configured ? 'Secret 已配置' : 'Secret 未配置'}
                </span>
              </div>
            </article>
          </section>

          <section className="capability-admin-section">
            <header>
              <span className="panel-eyebrow">SQL policy</span>
              <h2>SQL Assistant 配置</h2>
              <p>配置独立只读凭据引用、Schema/Table 白名单、敏感列和查询预算。</p>
            </header>
            <form
              className="capability-sql-form"
              onSubmit={(event) => void saveSqlAssistant(event)}
            >
              <div className="capability-form-grid">
                <label className="capability-toggle-field capability-wide-field">
                  <input
                    checked={sqlDraft.enabled}
                    onChange={(event) =>
                      setSqlDraft((current) => ({ ...current, enabled: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  <span>
                    <strong>启用 SQL Assistant</strong>
                    <small>启用前必须在 API/Worker 环境中提供下面指定的 Secret。</small>
                  </span>
                </label>
                <label className="capability-form-field">
                  <span>DSN Secret 名称</span>
                  <input
                    value={sqlDraft.dsnSecretName}
                    onChange={(event) =>
                      setSqlDraft((current) => ({ ...current, dsnSecretName: event.target.value }))
                    }
                    maxLength={128}
                    placeholder="SQL_ASSISTANT_DSN"
                    autoComplete="off"
                  />
                  <small>例如 ANALYTICS_READER_DSN；前端永远不接收 DSN 值。</small>
                </label>
                <label className="capability-form-field">
                  <span>预期数据库角色</span>
                  <input
                    value={sqlDraft.expectedRole}
                    onChange={(event) =>
                      setSqlDraft((current) => ({ ...current, expectedRole: event.target.value }))
                    }
                    maxLength={63}
                    placeholder="analytics_reader"
                    autoComplete="off"
                  />
                  <small>用于校验 DSN username 与独立只读角色是否一致。</small>
                </label>
                <label className="capability-form-field">
                  <span>允许的 Schemas</span>
                  <textarea
                    value={sqlDraft.allowedSchemas}
                    onChange={(event) =>
                      setSqlDraft((current) => ({ ...current, allowedSchemas: event.target.value }))
                    }
                    rows={4}
                    placeholder={'analytics\nreporting'}
                  />
                  <small>逗号或换行分隔。</small>
                </label>
                <label className="capability-form-field">
                  <span>允许的 Tables</span>
                  <textarea
                    value={sqlDraft.allowedTables}
                    onChange={(event) =>
                      setSqlDraft((current) => ({ ...current, allowedTables: event.target.value }))
                    }
                    rows={4}
                    placeholder={'analytics.orders\nanalytics.customers'}
                  />
                  <small>使用 schema.table；为空时仍受允许 Schema 限制。</small>
                </label>
                <label className="capability-form-field capability-wide-field">
                  <span>敏感列</span>
                  <textarea
                    value={sqlDraft.sensitiveColumns}
                    onChange={(event) =>
                      setSqlDraft((current) => ({
                        ...current,
                        sensitiveColumns: event.target.value,
                      }))
                    }
                    rows={3}
                    placeholder={'analytics.customers.phone\nanalytics.customers.email'}
                  />
                  <small>这些列会被策略层拒绝读取。</small>
                </label>
              </div>

              <details className="capability-advanced-settings">
                <summary>查询与结果预算</summary>
                <div className="capability-form-grid">
                  {(
                    [
                      ['statementTimeoutSeconds', 'Statement Timeout（秒）', 0.001, 120, 'any'],
                      ['maxRows', '最大返回行数', 1, 10_000, 1],
                      ['maxResultBytes', '最大结果字节', 1024, 16_777_216, 1024],
                      ['maxEstimatedCost', '最大估算 Cost', 0.001, 1_000_000_000, 'any'],
                      ['maxEstimatedRows', '最大估算行数', 1, 1_000_000_000, 1],
                      ['maxEstimatedBytes', '最大估算字节', 1024, 1_073_741_824, 1024],
                      ['catalogCacheTtlSeconds', 'Catalog Cache TTL（秒）', 1, 3600, 1],
                    ] as const
                  ).map(([key, label, min, max, step]) => (
                    <label className="capability-form-field" key={key}>
                      <span>{label}</span>
                      <input
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        value={sqlDraft[key]}
                        onChange={(event) =>
                          setSqlDraft((current) => ({
                            ...current,
                            [key]: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>

              {sqlFormError && <p className="capability-form-error">{sqlFormError}</p>}
              <footer className="capability-form-footer">
                <span>保存后立即应用到当前 Runtime。</span>
                <button type="submit" className="btn-primary" disabled={saving}>
                  <i
                    className={saving ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-floppy-disk'}
                    aria-hidden="true"
                  />
                  保存 SQL 配置
                </button>
              </footer>
            </form>
          </section>

          <section className="capability-admin-section">
            <header className="capability-section-heading">
              <div>
                <span className="panel-eyebrow">Skill registry</span>
                <h2>Skills</h2>
                <p>内建 Skill 可编辑或停用；自定义 Skill 还可以删除。</p>
              </div>
              <button type="button" className="secondary-button" onClick={openCreateSkill}>
                <i className="fa-solid fa-plus" aria-hidden="true" />
                新建自定义 Skill
              </button>
            </header>
            <div className="capability-table-wrap">
              <table className="capability-admin-table">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Allowed Tools</th>
                    <th>访问要求</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {controlPlane.skills.map((skill) => (
                    <tr key={skill.name}>
                      <td>
                        <strong>{skill.name}</strong>
                        <small>
                          {skill.source === 'builtin' ? '内建' : '自定义'} · v{skill.version}
                        </small>
                        <p>{skill.description}</p>
                      </td>
                      <td>
                        {skill.allowed_tools.length ? skill.allowed_tools.join(', ') : '无 Tool'}
                      </td>
                      <td>
                        {skill.required_roles.length > 0 && (
                          <span>Role: {skill.required_roles.join(', ')}</span>
                        )}
                        {skill.required_secrets.length > 0 && (
                          <span>Secret: {skill.required_secrets.join(', ')}</span>
                        )}
                        {!skill.required_roles.length && !skill.required_secrets.length && (
                          <span>无额外要求</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-pill${skill.enabled ? ' is-enabled' : ' is-disabled'}`}
                        >
                          {skill.enabled ? '已启用' : '已停用'}
                        </span>
                      </td>
                      <td>
                        <div className="capability-row-actions">
                          <button
                            type="button"
                            aria-label={`编辑 ${skill.name}`}
                            onClick={() => openEditSkill(skill)}
                          >
                            <i className="fa-regular fa-pen-to-square" aria-hidden="true" />
                          </button>
                          {skill.source === 'custom' && (
                            <button
                              type="button"
                              className="is-danger"
                              aria-label={`删除 ${skill.name}`}
                              disabled={saving}
                              onClick={() => void removeSkill(skill)}
                            >
                              <i className="fa-regular fa-trash-can" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="capability-admin-section">
            <header className="capability-section-heading">
              <div>
                <span className="panel-eyebrow">Declarative integrations</span>
                <h2>自定义 HTTPS Tools</h2>
                <p>支持 GET/POST JSON、JSON Schema、静态 Header 与环境 Secret Header 引用。</p>
              </div>
              <button type="button" className="secondary-button" onClick={openCreateTool}>
                <i className="fa-solid fa-plus" aria-hidden="true" />
                新建自定义 Tool
              </button>
            </header>
            {!controlPlane.custom_tools.length ? (
              <div className="capability-empty-tools">
                <i className="fa-solid fa-plug-circle-plus" aria-hidden="true" />
                <strong>还没有自定义 Tool</strong>
                <p>创建一个固定公共 HTTPS JSON Endpoint，再将它绑定到自定义 Skill。</p>
                <button type="button" className="btn-primary" onClick={openCreateTool}>
                  创建第一个 Tool
                </button>
              </div>
            ) : (
              <div className="capability-table-wrap">
                <table className="capability-admin-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Endpoint</th>
                      <th>策略</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {controlPlane.custom_tools.map((tool) => (
                      <tr key={tool.name}>
                        <td>
                          <strong>{tool.name}</strong>
                          <small>
                            {tool.group} · v{tool.version}
                          </small>
                          <p>{tool.description}</p>
                        </td>
                        <td>
                          <span className="method-chip">{tool.method}</span>
                          <code className="endpoint-code">{tool.endpoint}</code>
                        </td>
                        <td>
                          <span>
                            {tool.timeout_seconds}s · {formatBytes(tool.max_response_bytes)}
                          </span>
                          {tool.requires_approval && <span>需要人工审批</span>}
                          {tool.required_roles.length > 0 && (
                            <span>Role: {tool.required_roles.join(', ')}</span>
                          )}
                          {Object.keys(tool.secret_headers).length > 0 && (
                            <span>{Object.keys(tool.secret_headers).length} 个 Secret Header</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`status-pill${tool.enabled ? ' is-enabled' : ' is-disabled'}`}
                          >
                            {tool.enabled ? '已启用' : '已停用'}
                          </span>
                        </td>
                        <td>
                          <div className="capability-row-actions">
                            <button
                              type="button"
                              aria-label={`编辑 ${tool.name}`}
                              onClick={() => openEditTool(tool)}
                            >
                              <i className="fa-regular fa-pen-to-square" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="is-danger"
                              aria-label={`删除 ${tool.name}`}
                              disabled={saving}
                              onClick={() => void removeTool(tool)}
                            >
                              <i className="fa-regular fa-trash-can" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {modal === 'skill' && (
        <div
          className="capability-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            className="capability-admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-form-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeModal();
            }}
          >
            <header>
              <div>
                <span className="panel-eyebrow">
                  {editingSkill ? 'Edit skill' : 'Create skill'}
                </span>
                <h2 id="skill-form-title">
                  {editingSkill ? `编辑 ${editingSkill.name}` : '新建自定义 Skill'}
                </h2>
                <p>Skill 保存指令与允许使用的 Tool；保存后立即生效。</p>
              </div>
              <button type="button" aria-label="关闭" onClick={closeModal}>
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </header>
            <form onSubmit={(event) => void saveSkill(event)}>
              <div className="capability-form-grid">
                <label className="capability-form-field capability-wide-field">
                  <span>Skill 名称</span>
                  <input
                    value={skillName}
                    onChange={(event) => setSkillName(event.target.value)}
                    maxLength={64}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    placeholder="release-research"
                    disabled={Boolean(editingSkill)}
                    autoComplete="off"
                  />
                  <small>小写 kebab-case；创建后不可改名。</small>
                </label>
                <label className="capability-form-field capability-wide-field">
                  <span>描述</span>
                  <input
                    value={skillDraft.description}
                    onChange={(event) =>
                      setSkillDraft((current) => ({ ...current, description: event.target.value }))
                    }
                    maxLength={500}
                    placeholder="说明这个 Skill 何时使用"
                  />
                </label>
                <label className="capability-form-field capability-wide-field">
                  <span>Skill 指令</span>
                  <textarea
                    value={skillDraft.instructions}
                    onChange={(event) =>
                      setSkillDraft((current) => ({ ...current, instructions: event.target.value }))
                    }
                    rows={10}
                    placeholder={'# Workflow\n描述目标、步骤、边界和输出要求。'}
                  />
                </label>
                <label className="capability-form-field">
                  <span>Required Roles</span>
                  <input
                    value={skillDraft.requiredRoles}
                    onChange={(event) =>
                      setSkillDraft((current) => ({
                        ...current,
                        requiredRoles: event.target.value,
                      }))
                    }
                    placeholder="admin"
                  />
                  <small>逗号或换行分隔。</small>
                </label>
                <label className="capability-form-field">
                  <span>Required Secrets</span>
                  <input
                    value={skillDraft.requiredSecrets}
                    onChange={(event) =>
                      setSkillDraft((current) => ({
                        ...current,
                        requiredSecrets: event.target.value,
                      }))
                    }
                    placeholder="OPTIONAL_SECRET_NAME"
                  />
                  <small>只填写环境变量名称，不填写 Secret 值。</small>
                </label>
              </div>
              <fieldset className="capability-tool-picker">
                <legend>Allowed Tools</legend>
                {selectableTools.map((tool) => (
                  <label key={tool.name}>
                    <input
                      type="checkbox"
                      checked={skillDraft.allowedTools.includes(tool.name)}
                      onChange={(event) =>
                        setSkillDraft((current) => ({
                          ...current,
                          allowedTools: event.target.checked
                            ? [...current.allowedTools, tool.name]
                            : current.allowedTools.filter((name) => name !== tool.name),
                        }))
                      }
                    />
                    <span>
                      <strong>{tool.name}</strong>
                      <small>
                        {tool.kind} · {tool.description}
                      </small>
                    </span>
                    {!tool.enabled && <em>已停用</em>}
                  </label>
                ))}
              </fieldset>
              <label className="capability-toggle-field">
                <input
                  aria-label="启用 Skill"
                  type="checkbox"
                  checked={skillDraft.enabled}
                  onChange={(event) =>
                    setSkillDraft((current) => ({ ...current, enabled: event.target.checked }))
                  }
                />
                <span>
                  <strong>启用 Skill</strong>
                  <small>保存后立即启用或停用。</small>
                </span>
              </label>
              {skillFormError && <p className="capability-form-error">{skillFormError}</p>}
              <footer>
                <button type="button" className="secondary-button" onClick={closeModal}>
                  取消
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  <i
                    className={saving ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-floppy-disk'}
                    aria-hidden="true"
                  />
                  保存 Skill
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {modal === 'tool' && (
        <div
          className="capability-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            className="capability-admin-modal is-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tool-form-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeModal();
            }}
          >
            <header>
              <div>
                <span className="panel-eyebrow">{editingTool ? 'Edit tool' : 'Create tool'}</span>
                <h2 id="tool-form-title">
                  {editingTool ? `编辑 ${editingTool.name}` : '新建自定义 HTTPS Tool'}
                </h2>
                <p>
                  只支持声明式公共 HTTPS JSON 调用，不执行上传的 Python、Shell 或任意服务端代码。
                </p>
              </div>
              <button type="button" aria-label="关闭" onClick={closeModal}>
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </header>
            <form onSubmit={(event) => void saveTool(event)}>
              <div className="capability-form-grid">
                <label className="capability-form-field">
                  <span>Tool 名称</span>
                  <input
                    value={toolName}
                    onChange={(event) => setToolName(event.target.value)}
                    maxLength={128}
                    pattern="[a-z][a-z0-9_.-]*"
                    placeholder="release_lookup"
                    disabled={Boolean(editingTool)}
                    autoComplete="off"
                  />
                  <small>创建后不可改名，且不能覆盖内建 Tool。</small>
                </label>
                <label className="capability-form-field">
                  <span>分组</span>
                  <input
                    value={toolDraft.group}
                    onChange={(event) =>
                      setToolDraft((current) => ({ ...current, group: event.target.value }))
                    }
                    maxLength={128}
                    placeholder="custom-http"
                  />
                </label>
                <label className="capability-form-field capability-wide-field">
                  <span>描述</span>
                  <input
                    value={toolDraft.description}
                    onChange={(event) =>
                      setToolDraft((current) => ({ ...current, description: event.target.value }))
                    }
                    maxLength={1000}
                    placeholder="说明 Tool 的用途和返回内容"
                  />
                </label>
                <label className="capability-form-field capability-wide-field">
                  <span>固定 HTTPS Endpoint</span>
                  <input
                    type="url"
                    value={toolDraft.endpoint}
                    onChange={(event) =>
                      setToolDraft((current) => ({ ...current, endpoint: event.target.value }))
                    }
                    maxLength={2048}
                    placeholder="https://api.example-service.com/v1/search"
                  />
                  <small>必须是公共 FQDN 或全局 IP；禁止凭据、Fragment、私网与特殊用途地址。</small>
                </label>
                <label className="capability-form-field">
                  <span>Method</span>
                  <select
                    value={toolDraft.method}
                    onChange={(event) =>
                      setToolDraft((current) => ({
                        ...current,
                        method: event.target.value as 'GET' | 'POST',
                      }))
                    }
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </label>
                <label className="capability-form-field capability-wide-field">
                  <span>Input JSON Schema</span>
                  <textarea
                    value={toolDraft.inputSchema}
                    onChange={(event) =>
                      setToolDraft((current) => ({ ...current, inputSchema: event.target.value }))
                    }
                    rows={10}
                    spellCheck={false}
                  />
                </label>
                <label className="capability-form-field">
                  <span>静态 Headers（JSON）</span>
                  <textarea
                    value={toolDraft.staticHeaders}
                    onChange={(event) =>
                      setToolDraft((current) => ({ ...current, staticHeaders: event.target.value }))
                    }
                    rows={5}
                    spellCheck={false}
                    placeholder='{"X-Client":"SuperMew"}'
                  />
                  <small>Authorization、X-API-Key 等敏感 Header 必须使用右侧 Secret 引用。</small>
                </label>
                <label className="capability-form-field">
                  <span>Secret Headers（JSON）</span>
                  <textarea
                    value={toolDraft.secretHeaders}
                    onChange={(event) =>
                      setToolDraft((current) => ({ ...current, secretHeaders: event.target.value }))
                    }
                    rows={5}
                    spellCheck={false}
                    placeholder='{"Authorization":"RELEASE_API_TOKEN"}'
                  />
                  <small>值是环境变量名称，真实 Secret 不进入控制面。</small>
                </label>
                <label className="capability-form-field">
                  <span>Required Roles</span>
                  <input
                    value={toolDraft.requiredRoles}
                    onChange={(event) =>
                      setToolDraft((current) => ({ ...current, requiredRoles: event.target.value }))
                    }
                    placeholder="admin"
                  />
                </label>
                <label className="capability-form-field">
                  <span>Timeout（秒）</span>
                  <input
                    type="number"
                    min={0.001}
                    max={120}
                    step="any"
                    value={toolDraft.timeoutSeconds}
                    onChange={(event) =>
                      setToolDraft((current) => ({
                        ...current,
                        timeoutSeconds: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="capability-form-field">
                  <span>最大响应字节</span>
                  <input
                    type="number"
                    min={1024}
                    max={8_388_608}
                    step={1024}
                    value={toolDraft.maxResponseBytes}
                    onChange={(event) =>
                      setToolDraft((current) => ({
                        ...current,
                        maxResponseBytes: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <div className="capability-toggle-grid">
                <label className="capability-toggle-field">
                  <input
                    aria-label="启用自定义 Tool"
                    type="checkbox"
                    checked={toolDraft.enabled}
                    onChange={(event) =>
                      setToolDraft((current) => ({ ...current, enabled: event.target.checked }))
                    }
                  />
                  <span>
                    <strong>启用</strong>
                    <small>保存后立即可用。</small>
                  </span>
                </label>
                <label className="capability-toggle-field">
                  <input
                    type="checkbox"
                    checked={toolDraft.idempotent}
                    onChange={(event) =>
                      setToolDraft((current) => ({ ...current, idempotent: event.target.checked }))
                    }
                  />
                  <span>
                    <strong>幂等</strong>
                    <small>声明重复调用不会产生额外副作用。</small>
                  </span>
                </label>
                <label className="capability-toggle-field">
                  <input
                    type="checkbox"
                    checked={toolDraft.requiresApproval}
                    onChange={(event) =>
                      setToolDraft((current) => ({
                        ...current,
                        requiresApproval: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    <strong>需要审批</strong>
                    <small>每个 Run 必须显式授权后才能调用。</small>
                  </span>
                </label>
              </div>
              {toolFormError && <p className="capability-form-error">{toolFormError}</p>}
              <footer>
                <button type="button" className="secondary-button" onClick={closeModal}>
                  取消
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  <i
                    className={saving ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-floppy-disk'}
                    aria-hidden="true"
                  />
                  保存 Tool
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
