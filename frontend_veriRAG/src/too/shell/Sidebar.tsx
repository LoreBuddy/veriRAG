import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import superMewMark from '@/assets/images/supermew-mark.png';
import { logout } from '@/too/auth/logout';
import { useChatStore } from '@/too/chat/chat-store';
import { useAuthStore } from '@/stores/auth-store';
import { useThreadStore } from '@/stores/thread-store';
import { useUiStore } from '@/stores/ui-store';

const ADMIN_NAV = [
    { to: '/knowledge', label: '知识库', icon: 'fa-regular fa-bookmark', ariaLabel: '知识库' },
    { to: '/models', label: '模型中心', icon: 'fa-solid fa-microchip' },
    { to: '/capabilities', label: 'Skill / Tool', icon: 'fa-solid fa-puzzle-piece' },
    { to: '/evaluations', label: 'RAG 评估', icon: 'fa-solid fa-flask-vial' },
] as const;

export default function Sidebar() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const session = useAuthStore((state) => state.session);
    const threads = useThreadStore((state) => state.threads);
    const activeThreadId = useChatStore((state) => state.threadId);
    const { theme, toggleTheme, historyOpen, setHistoryOpen } = useUiStore();
    const [loggingOut, setLoggingOut] = useState(false);

    const handleLogout = async () => {
        setLoggingOut(true);
        try {
            await logout();
        } finally {
            setLoggingOut(false);
        }
    };

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="logo-icon">
                    <img src={superMewMark} className="brand-mark-image" alt="" />
                </div>
                <div className="brand-copy">
                    <h1>喵喵助手</h1>
                    <span>Knowledge Copilot</span>
                </div>
            </div>
            <div className="workspace-switcher">
                <span className="workspace-orb" aria-hidden="true" />
                <span className="workspace-copy">
                    <strong>SuperMew 知识空间</strong>
                    <small>{session ? `${threads.length} 个对话 · 私有` : '登录后连接私有知识'}</small>
                </span>
                <i className="fa-solid fa-chevron-down" aria-hidden="true" />
            </div>
            <nav className="sidebar-nav" aria-label="主导航">
                <button
                    type="button"
                    className={`nav-btn ${pathname.startsWith('/chat') && !historyOpen ? 'active' : ''}`}
                    onClick={() => navigate('/chat')}
                >
                    <i className="fa-regular fa-message" />
                    <span>智能对话</span>
                </button>
                <button
                    type="button"
                    className={`nav-btn ${historyOpen ? 'active' : ''}`}
                    onClick={() => setHistoryOpen(true)}
                >
                    <i className="fa-solid fa-clock-rotate-left" />
                    <span>历史对话</span>
                    {threads.length > 0 && <small className="nav-count">{threads.length}</small>}
                </button>
                {session?.role === 'admin' &&
                    ADMIN_NAV.map((item) => (
                        <button
                            key={item.to}
                            type="button"
                            className={`nav-btn ${pathname.startsWith(item.to) ? 'active' : ''}`}
                            aria-label={'ariaLabel' in item ? item.ariaLabel : undefined}
                            onClick={() => navigate(item.to)}
                        >
                            <i className={item.icon} />
                            <span>{item.label}</span>
                        </button>
                    ))}
            </nav>
            {session && (
                <>
                    <div className="sidebar-section-label">最近对话</div>
                    <div className="sidebar-recents">
                        {threads.slice(0, 8).map((thread) => (
                            <button
                                key={thread.thread_id}
                                type="button"
                                className={`recent-thread ${thread.thread_id === activeThreadId ? 'active' : ''}`}
                                onClick={() => navigate(`/chat/${thread.thread_id}`)}
                            >
                                <span className="recent-dot" aria-hidden="true" />
                                <span className="recent-copy">
                                    <strong>{thread.title || '未命名对话'}</strong>
                                    <small>{thread.message_count} 条消息</small>
                                </span>
                            </button>
                        ))}
                        {!threads.length && (
                            <div className="recent-empty">还没有历史对话，问喵喵一个问题吧。</div>
                        )}
                    </div>
                </>
            )}
            <div className="sidebar-bottom">
                <div className="theme-control">
                    <span className="theme-control-label">
                        <i className={theme === 'light' ? 'fa-regular fa-sun' : 'fa-regular fa-moon'} />
                        <span>{theme === 'light' ? '浅色模式' : '深色模式'}</span>
                    </span>
                    <button
                        type="button"
                        className="theme-toggle"
                        role="switch"
                        aria-checked={theme === 'light'}
                        aria-label={theme === 'light' ? '切换为深色模式' : '切换为浅色模式'}
                        onClick={toggleTheme}
                    >
                        <i className="fa-regular fa-sun theme-toggle-icon theme-toggle-sun" aria-hidden="true" />
                        <i className="fa-regular fa-moon theme-toggle-icon theme-toggle-moon" aria-hidden="true" />
                        <span className="theme-toggle-thumb" aria-hidden="true" />
                    </button>
                </div>
                {session && (
                    <div className="user-panel">
                        <span className="user-avatar">{session.username.slice(0, 2).toUpperCase()}</span>
                        <span className="user-copy">
                            <strong>{session.username}</strong>
                            <small>{session.role === 'admin' ? '管理员' : '普通用户'}</small>
                        </span>
                        <span className="user-actions">
                            <button
                                type="button"
                                title="退出登录"
                                aria-label="退出登录"
                                disabled={loggingOut}
                                onClick={() => void handleLogout()}
                            >
                                <i className="fa-solid fa-arrow-right-from-bracket" />
                            </button>
                        </span>
                    </div>
                )}
            </div>
        </aside>
    );
}
