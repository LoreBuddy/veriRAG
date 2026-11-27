import { create } from 'zustand';
import { getAuthSession } from '@/auth/session';
import { createThread, getThreadMessages } from '@/threads/threadClient';
import { createRun, getRun } from '@/runs/runClient';
import { initialRunEventState, type RunEventState } from '@/events/runEventReducer';
import type { EvidenceMessage } from '@/components/Chat/LiveEvidencePanel';
import type { ThreadMessage } from '@/types/threads';
import { useThreadStore } from '@/stores/thread-store';
import { replayRunEvents, toMessage } from './run-events';

type Message = EvidenceMessage;

const POLL_INTERVAL_MS = 750;
const POLLING_STATUSES = ['queued', 'pending', 'running'];
const THINKING_STATUSES = ['creating', 'queued', 'pending', 'running', 'cancelling'];

/**
 * Bumped whenever the visible conversation changes (open, reset, new thread).
 * In-flight work compares against it and stops touching the UI when stale.
 */
let loadGeneration = 0;

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

/** Always read the latest token: access tokens rotate during long runs. */
function accessToken(): string {
    const token = getAuthSession()?.access_token;
    if (!token) throw new Error('登录已失效，请重新登录');
    return token;
}

async function findAssistantMessage(
    threadId: string,
    messageId: unknown
): Promise<ThreadMessage | null> {
    const page = await getThreadMessages(threadId, { limit: 200 });
    return page.messages.find((m) => m.id === messageId && m.role === 'assistant') ?? null;
}

interface ChatState {
    threadId: string;
    messages: Message[];
    runState: RunEventState | null;
    eventError: string;
    sending: boolean;
    sendingThreadId: string;
    reset: () => void;
    openThread: (threadId: string) => Promise<void>;
    sendMessage: (
        text: string,
        executionMessage: string,
        onThreadCreated?: (threadId: string) => void
    ) => Promise<void>;
}

const emptyConversation = {
    threadId: '',
    messages: [] as Message[],
    runState: null as RunEventState | null,
    eventError: '',
    sending: false,
    sendingThreadId: '',
};

