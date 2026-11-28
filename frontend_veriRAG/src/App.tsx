import { FormEvent, KeyboardEvent, lazy, Suspense, useEffect, useRef, useState } from 'react';
import api, { getPublicError } from '@/utils/api';
import { getSupabaseClient } from '@/auth/supabase';
import {
    clearAuthSession,
    getAuthSession,
    installAuthSession,
    restoreAuthSession,
    revokeRefreshSession,
    subscribeAuthSession,
    type AuthSession,
} from '@/auth/session';
import { createThread, getThreadMessages, listThreads } from '@/threads/threadClient';
import { createRun, getRun, getRunEvents } from '@/runs/runClient';
import { applyRunEvent, initialRunEventState, type RunEventState } from '@/events/runEventReducer';
import { getCapabilityCatalog } from '@/capabilities/capabilityClient';
import { createWebResearchMessage } from '@/capabilities/webResearchMessage';
import { createSkillMessage } from '@/capabilities/skillMessage';
import type {
    CapabilityAvailabilityReason,
    CapabilitySkill,
} from '@/types/capabilities';
import type { ThreadMessage, ThreadSummary } from '@/types/threads';
import type { EvidenceMessage } from '@/components/Chat/LiveEvidencePanel';
import LiveEvidencePanel from '@/components/Chat/LiveEvidencePanel';
import superMewMark from '@/assets/images/supermew-mark.png';
import superMewMascot from '@/assets/images/supermew-mascot.webp';
import emptyHistory from '@/assets/images/empty-history.webp';

const CapabilityAdminPage = lazy(() => import('@/components/Capabilities/CapabilityAdminPage'));
const KnowledgeBasePage = lazy(() => import('@/components/Documents/KnowledgeBasePage'));

type Theme = 'dark' | 'light';
type Nav = 'chat' | 'history' | 'settings' | 'models' | 'capabilities' | 'evaluations';

type Message = EvidenceMessage;

async function replayRunEvents(
    initialState: RunEventState,
    token: string
): Promise<RunEventState> {
    let current = initialState;
    while (true) {
        const response = await getRunEvents(current.runId, token, {
            after: current.lastSequence,
            limit: 1000,
        });
        if (!response.events.length) return current;
        for (const event of response.events) {
            const previousSequence = current.lastSequence;
            current = applyRunEvent(current, event);
            if (event.sequence > previousSequence && current.lastSequence === previousSequence) {
                throw getPublicError({
                    code: 'STREAM_PROTOCOL_ERROR',
                    retryable: true,
                    category: 'stream',
                });
            }
        }
        if (response.events.length < 1000) return current;
    }
}

function toMessage(message: ThreadMessage): Message | null {
    if (message.role === 'system') return null;
    return {
        id: `m-${message.id}`,
        runId: message.run_id || undefined,
        isUser: message.role === 'user',
        text: message.content,
        status: message.status,
        ragTrace: message.rag_trace,
    };
}

