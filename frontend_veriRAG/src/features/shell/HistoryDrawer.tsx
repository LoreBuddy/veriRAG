import { useNavigate } from 'react-router';
import emptyHistory from '@/assets/images/empty-history.webp';
import { useChatStore } from '@/features/chat/chat-store';
import { useThreadStore } from '@/stores/thread-store';
import { useUiStore } from '@/stores/ui-store';

export default function HistoryDrawer() {
    const navigate = useNavigate();
    const open = useUiStore((state) => state.historyOpen);
    const setOpen = useUiStore((state) => state.setHistoryOpen);
    const threads = useThreadStore((state) => state.threads);
    const reload = useThreadStore((state) => state.load);
    const activeThreadId = useChatStore((state) => state.threadId);

    if (!open) return null;

    const openThread = (threadId: string) => {
        setOpen(false);
        navigate(`/chat/${threadId}`);
    };

    return (
        <div
            className="history-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
            }}
        >
            <aside className="history-sidebar">
                <div className="history-header">
                    <div>
                        <span className="panel-eyebrow">Conversation memory</span>
                        <h2>历史对话</h2>
                    </div>
                    <button
                        type="button"
                        className="close-btn"
                        aria-label="关闭历史对话"
                        onClick={() => setOpen(false)}
                    >
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>
                <div className="history-summary">
                    <span>
                        <strong>{threads.length}</strong> 个对话
                    </span>
                    <button type="button" onClick={() => void reload()}>
                        <i className="fa-solid fa-rotate" />
                        刷新
                    </button>
                </div>
                <div className="history-list">
                    {threads.length === 0 ? (
                        <div className="empty-history">
                            <img
                                src={emptyHistory}
                                className="empty-illustration empty-history-illustration"
                                alt=""
                            />
                            <h3>暂无历史记录</h3>
                            <p>开始一段新对话后，喵喵会在这里替你保存。</p>
                        </div>
                    ) : (
                        threads.map((thread) => (
                            <button
                                key={thread.thread_id}
                                type="button"
                                className={`history-item ${thread.thread_id === activeThreadId ? 'active' : ''}`}
                                onClick={() => openThread(thread.thread_id)}
                            >
                                <strong>{thread.title || '未命名对话'}</strong>
                                <small>{thread.message_count} 条消息</small>
                            </button>
                        ))
                    )}
                </div>
            </aside>
        </div>
    );
}
