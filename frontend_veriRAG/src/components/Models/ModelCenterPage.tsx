import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  assignModelRole,
  createModelProfile,
  getModelControlPlane,
} from '@/models/modelClient';
import type {
  ModelControlPlane,
  ModelProfilePayload,
  ModelRole,
} from '@/types/models';
import { getPublicError } from '@/utils/api';
import './model-center-page.css';

const ROLES: Array<{ key: ModelRole; label: string; description: string }> = [
  { key: 'answer', label: 'Answer', description: '生成面向用户的流式回答。' },
  { key: 'fast', label: 'Fast', description: '负责快速分类与结构化分析。' },
  { key: 'grader', label: 'Grader', description: '评估检索证据与回答条件。' },
  { key: 'evaluator', label: 'Evaluator', description: '运行离线 RAG 评估。' },
];

const EMPTY_PROFILE: ModelProfilePayload = {
  display_name: '',
  provider: 'openai',
  model_name: '',
  base_url: '',
  timeout_seconds: 30,
  supports_stream: true,
  supports_structured_output: true,
  enabled: true,
};

function compatibleProfiles(controlPlane: ModelControlPlane, role: ModelRole) {
  const requirement = controlPlane.requirements[role];
  return controlPlane.profiles.filter(
    (profile) =>
      profile.enabled &&
      (!requirement.supports_stream || profile.supports_stream) &&
      (!requirement.supports_structured_output || profile.supports_structured_output)
  );
}

