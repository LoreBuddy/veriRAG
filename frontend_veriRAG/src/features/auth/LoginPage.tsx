import superMewMark from '@/assets/images/supermew-mark.png';
import { useAuthForm } from './useAuthForm';

export default function LoginPage() {
    const form = useAuthForm();
    const isLogin = form.mode === 'login';

    return (
        <section className="auth-page">
            <div className="auth-showcase">
                <div className="auth-showcase-badge">
                    <i className="fa-solid fa-sparkles" />
                    <span>SuperMew Knowledge Copilot</span>
                </div>
                <h2>
                    让每一份知识
                    <br />
                    都有清晰的回声。
                </h2>
                <p>混合检索、并行 Agent、证据精排与可追溯引用，汇聚在同一个工作台里。</p>
                <div className="auth-feature-list">
                    <div>
                        <i className="fa-solid fa-magnifying-glass-chart" />
                        <span>
                            <strong>Hybrid RAG</strong>
                            <small>Dense + BM25 + Rerank</small>
                        </span>
                    </div>
                    <div>
                        <i className="fa-solid fa-diagram-project" />
                        <span>
                            <strong>并行 Agent</strong>
                            <small>复杂问题自动拆解与合成</small>
                        </span>
                    </div>
                    <div>
                        <i className="fa-regular fa-file-lines" />
                        <span>
                            <strong>可信引用</strong>
                            <small>答案与原始证据一一对齐</small>
                        </span>
                    </div>
                </div>
            </div>
            <div className="auth-panel">
                <div className="auth-panel-heading">
                    <span className="auth-mini-logo">
                        <img src={superMewMark} className="brand-mark-image" alt="" />
                    </span>
                    <div>
                        <span className="auth-eyebrow">{isLogin ? 'Welcome back' : 'Create account'}</span>
                        <h1>{isLogin ? '登录喵喵助手' : '注册喵喵助手'}</h1>
                    </div>
                </div>
                <p className="auth-description">
                    {isLogin
                        ? '进入你的私有知识空间，继续上一次对话。'
                        : '创建账号后即可开始对话和保存历史记录。'}
                </p>
                {form.notice && (
                    <p className="operation-notice" role="status">
                        {form.notice}
                    </p>
                )}
                <form className="auth-form" onSubmit={form.submit}>
                    <label className="form-field">
                        <span>邮箱</span>
                        <span className="field-input">
                            <i className="fa-regular fa-envelope" />
                            <input
                                value={form.email}
                                onChange={(event) => form.setEmail(event.target.value)}
                                type="email"
                                autoComplete="email"
                                placeholder="请输入邮箱"
                            />
                        </span>
                    </label>
                    <label className="form-field">
                        <span>密码</span>
                        <span className="field-input">
                            <i className="fa-solid fa-lock" />
                            <input
                                value={form.password}
                                onChange={(event) => form.setPassword(event.target.value)}
                                type="password"
                                autoComplete={isLogin ? 'current-password' : 'new-password'}
                                placeholder="请输入密码"
                            />
                        </span>
                    </label>
                    <button className="auth-submit" type="submit" disabled={form.loading}>
                        <span>{form.loading ? '正在连接...' : isLogin ? '进入工作台' : '创建账号'}</span>
                        <i className={form.loading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-right'} />
                    </button>
                </form>
                <div className="auth-divider">
                    <span>或者</span>
                </div>
                <button className="auth-switch" type="button" onClick={form.toggleMode}>
                    {isLogin ? '还没有账号？创建一个' : '已有账号？返回登录'}
                </button>
                <p className="auth-footnote">登录即表示你理解 AI 输出需要经过必要的人工复核。</p>
            </div>
        </section>
    );
}