export default function App() {
    const [theme, setTheme] = useState<Theme>(localStorage.getItem('supermew-theme') === 'light' ? 'light' : 'dark');
    const [session, setSession] = useState<AuthSession | null>(getAuthSession());
    const [authResolved, setAuthResolved] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authLoading, setAuthLoading] = useState(false);
    const [authNotice, setAuthNotice] = useState('');
    const [nav, setNav] = useState<Nav>('chat');
    const [threads, setThreads] = useState<ThreadSummary[]>([]);
    const [threadId, setThreadId] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [runState, setRunState] = useState<RunEventState | null>(null);
    const [eventError, setEventError] = useState('');
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [sendingThreadId, setSendingThreadId] = useState('');
    const [historyOpen, setHistoryOpen] = useState(false);
    const [selectedMode, setSelectedMode] = useState<'web-research' | 'knowledge-base' | null>(null);
    const [webResearchSkill, setWebResearchSkill] = useState<CapabilitySkill | null>(null);
    const [knowledgeBaseSkill, setKnowledgeBaseSkill] = useState<CapabilitySkill | null>(null);
    const [webResearchStatus, setWebResearchStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [webResearchAvailabilityReason, setWebResearchAvailabilityReason] =useState<CapabilityAvailabilityReason>(null);
    const [webResearchError, setWebResearchError] = useState('');
    const threadLoadGeneration = useRef(0);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        localStorage.setItem('supermew-theme', theme);
    }, [theme]);

    useEffect(() => {
        if (window.location.hash.includes('access_token=')) {
            window.history.replaceState(
                window.history.state,
                '',
                `${window.location.pathname}${window.location.search}`
            );
        }
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeAuthSession(setSession);
        void restoreAuthSession()
            .catch(() => clearAuthSession())
            .finally(() => setAuthResolved(true));
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (session)
            void listThreads()
                .then(setThreads)
                .catch(() => undefined);
    }, [session?.username]);

    useEffect(() => {
        let current = true;
        setSelectedMode(null);
        setWebResearchSkill(null);
        setKnowledgeBaseSkill(null);
        setWebResearchAvailabilityReason(null);
        setWebResearchError('');

        if (!session) {
            setWebResearchStatus('idle');
            return () => {
                current = false;
            };
        }

        setWebResearchStatus('loading');
        void getCapabilityCatalog()
            .then((catalog) => {
                if (!current) return;
                const webSkill = catalog.skills.find((item) => item.name === 'web-research') || null;
                const knowledgeSkill =
                    catalog.skills.find((item) => item.name === 'knowledge-base') || null;
                setWebResearchSkill(webSkill);
                setKnowledgeBaseSkill(knowledgeSkill);
                setWebResearchAvailabilityReason(webSkill?.availability_reason ?? 'not_configured');
                setWebResearchStatus('ready');
            })
            .catch((error: unknown) => {
                if (!current) return;
                setWebResearchError(
                    error instanceof Error ? error.message : '网络研究能力目录加载失败。'
                );
                setWebResearchStatus('error');
            });

        return () => {
            current = false;
        };
    }, [session?.username]);

    useEffect(() => {
        const container = document.querySelector('.chat-container');
        if (container) container.scrollTop = container.scrollHeight;
    }, [messages]);

    useEffect(() => {
        const handleUnauthorized = () => clearAuthSession();
        window.addEventListener('unauthorized', handleUnauthorized);
        return () => window.removeEventListener('unauthorized', handleUnauthorized);
    }, []);

    const handleAuth = async (event: FormEvent) => {
        event.preventDefault();
        if (!email.trim() || !password) return;
        setAuthLoading(true);
        setAuthNotice('');
        try {
            const supabase = getSupabaseClient();
            const result =
                authMode === 'login'
                    ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
                    : await supabase.auth.signUp({
                        email: email.trim(),
                        password,
                        options: { emailRedirectTo: window.location.origin },
                    });
            if (result.error) throw result.error;
            if (!result.data.session) {
                setPassword('');
                setAuthNotice('注册成功，请检查邮箱并完成验证，然后登录。');
                return;
            }
            const response = await api.post<AuthSession>('/auth/supabase/exchange', {
                access_token: result.data.session.access_token,
            });
            const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
            if (signOutError) throw signOutError;
            installAuthSession(response.data);
            setPassword('');
        } catch (error: unknown) {
            setAuthNotice(error instanceof Error ? error.message : '认证失败，请检查邮箱和密码');
        } finally {
            setAuthLoading(false);
        }
    };

    const logout = async () => {
        setAuthLoading(true);
        threadLoadGeneration.current += 1;
        await revokeRefreshSession().catch(() => undefined);
        clearAuthSession();
        setThreads([]);
        setMessages([]);
        setThreadId('');
        setRunState(null);
        setEventError('');
        setSendingThreadId('');
        setAuthLoading(false);
    };

    const refreshWebResearchCapability = async () => {
        const username = getAuthSession()?.username;
        if (!username) return;
        setWebResearchStatus('loading');
        setWebResearchError('');

        try {
            const catalog = await getCapabilityCatalog();
            if (getAuthSession()?.username !== username) return;
            const webSkill = catalog.skills.find((item) => item.name === 'web-research') || null;
            const knowledgeSkill =
                catalog.skills.find((item) => item.name === 'knowledge-base') || null;
            setWebResearchSkill(webSkill);
            setKnowledgeBaseSkill(knowledgeSkill);
            setWebResearchAvailabilityReason(webSkill?.availability_reason ?? 'not_configured');
            setWebResearchStatus('ready');
            if (!webSkill?.available && selectedMode === 'web-research') setSelectedMode(null);
            if (!knowledgeSkill?.available && selectedMode === 'knowledge-base') setSelectedMode(null);
        } catch (error: unknown) {
            if (getAuthSession()?.username === username) {
                const message = error instanceof Error ? error.message : '网络研究配置更新失败。';
                setWebResearchError(message);
                setWebResearchStatus('error');
            }
            throw error;
        }
    };

    const openThread = async (targetThreadId: string) => {
        const currentSession = getAuthSession();
        if (!currentSession) return;
        const generation = ++threadLoadGeneration.current;
        setThreadId(targetThreadId);
        setMessages([]);
        setRunState(null);
        setEventError('');
        setSelectedMode(null);
        setHistoryOpen(false);
        setNav('chat');

        try {
            const page = await getThreadMessages(targetThreadId, { limit: 200 });
            if (
                generation !== threadLoadGeneration.current ||
                getAuthSession()?.username !== currentSession.username
            ) {
                return;
            }
            const orderedMessages = [...page.messages].sort(
                (left, right) => left.sequence - right.sequence
            );
            setMessages(
                orderedMessages
                    .map(toMessage)
                    .filter((message): message is Message => message !== null)
            );
            const latestAssistant = [...orderedMessages]
                .reverse()
                .find((message) => message.role === 'assistant' && message.run_id);
            if (!latestAssistant?.run_id) return;

            let projection = initialRunEventState(latestAssistant.run_id, targetThreadId);
            setRunState(projection);
            try {
                projection = await replayRunEvents(projection, currentSession.access_token);
                if (
                    generation !== threadLoadGeneration.current ||
                    getAuthSession()?.username !== currentSession.username
                ) {
                    return;
                }
                setRunState(projection);
                setMessages((current) =>
                    generation === threadLoadGeneration.current
                        ? current.map((message) =>
                            message.runId === projection.runId && !message.isUser
                                ? {
                                    ...message,
                                    runTimeline: projection.timeline,
                                    runActiveDurationMs: projection.activeDurationMs,
                                    runActiveStartedAt: projection.activeStartedAt,
                                }
                                : message
                        )
                        : current
                );
            } catch (error: unknown) {
                if (generation === threadLoadGeneration.current) {
                    setEventError(
                        error instanceof Error ? error.message : '运行轨迹加载失败，请稍后重试。'
                    );
                }
            }
        } catch (error: unknown) {
            if (generation === threadLoadGeneration.current) {
                setEventError(
                    error instanceof Error ? error.message : '历史对话加载失败，请稍后重试。'
                );
            }
        }
    };

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || !session || sending) return;
        let generation = threadLoadGeneration.current;
        const isCurrentThread = () =>
            generation === threadLoadGeneration.current &&
            getAuthSession()?.username === session.username;
        const pendingAssistantId = `a-pending-${Date.now()}`;
        let assistantMessageId = pendingAssistantId;
        let projection: RunEventState | null = null;
        let completedMessage: ThreadMessage | null = null;
        const executionMessage =
            selectedMode === 'web-research' && webResearchSkill
                ? createWebResearchMessage(text, webResearchSkill.activation)
                : selectedMode === 'knowledge-base'
                    ? createSkillMessage(text, knowledgeBaseSkill)
                    : text;
        setSending(true);
        setSendingThreadId(threadId);
        setInput('');
        setRunState(null);
        setEventError('');
        setMessages((current) =>
            isCurrentThread()
                ? [
                    ...current,
                    { id: `u-${Date.now()}`, isUser: true, text },
                    {
                        id: pendingAssistantId,
                        isUser: false,
                        text: '',
                        status: 'queued',
                        isThinking: true,
                    },
                ]
                : current
        );
        try {
            let targetThreadId = threadId;
            if (!targetThreadId) {
                const thread = await createThread();
                if (!isCurrentThread()) return;
                targetThreadId = thread.thread_id;
                generation = ++threadLoadGeneration.current;
                setThreadId(targetThreadId);
                setSendingThreadId(targetThreadId);
                setThreads((current) => [
                    {
                        thread_id: thread.thread_id,
                        title: thread.title || '新对话',
                        message_count: thread.message_count,
                        updated_at: thread.updated_at,
                        version: thread.version,
                        thread_status: thread.thread_status,
                        active_run_id: thread.active_run_id,
                        active_run_status: thread.active_run_status,
                    },
                    ...current,
                ]);
            }
            if (!isCurrentThread()) return;
            const created = await createRun(
                targetThreadId,
                {
                    message: executionMessage,
                    idempotency_key: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
                },
                session.access_token
            );
            if (!isCurrentThread()) return;
            let run = created.run;
            assistantMessageId = `a-${run.id}`;
            projection = initialRunEventState(run.id, targetThreadId);
            setRunState(projection);
            setMessages((current) =>
                isCurrentThread()
                    ? current.map((message) =>
                        message.id === pendingAssistantId
                            ? {
                                ...message,
                                id: assistantMessageId,
                                runId: run.id,
                                status: run.status,
                            }
                            : message
                    )
                    : current
            );

            const refreshEventProjection = async (runStatus: string) => {
                if (!projection) return;
                const currentProjection = projection;
                try {
                    const nextProjection = await replayRunEvents(
                        currentProjection,
                        session.access_token
                    );
                    projection = nextProjection;
                    if (!isCurrentThread()) return;
                    setRunState(nextProjection);
                    setEventError('');
                    const displayStatus =
                        nextProjection.status === 'idle' ? runStatus : nextProjection.status;
                    setMessages((current) =>
                        isCurrentThread()
                            ? current.map((message) =>
                                message.id === assistantMessageId
                                    ? {
                                        ...message,
                                        text: nextProjection.messageText || message.text,
                                        status: nextProjection.messageStatus || displayStatus,
                                        isThinking:
                                            !nextProjection.terminal &&
                                            [
                                                'creating',
                                                'queued',
                                                'pending',
                                                'running',
                                                'cancelling',
                                            ].includes(displayStatus),
                                        runTimeline: nextProjection.timeline,
                                        runActiveDurationMs: nextProjection.activeDurationMs,
                                        runActiveStartedAt: nextProjection.activeStartedAt,
                                    }
                                    : message
                            )
                            : current
                    );
                    if (nextProjection.messageStatus === 'completed' && !completedMessage) {
                        const messagePage = await getThreadMessages(targetThreadId, { limit: 200 });
                        if (!isCurrentThread()) return;
                        const persistedMessage =
                            messagePage.messages.find(
                                (message) =>
                                    message.id === run.assistant_message_id &&
                                    message.role === 'assistant'
                            ) || null;
                        completedMessage = persistedMessage;
                        if (persistedMessage) {
                            setMessages((current) =>
                                isCurrentThread()
                                    ? current.map((message) =>
                                        message.id === assistantMessageId
                                            ? {
                                                ...message,
                                                text: persistedMessage.content,
                                                status: persistedMessage.status,
                                                isThinking: false,
                                                ragTrace: persistedMessage.rag_trace,
                                            }
                                            : message
                                    )
                                    : current
                            );
                        }
                    }
                } catch (error: unknown) {
                    if (!isCurrentThread()) return;
                    setRunState(projection);
                    setEventError(
                        error instanceof Error ? error.message : '运行轨迹加载失败，请稍后重试。'
                    );
                }
            };

            await refreshEventProjection(run.status);
            while (run.status === 'queued' || run.status === 'pending' || run.status === 'running') {
                await new Promise((resolve) => window.setTimeout(resolve, 750));
                if (!isCurrentThread()) return;
                run = await getRun(run.id, session.access_token);
                await refreshEventProjection(run.status);
            }
            if (!isCurrentThread()) return;
            if (run.status === 'succeeded') {
                let assistantMessage: ThreadMessage | null = completedMessage;
                if (!assistantMessage) {
                    const messagePage = await getThreadMessages(targetThreadId, { limit: 200 });
                    if (!isCurrentThread()) return;
                    assistantMessage =
                        messagePage.messages.find(
                            (message) =>
                                message.id === run.assistant_message_id &&
                                message.role === 'assistant'
                        ) || null;
                }
                setMessages((current) =>
                    isCurrentThread()
                        ? current.map((message) =>
                            message.id === assistantMessageId
                                ? {
                                    ...message,
                                    text:
                                        assistantMessage?.content ||
                                        projection?.messageText ||
                                        '运行已完成，但没有返回助手内容。',
                                    status: assistantMessage?.status || 'completed',
                                    isThinking: false,
                                    ragTrace: assistantMessage?.rag_trace || null,
                                    runTimeline: projection?.timeline || message.runTimeline,
                                    runActiveDurationMs:
                                        projection?.activeDurationMs ?? message.runActiveDurationMs,
                                    runActiveStartedAt:
                                        projection?.activeStartedAt ?? message.runActiveStartedAt,
                                }
                                : message
                        )
                        : current
                );
            } else {
                setMessages((current) =>
                    isCurrentThread()
                        ? current.map((message) =>
                            message.id === assistantMessageId
                                ? {
                                    ...message,
                                    text:
                                        run.status === 'waiting_input'
                                            ? projection?.pendingHitl?.prompt ||
                                            '运行正在等待补充信息。'
                                            : run.error?.message ||
                                            '运行未完成，请稍后重新连接。',
                                    status: run.status,
                                    isThinking: false,
                                    isHitlRequest: run.status === 'waiting_input',
                                    runTimeline: projection?.timeline || message.runTimeline,
                                    runActiveDurationMs:
                                        projection?.activeDurationMs ?? message.runActiveDurationMs,
                                    runActiveStartedAt:
                                        projection?.activeStartedAt ?? message.runActiveStartedAt,
                                }
                                : message
                        )
                        : current
                );
            }
        } catch (error: unknown) {
            if (isCurrentThread()) {
                setMessages((current) =>
                    isCurrentThread()
                        ? current.map((message) =>
                            message.id === assistantMessageId
                                ? {
                                    ...message,
                                    text:
                                        error instanceof Error
                                            ? error.message
                                            : '发送失败，请稍后重试',
                                    status: 'failed',
                                    isThinking: false,
                                }
                                : message
                        )
                        : current
                );
            }
        } finally {
            setSending(false);
            setSendingThreadId('');
        }
    };

    const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void sendMessage();
        }
    };

    const scrollToSource = (messageId: string, chunkIndex: number) => {
        const references = document.getElementById(`references-${messageId}`);
        if (!(references instanceof HTMLDetailsElement)) return;
        references.open = true;
        window.requestAnimationFrame(() => {
            const source = document.getElementById(`chunk-${messageId}-${chunkIndex}`);
            if (!source) return;
            source.scrollIntoView({ behavior: 'smooth', block: 'center' });
            source.classList.add('highlight-chunk');
            window.setTimeout(() => source.classList.remove('highlight-chunk'), 2000);
        });
    };

    return (
        <div className="app-page">
            <div className="aurora-orb aurora-orb-one" aria-hidden="true" />
            <div className="aurora-orb aurora-orb-two" aria-hidden="true" />
            <div className="app-wrapper">
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
                        <button type="button" className="nav-btn" onClick={() => setNav('chat')}>
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
                        {session?.role === 'admin' && (
                            <>
                                <button
                                    type="button"
                                    className={`nav-btn ${nav === 'settings' ? 'active' : ''}`}
                                    aria-label="知识库"
                                    onClick={() => setNav('settings')}
                                >
                                    <i className="fa-regular fa-bookmark" />
                                    <span>Knowledge Base</span>
                                </button>
                                <button
                                    type="button"
                                    className={`nav-btn ${nav === 'models' ? 'active' : ''}`}
                                    onClick={() => setNav('models')}
                                >
                                    <i className="fa-solid fa-microchip" />
                                    <span>模型中心</span>
                                </button>
                                <button
                                    type="button"
                                    className={`nav-btn ${nav === 'capabilities' ? 'active' : ''}`}
                                    onClick={() => setNav('capabilities')}
                                >
                                    <i className="fa-solid fa-puzzle-piece" />
                                    <span>Skill / Tool</span>
                                </button>
                                <button
                                    type="button"
                                    className={`nav-btn ${nav === 'evaluations' ? 'active' : ''}`}
                                    onClick={() => setNav('evaluations')}
                                >
                                    <i className="fa-solid fa-flask-vial" />
                                    <span>RAG 评估</span>
                                </button>
                            </>
                        )}
                    </nav>
                    {session && (
                        <>
                            <div className="sidebar-section-label">最近对话</div>
                            <div className="sidebar-recents">
                                {threads.slice(0, 8).map((thread) => (
                                    <button
                                        key={thread.thread_id}
                                        type="button"
                                        className={`recent-thread ${thread.thread_id === threadId ? 'active' : ''}`}
                                        onClick={() => void openThread(thread.thread_id)}
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
                                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            >
                                <i
                                    className="fa-regular fa-sun theme-toggle-icon theme-toggle-sun"
                                    aria-hidden="true"
                                />
                                <i
                                    className="fa-regular fa-moon theme-toggle-icon theme-toggle-moon"
                                    aria-hidden="true"
                                />
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
                                        onClick={() => void logout()}
                                    >
                                        <i className="fa-solid fa-arrow-right-from-bracket" />
                                    </button>
                                </span>
                            </div>
                        )}
                    </div>
                </aside>

                <main className="main-content">
                    {historyOpen && (
                        <div
                            className="history-backdrop"
                            onMouseDown={(event) => {
                                if (event.target === event.currentTarget) setHistoryOpen(false);
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
                                        onClick={() => setHistoryOpen(false)}
                                    >
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                </div>
                                <div className="history-summary">
                                    <span>
                                        <strong>{threads.length}</strong> 个对话
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            void listThreads()
                                                .then(setThreads)
                                                .catch(() => undefined)
                                        }
                                    >
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
                                                className={`history-item ${thread.thread_id === threadId ? 'active' : ''}`}
                                                onClick={() => void openThread(thread.thread_id)}
                                            >
                                                <strong>{thread.title || '未命名对话'}</strong>
                                                <small>{thread.message_count} 条消息</small>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </aside>
                        </div>
                    )}
                    {!authResolved ? (
                        <section className="auth-page auth-restore-page" role="status">
                            <div className="auth-panel auth-restore-panel">
                                <span className="auth-mini-logo">
                                    <img src={superMewMark} className="brand-mark-image" alt="" />
                                </span>
                                <i className="fa-solid fa-spinner fa-spin" />
                                <h1>正在恢复登录状态</h1>
                                <p>正在安全连接你的私有知识空间…</p>
                            </div>
                        </section>
                    ) : !session ? (
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
                                        <span className="auth-eyebrow">
                                            {authMode === 'login' ? 'Welcome back' : 'Create account'}
                                        </span>
                                        <h1>{authMode === 'login' ? '登录喵喵助手' : '注册喵喵助手'}</h1>
                                    </div>
                                </div>
                                <p className="auth-description">
                                    {authMode === 'login'
                                        ? '进入你的私有知识空间，继续上一次对话。'
                                        : '创建账号后即可开始对话和保存历史记录。'}
                                </p>
                                {authNotice && (
                                    <p className="operation-notice" role="status">
                                        {authNotice}
                                    </p>
                                )}
                                <form className="auth-form" onSubmit={handleAuth}>
                                    <label className="form-field">
                                        <span>邮箱</span>
                                        <span className="field-input">
                                            <i className="fa-regular fa-envelope" />
                                            <input
                                                value={email}
                                                onChange={(event) => setEmail(event.target.value)}
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
                                                value={password}
                                                onChange={(event) => setPassword(event.target.value)}
                                                type="password"
                                                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                                                placeholder="请输入密码"
                                            />
                                        </span>
                                    </label>
                                    <button className="auth-submit" type="submit" disabled={authLoading}>
                                        <span>
                                            {authLoading
                                                ? '正在连接...'
                                                : authMode === 'login'
                                                    ? '进入工作台'
                                                    : '创建账号'}
                                        </span>
                                        <i
                                            className={
                                                authLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-right'
                                            }
                                        />
                                    </button>
                                </form>
                                <div className="auth-divider">
                                    <span>或者</span>
                                </div>
                                <button
                                    className="auth-switch"
                                    type="button"
                                    onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                                >
                                    {authMode === 'login' ? '还没有账号？创建一个' : '已有账号？返回登录'}
                                </button>
                                <p className="auth-footnote">登录即表示你理解 AI 输出需要经过必要的人工复核。</p>
                            </div>
                        </section>
                    ) : nav === 'chat' || nav === 'history' ? (
                        <div className="chat-workspace">
                            <section className="chat-area">
                                <header className="chat-header">
                                    <div className="header-info">
                                        <h1>{threadId ? '知识对话' : '新对话'}</h1>
                                        <span className="header-status-line">
                                            <span className="status-dot" />
                                            <span>{sending ? '喵喵正在生成' : '喵喵在线'}</span>
                                            <span>·</span>
                                            <span>上下文已同步</span>
                                        </span>
                                    </div>
                                    <div className="chat-header-actions">
                                        <button
                                            type="button"
                                            title="历史对话"
                                            aria-label="打开历史对话"
                                            onClick={() => setHistoryOpen(true)}
                                        >
                                            <i className="fa-solid fa-clock-rotate-left" />
                                        </button>
                                    </div>
                                </header>
                                <div className="chat-container">
                                    {messages.length === 0 ? (
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
                                                    className={selectedMode ? '' : 'active'}
                                                    aria-pressed={!selectedMode}
                                                    onClick={() => setSelectedMode(null)}
                                                >
                                                    <span>
                                                        <i className="fa-regular fa-message" />
                                                    </span>
                                                    <strong>智能对话</strong>
                                                    <small>自动选择合适工具</small>
                                                </button>
                                                <button
                                                    type="button"
                                                    className={selectedMode === 'knowledge-base' ? 'active' : ''}
                                                    aria-pressed={selectedMode === 'knowledge-base'}
                                                    disabled={
                                                        webResearchStatus === 'loading' ||
                                                        !knowledgeBaseSkill?.available
                                                    }
                                                    title={
                                                        knowledgeBaseSkill?.available
                                                            ? '使用知识库问答'
                                                            : '知识库能力尚未就绪'
                                                    }
                                                    onClick={() => setSelectedMode('knowledge-base')}
                                                >
                                                    <span>
                                                        <i className="fa-solid fa-book-open" />
                                                    </span>
                                                    <strong>知识库</strong>
                                                    <small>检索私有知识</small>
                                                </button>
                                                <button
                                                    type="button"
                                                    className={selectedMode === 'web-research' ? 'active' : ''}
                                                    aria-pressed={selectedMode === 'web-research'}
                                                    disabled={
                                                        webResearchStatus === 'loading' ||
                                                        !webResearchSkill?.available
                                                    }
                                                    title={
                                                        webResearchStatus === 'error'
                                                            ? webResearchError
                                                            : webResearchAvailabilityReason === 'permission_required'
                                                                ? '当前账号权限不足'
                                                                : webResearchAvailabilityReason === 'not_configured'
                                                                    ? '请管理员在 Skill / Tool 管理中启用'
                                                                    : undefined
                                                    }
                                                    onClick={() => setSelectedMode('web-research')}
                                                >
                                                    <span>
                                                        <i className="fa-solid fa-globe" />
                                                    </span>
                                                    <strong>网络研究</strong>
                                                    <small>
                                                        {webResearchStatus === 'loading'
                                                            ? '正在检查可用性…'
                                                            : webResearchSkill?.available
                                                                ? '查询公开来源'
                                                                : webResearchAvailabilityReason ===
                                                                    'permission_required'
                                                                    ? '当前账号权限不足'
                                                                    : '需管理员启用网络研究'}
                                                    </small>
                                                </button>
                                                <button type="button" onClick={() => setNav('chat')}>
                                                    <span>
                                                        <i className="fa-solid fa-database" />
                                                    </span>
                                                    <strong>SQL 助手</strong>
                                                    <small>只读分析数据</small>
                                                </button>
                                                <button type="button" onClick={() => setNav('chat')}>
                                                    <span>
                                                        <i className="fa-solid fa-terminal" />
                                                    </span>
                                                    <strong>代码沙盒</strong>
                                                    <small>隔离执行代码</small>
                                                </button>
                                            </div>
                                            {webResearchStatus === 'error' && (
                                                <p className="mode-catalog-error" role="status">
                                                    {webResearchError}
                                                </p>
                                            )}
                                        </section>
                                    ) : (
                                        messages.map((message) => (
                                            <article
                                                key={message.id}
                                                id={`message-${message.id}`}
                                                className={
                                                    message.isUser ? 'chat-message chat-message-user' : 'chat-message'
                                                }
                                            >
                                                <div
                                                    className="message-bubble"
                                                    aria-live={message.isThinking ? 'polite' : undefined}
                                                >
                                                    {message.text || (message.isThinking ? '正在处理…' : '')}
                                                </div>
                                                {!message.isUser &&
                                                    Boolean(message.ragTrace?.retrieved_chunks?.length) && (
                                                        <details
                                                            className="references-details references-section"
                                                            id={`references-${message.id}`}
                                                        >
                                                            <summary className="references-title">
                                                                <span>
                                                                    <i
                                                                        className="fa-solid fa-link"
                                                                        aria-hidden="true"
                                                                    />
                                                                    参考来源
                                                                </span>
                                                                <small>
                                                                    {message.ragTrace?.retrieved_chunks?.length} 个片段
                                                                </small>
                                                            </summary>
                                                            <ul className="sources-list references-list">
                                                                {message.ragTrace?.retrieved_chunks?.map(
                                                                    (source, index) => (
                                                                        <li
                                                                            className="source-item"
                                                                            id={`chunk-${message.id}-${index + 1}`}
                                                                            key={`${source.filename}:${source.chunk_id}`}
                                                                        >
                                                                            <button
                                                                                className="ref-index"
                                                                                type="button"
                                                                                aria-label={`跳转到引用 ${index + 1}`}
                                                                                onClick={() =>
                                                                                    scrollToSource(
                                                                                        message.id,
                                                                                        index + 1
                                                                                    )
                                                                                }
                                                                            >
                                                                                {index + 1}
                                                                            </button>
                                                                            <div className="source-content">
                                                                                <div className="source-title-line">
                                                                                    <strong className="source-file">
                                                                                        <i
                                                                                            className="fa-regular fa-file-lines"
                                                                                            aria-hidden="true"
                                                                                        />
                                                                                        {source.filename}
                                                                                    </strong>
                                                                                    {source.page_number && (
                                                                                        <span className="source-page">
                                                                                            第 {source.page_number} 页
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <div className="source-meta-line">
                                                                                    RRF #
                                                                                    {source.rrf_rank || index + 1}
                                                                                    {source.rerank_score != null &&
                                                                                        ` · 精排 ${source.rerank_score.toFixed(2)}`}
                                                                                </div>
                                                                                {source.text && (
                                                                                    <p className="source-excerpt">
                                                                                        {source.text}
                                                                                    </p>
                                                                                )}
                                                                            </div>
                                                                        </li>
                                                                    )
                                                                )}
                                                            </ul>
                                                        </details>
                                                    )}
                                            </article>
                                        ))
                                    )}
                                </div>
                                <div className="input-area-wrapper">
                                    {selectedMode === 'knowledge-base' && (
                                        <div className="selected-mode-banner">
                                            <i className="fa-solid fa-book-open" aria-hidden="true" />
                                            <span>知识库问答 · 检索私有知识</span>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedMode(null)}
                                                aria-label="切回智能对话"
                                            >
                                                切回智能对话
                                            </button>
                                        </div>
                                    )}
                                    {selectedMode === 'web-research' && (
                                        <div className="selected-mode-banner">
                                            <i className="fa-solid fa-globe" aria-hidden="true" />
                                            <span>网络研究 · 查询公开来源</span>
                                            <button
                                                type="button"
                                                onClick={() => setSelectedMode(null)}
                                                aria-label="切回智能对话"
                                            >
                                                切回智能对话
                                            </button>
                                        </div>
                                    )}
                                    {selectedMode === null && messages.length > 0 && (
                                        <div className="selected-mode-banner">
                                            <i className="fa-solid fa-globe" aria-hidden="true" />
                                            <span>需要查询公开来源？</span>
                                            <button
                                                type="button"
                                                disabled={!webResearchSkill?.available}
                                                onClick={() => setSelectedMode('web-research')}
                                                aria-label="切换到网络研究"
                                            >
                                                网络研究
                                            </button>
                                        </div>
                                    )}
                                    <div className="input-area">
                                        <button
                                            className="attach-btn"
                                            type="button"
                                            title="当前版本暂不支持聊天附件"
                                            aria-label="聊天附件暂不可用"
                                            disabled
                                        >
                                            <i className="fa-solid fa-paperclip" />
                                        </button>
                                        <textarea
                                            className="chat-input-textarea"
                                            value={input}
                                            onChange={(event) => setInput(event.target.value)}
                                            onKeyDown={onInputKeyDown}
                                            placeholder={
                                                selectedMode === 'web-research'
                                                    ? '描述要调研的公开问题…'
                                                    : selectedMode === 'knowledge-base'
                                                        ? '询问已上传文档，并说明需要引用的范围…'
                                                        : '和喵喵说点什么吧...'
                                            }
                                            rows={1}
                                        />
                                        <button
                                            type="button"
                                            className="send-btn"
                                            disabled={!input.trim() || sending}
                                            onClick={() => void sendMessage()}
                                            aria-label="发送消息"
                                        >
                                            <i
                                                className={
                                                    sending ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-paper-plane'
                                                }
                                            />
                                        </button>
                                    </div>
                                    <div className="input-footer">
                                        <span>
                                            {selectedMode === 'web-research'
                                                ? '网页信息可能过时，请核对来源与发布时间。'
                                                : selectedMode === 'knowledge-base'
                                                    ? '回答将基于已上传文档并链接原始证据。'
                                                    : 'SuperMew · 可信知识工作台'}
                                        </span>
                                        <span>
                                            <kbd>Enter</kbd> 发送 · <kbd>Shift</kbd> + <kbd>Enter</kbd> 换行
                                        </span>
                                    </div>
                                </div>
                            </section>
                            <LiveEvidencePanel
                                threadId={threadId}
                                messages={messages}
                                runState={runState}
                                isSending={sending && sendingThreadId === threadId}
                                eventError={eventError}
                                onSourceClick={scrollToSource}
                            />
                        </div>
                    ) : (
                        <section
                            className={
                                nav === 'capabilities'
                                    ? 'chat-area capability-admin-host'
                                    : nav === 'settings'
                                        ? 'chat-area knowledge-base-host'
                                        : 'chat-area'
                            }
                            style={{
                                width: '100%',
                                padding: nav === 'capabilities' || nav === 'settings' ? 0 : 32,
                            }}
                        >
                            {nav === 'capabilities' ? (
                                <Suspense fallback={<div role="status">正在加载能力管理…</div>}>
                                    <CapabilityAdminPage
                                        key={session?.username}
                                        onWebResearchUpdated={refreshWebResearchCapability}
                                    />
                                </Suspense>
                            ) : nav === 'settings' ? (
                                <Suspense fallback={<div role="status">正在加载知识库…</div>}>
                                    <KnowledgeBasePage key={session?.username} />
                                </Suspense>
                            ) : (
                                <h1>
                                    {nav === 'models' ? '模型中心' : 'RAG 评估'}
                                </h1>
                            )}
                        </section>
                    )}
                </main>
            </div>
        </div>
    );
}