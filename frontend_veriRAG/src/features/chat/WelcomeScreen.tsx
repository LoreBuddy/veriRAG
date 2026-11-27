import superMewMascot from '@/assets/images/supermew-mascot.webp';
import { useWebResearchStore } from '@/stores/web-research-store';

export default function WelcomeScreen() {
    const { skill, status, reason, error, selected, select } = useWebResearchStore();

    const webResearchTitle =
        status === 'error'
            ? error
            : reason === 'permission_required'
              ? '当前账号权限不足'
              : reason === 'not_configured'
                ? '请管理员在 Skill / Tool 管理中启用'
                : undefined;

    const webResearchHint =
        status === 'loading'
            ? '正在检查可用性…'
            : skill?.available
              ? '查询公开来源'
              : reason === 'permission_required'
                ? '当前账号权限不足'
                : '需管理员启用网络研究';

    return (
        <section className="welcome-screen">
            <img src={superMewMascot} className="welcome-avatar" alt="" />
            <span className="welcome-eyebrow">
                <i className="fa-solid fa-sparkles" /> 喵喵已准备好
            </span>
            <h2>你好，我是喵喵。</h2>
            <p>我会检索知识库、展示处理过程，并把关键结论链接回原始证据。</p>
            <div className="welcome-mode-grid" aria-label="快速选择能力">
                <button
                    type="button"
                    className={selected ? '' : 'active'}
                    aria-pressed={!selected}
                    onClick={() => select(false)}
                >
                    <span>
                        <i className="fa-regular fa-message" />
                    </span>
                    <strong>智能对话</strong>
                    <small>自动选择工具</small>
                </button>
                <button type="button">
                    <span>
                        <i className="fa-solid fa-book-open" />
                    </span>
                    <strong>知识库</strong>
                    <small>检索私有知识</small>
                </button>
                <button
                    type="button"
                    className={selected ? 'active' : ''}
                    aria-pressed={selected}
                    disabled={status === 'loading' || !skill?.available}
                    title={webResearchTitle}
                    onClick={() => select(true)}
                >
                    <span>
                        <i className="fa-solid fa-globe" />
                    </span>
                    <strong>网络研究</strong>
                    <small>{webResearchHint}</small>
                </button>
                <button type="button">
                    <span>
                        <i className="fa-solid fa-database" />
                    </span>
                    <strong>SQL 助手</strong>
                    <small>只读分析数据</small>
                </button>
                <button type="button">
                    <span>
                        <i className="fa-solid fa-terminal" />
                    </span>
                    <strong>代码沙盒</strong>
                    <small>隔离执行代码</small>
                </button>
            </div>
            {status === 'error' && (
                <p className="mode-catalog-error" role="status">
                    {error}
                </p>
            )}
        </section>
    );
}