export default function ModelCenterPage() {
  const [controlPlane, setControlPlane] = useState<ModelControlPlane | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [profileForm, setProfileForm] = useState<ModelProfilePayload>(EMPTY_PROFILE);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setControlPlane(await getModelControlPlane());
    } catch (reason: unknown) {
      setError(getPublicError(reason).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const assignedCount = useMemo(
    () =>
      ROLES.filter((role) => Boolean(controlPlane?.assignments[role.key])).length,
    [controlPlane]
  );

  const handleAssignment = async (role: ModelRole, profileId: string) => {
    if (!profileId || !controlPlane || profileId === controlPlane.assignments[role]?.id) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      setControlPlane(await assignModelRole(role, { profile_id: profileId }));
      setNotice(`已更新 ${role} 模型；新 Assignment 仅影响后续 Run`);
    } catch (reason: unknown) {
      setError(getPublicError(reason).message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      setControlPlane(
        await createModelProfile({
          ...profileForm,
          display_name: profileForm.display_name.trim(),
          model_name: profileForm.model_name.trim(),
          base_url: profileForm.base_url.trim(),
          timeout_seconds: Number(profileForm.timeout_seconds),
        })
      );
      setFormOpen(false);
      setProfileForm(EMPTY_PROFILE);
      setNotice(`已创建 Model Profile「${profileForm.display_name.trim()}」`);
    } catch (reason: unknown) {
      setError(getPublicError(reason).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="model-center-page">
      <header className="model-center-header">
        <div>
          <span className="panel-eyebrow">Model control plane</span>
          <h1>模型中心</h1>
          <p>管理模型配置，并为新 Run 分配 Answer、Fast、Grader 与 Evaluator。</p>
        </div>
        <div className="model-center-actions">
          <button type="button" className="model-secondary-button" onClick={() => void refresh()}>
            <i className="fa-solid fa-rotate" aria-hidden="true" /> 刷新目录
          </button>
          <button
            type="button"
            className="model-primary-button"
            onClick={() => {
              setProfileForm(EMPTY_PROFILE);
              setError('');
              setFormOpen(true);
            }}
          >
            <i className="fa-solid fa-plus" aria-hidden="true" /> 新建 Model Profile
          </button>
        </div>
      </header>

      {error && (
        <div className="model-center-alert is-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      )}
      {notice && (
        <div className="model-center-alert is-success" role="status">
          {notice}
        </div>
      )}

      {loading && !controlPlane ? (
        <div className="model-center-empty" role="status">
          正在同步模型目录…
        </div>
      ) : controlPlane ? (
        <>
          <section className="model-center-summary" aria-label="模型控制面状态">
            <article>
              <small>API Key</small>
              <strong>{controlPlane.api_key_configured ? '服务端已配置' : '服务端未配置'}</strong>
              <p>仅从服务端环境读取，前端不可录入或查看。</p>
            </article>
            <article>
              <small>Model Profiles</small>
              <strong>{controlPlane.profiles.length} 个</strong>
              <p>{controlPlane.profiles.filter((profile) => profile.enabled).length} 个已启用</p>
            </article>
            <article>
              <small>Assignments</small>
              <strong>
                {assignedCount} / {ROLES.length}
              </strong>
              <p>新分配仅影响后续 Run。</p>
            </article>
            <article>
              <small>Catalog Hash</small>
              <strong>{controlPlane.catalog_hash.slice(0, 12)}</strong>
              <p>Run 创建时冻结模型快照。</p>
            </article>
          </section>

          <section className="model-center-section">
            <div className="model-center-section-heading">
              <div>
                <h2>模型角色</h2>
                <p>选择兼容的 Model Profile；正在运行的 Run 保持原模型快照。</p>
              </div>
              <span>新 Run 生效</span>
            </div>
            <div className="model-role-grid">
              {ROLES.map((role) => {
                const assignment = controlPlane.assignments[role.key];
                const profiles = compatibleProfiles(controlPlane, role.key);
                const requirement = controlPlane.requirements[role.key];
                return (
                  <article className="model-role-card" key={role.key}>
                    <div className="model-role-card-heading">
                      <div>
                        <h3>{role.label}</h3>
                        <p>{role.description}</p>
                      </div>
                      <span className={assignment ? 'is-ready' : 'is-missing'}>
                        {assignment ? '已分配' : '待配置'}
                      </span>
                    </div>
                    <label className="model-assignment-select">
                      <span>当前 Model Profile</span>
                      <select
                        aria-label={`${role.label} 模型`}
                        value={assignment?.id || ''}
                        disabled={saving || profiles.length === 0}
                        onChange={(event) =>
                          void handleAssignment(role.key, event.currentTarget.value)
                        }
                      >
                        <option value="" disabled>
                          {profiles.length ? '选择兼容的 Model Profile' : '没有兼容的 Profile'}
                        </option>
                        {profiles.map((profile) => (
                          <option value={profile.id} key={profile.id}>
                            {profile.display_name} · {profile.model_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <small className="model-role-requirements">
                      {requirement.supports_stream ? '需要 Stream · ' : ''}
                      {requirement.supports_structured_output ? '需要 Structured Output · ' : ''}
                      Temperature {requirement.temperature}
                    </small>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="model-center-section">
            <div className="model-center-section-heading">
              <div>
                <h2>Model Profile 目录</h2>
                <p>API Key 保留在服务端环境，不会保存到 Profile 或发送到浏览器。</p>
              </div>
            </div>
            {controlPlane.profiles.length ? (
              <div className="model-profile-list">
                {controlPlane.profiles.map((profile) => {
                  const roles = ROLES.filter(
                    (role) => controlPlane.assignments[role.key]?.id === profile.id
                  );
                  return (
                    <article className="model-profile-row" key={profile.id}>
                      <div>
                        <strong>{profile.display_name}</strong>
                        <span>
                          {profile.model_name} · {profile.base_url || '默认 Provider Endpoint'}
                        </span>
                      </div>
                      <div className="model-profile-tags">
                        {profile.supports_stream && <span>Stream</span>}
                        {profile.supports_structured_output && <span>Structured Output</span>}
                        <span>{profile.enabled ? '已启用' : '已停用'}</span>
                      </div>
                      <div className="model-profile-roles">
                        {roles.length ? roles.map((role) => role.label).join(' · ') : '未分配'}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="model-center-empty">还没有 Model Profile。</div>
            )}
          </section>
        </>
      ) : null}

      {formOpen && (
        <div
          className="model-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setFormOpen(false);
          }}
        >
          <section
            className="model-profile-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-model-profile-title"
          >
            <header>
              <div>
                <span className="panel-eyebrow">Create profile</span>
                <h2 id="create-model-profile-title">新建 Model Profile</h2>
                <p>只保存无 Secret 的模型连接配置。</p>
              </div>
              <button
                type="button"
                aria-label="关闭 Model Profile 表单"
                disabled={saving}
                onClick={() => setFormOpen(false)}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </header>
            <form onSubmit={(event) => void handleCreateProfile(event)}>
              <label>
                <span>显示名称</span>
                <input
                  autoFocus
                  aria-label="显示名称"
                  required
                  maxLength={120}
                  value={profileForm.display_name}
                  onChange={(event) =>
                    setProfileForm({ ...profileForm, display_name: event.currentTarget.value })
                  }
                  placeholder="例如：生产回答模型"
                />
              </label>
              <label>
                <span>Provider</span>
                <select value="openai" disabled aria-label="Provider">
                  <option value="openai">OpenAI-compatible</option>
                </select>
              </label>
              <label>
                <span>模型标识</span>
                <input
                  aria-label="模型标识"
                  required
                  maxLength={160}
                  value={profileForm.model_name}
                  onChange={(event) =>
                    setProfileForm({ ...profileForm, model_name: event.currentTarget.value })
                  }
                  placeholder="例如：doubao-seed-1-6"
                />
              </label>
              <label>
                <span>Base URL</span>
                <input
                  aria-label="Base URL"
                  type="url"
                  maxLength={512}
                  value={profileForm.base_url}
                  onChange={(event) =>
                    setProfileForm({ ...profileForm, base_url: event.currentTarget.value })
                  }
                  placeholder="留空使用服务端默认 Endpoint"
                />
              </label>
              <label>
                <span>超时（秒）</span>
                <input
                  aria-label="超时（秒）"
                  type="number"
                  min={1}
                  max={600}
                  step={1}
                  required
                  value={profileForm.timeout_seconds}
                  onChange={(event) =>
                    setProfileForm({
                      ...profileForm,
                      timeout_seconds: Number(event.currentTarget.value),
                    })
                  }
                />
              </label>
              <div className="model-profile-capabilities">
                <label>
                  <input
                    type="checkbox"
                    checked={profileForm.supports_stream}
                    onChange={(event) =>
                      setProfileForm({
                        ...profileForm,
                        supports_stream: event.currentTarget.checked,
                      })
                    }
                  />
                  支持 Stream
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={profileForm.supports_structured_output}
                    onChange={(event) =>
                      setProfileForm({
                        ...profileForm,
                        supports_structured_output: event.currentTarget.checked,
                      })
                    }
                  />
                  支持 Structured Output
                </label>
              </div>
              {error && <p className="model-form-error" role="alert">{error}</p>}
              <footer>
                <button
                  type="button"
                  className="model-secondary-button"
                  disabled={saving}
                  onClick={() => setFormOpen(false)}
                >
                  取消
                </button>
                <button type="submit" className="model-primary-button" disabled={saving}>
                  {saving ? '正在创建…' : '创建 Profile'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