export const useChatStore = create<ChatState>((set, get) => ({
    ...emptyConversation,

    reset: () => {
        loadGeneration += 1;
        set(emptyConversation);
    },

    openThread: async (threadId) => {
        const session = getAuthSession();
        if (!session) return;
        const generation = ++loadGeneration;
        const isStale = () =>
            generation !== loadGeneration || getAuthSession()?.username !== session.username;

        set({ threadId, messages: [], runState: null, eventError: '' });

        try {
            const page = await getThreadMessages(threadId, { limit: 200 });
            if (isStale()) return;
            const ordered = [...page.messages].sort((a, b) => a.sequence - b.sequence);
            set({
                messages: ordered
                    .map(toMessage)
                    .filter((message): message is Message => message !== null),
            });

            const latestAssistant = [...ordered]
                .reverse()
                .find((message) => message.role === 'assistant' && message.run_id);
            if (!latestAssistant?.run_id) return;

            const initial = initialRunEventState(latestAssistant.run_id, threadId);
            set({ runState: initial });
            try {
                const replayed = await replayRunEvents(initial, accessToken());
                if (isStale()) return;
                set((state) => ({
                    runState: replayed,
                    messages: state.messages.map((message) =>
                        message.runId === replayed.runId && !message.isUser
                            ? {
                                  ...message,
                                  runTimeline: replayed.timeline,
                                  runActiveDurationMs: replayed.activeDurationMs,
                                  runActiveStartedAt: replayed.activeStartedAt,
                              }
                            : message
                    ),
                }));
            } catch (error: unknown) {
                if (!isStale()) {
                    set({ eventError: errorMessage(error, '运行轨迹加载失败，请稍后重试。') });
                }
            }
        } catch (error: unknown) {
            if (!isStale()) {
                set({ eventError: errorMessage(error, '历史对话加载失败，请稍后重试。') });
            }
        }
    },

    sendMessage: async (text, executionMessage, onThreadCreated) => {
        const session = getAuthSession();
        if (!text || !session || get().sending) return;

        let generation = loadGeneration;
        const isCurrent = () =>
            generation === loadGeneration && getAuthSession()?.username === session.username;

        const pendingId = `a-pending-${Date.now()}`;
        let assistantId = pendingId;
        const persisted: { message: ThreadMessage | null } = { message: null };

        const updateAssistant = (update: (message: Message) => Message) => {
            if (!isCurrent()) return;
            set((state) => ({
                messages: state.messages.map((m) => (m.id === assistantId ? update(m) : m)),
            }));
        };

        set((state) => ({
            sending: true,
            sendingThreadId: state.threadId,
            runState: null,
            eventError: '',
            messages: [
                ...state.messages,
                { id: `u-${Date.now()}`, isUser: true, text },
                { id: pendingId, isUser: false, text: '', status: 'queued', isThinking: true },
            ],
        }));

        try {
            let threadId = get().threadId;
            if (!threadId) {
                const thread = await createThread();
                if (!isCurrent()) return;
                threadId = thread.thread_id;
                generation = ++loadGeneration;
                set({ threadId, sendingThreadId: threadId });
                useThreadStore.getState().prepend({
                    thread_id: thread.thread_id,
                    title: thread.title || '新对话',
                    message_count: thread.message_count,
                    updated_at: thread.updated_at,
                    version: thread.version,
                    thread_status: thread.thread_status,
                    active_run_id: thread.active_run_id,
                    active_run_status: thread.active_run_status,
                });
                onThreadCreated?.(threadId);
            }
            if (!isCurrent()) return;
            const targetThreadId = threadId;

            const created = await createRun(
                targetThreadId,
                {
                    message: executionMessage,
                    idempotency_key: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
                },
                accessToken()
            );
            if (!isCurrent()) return;

            let run = created.run;
            const runAssistantId = `a-${run.id}`;
            let projection = initialRunEventState(run.id, targetThreadId);
            set((state) => ({
                runState: projection,
                messages: state.messages.map((m) =>
                    m.id === pendingId
                        ? { ...m, id: runAssistantId, runId: run.id, status: run.status }
                        : m
                ),
            }));
            assistantId = runAssistantId;

            const refreshProjection = async (runStatus: string) => {
                try {
                    const next = await replayRunEvents(projection, accessToken());
                    projection = next;
                    if (!isCurrent()) return;
                    const displayStatus = next.status === 'idle' ? runStatus : next.status;
                    set({ runState: next, eventError: '' });
                    updateAssistant((m) => ({
                        ...m,
                        text: next.messageText || m.text,
                        status: next.messageStatus || displayStatus,
                        isThinking: !next.terminal && THINKING_STATUSES.includes(displayStatus),
                        runTimeline: next.timeline,
                        runActiveDurationMs: next.activeDurationMs,
                        runActiveStartedAt: next.activeStartedAt,
                    }));
                    if (next.messageStatus === 'completed' && !persisted.message) {
                        const found = await findAssistantMessage(
                            targetThreadId,
                            run.assistant_message_id
                        );
                        if (!isCurrent() || !found) return;
                        persisted.message = found;
                        updateAssistant((m) => ({
                            ...m,
                            text: found.content,
                            status: found.status,
                            isThinking: false,
                            ragTrace: found.rag_trace,
                        }));
                    }
                } catch (error: unknown) {
                    if (!isCurrent()) return;
                    set({
                        runState: projection,
                        eventError: errorMessage(error, '运行轨迹加载失败，请稍后重试。'),
                    });
                }
            };

            await refreshProjection(run.status);
            while (POLLING_STATUSES.includes(run.status)) {
                await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
                if (!isCurrent()) return;
                run = await getRun(run.id, accessToken());
                await refreshProjection(run.status);
            }
            if (!isCurrent()) return;

            if (run.status === 'succeeded') {
                const assistantMessage =
                    persisted.message ??
                    (await findAssistantMessage(targetThreadId, run.assistant_message_id));
                if (!isCurrent()) return;
                updateAssistant((m) => ({
                    ...m,
                    text:
                        assistantMessage?.content ||
                        projection.messageText ||
                        '运行已完成，但没有返回助手内容。',
                    status: assistantMessage?.status || 'completed',
                    isThinking: false,
                    ragTrace: assistantMessage?.rag_trace || null,
                    runTimeline: projection.timeline || m.runTimeline,
                    runActiveDurationMs: projection.activeDurationMs ?? m.runActiveDurationMs,
                    runActiveStartedAt: projection.activeStartedAt ?? m.runActiveStartedAt,
                }));
            } else {
                updateAssistant((m) => ({
                    ...m,
                    text:
                        run.status === 'waiting_input'
                            ? projection.pendingHitl?.prompt || '运行正在等待补充信息。'
                            : run.error?.message || '运行未完成，请稍后重新连接。',
                    status: run.status,
                    isThinking: false,
                    isHitlRequest: run.status === 'waiting_input',
                    runTimeline: projection.timeline || m.runTimeline,
                    runActiveDurationMs: projection.activeDurationMs ?? m.runActiveDurationMs,
                    runActiveStartedAt: projection.activeStartedAt ?? m.runActiveStartedAt,
                }));
            }
        } catch (error: unknown) {
            updateAssistant((m) => ({
                ...m,
                text: errorMessage(error, '发送失败，请稍后重试'),
                status: 'failed',
                isThinking: false,
            }));
        } finally {
            set({ sending: false, sendingThreadId: '' });
        }
    },
}));
