import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import LiveEvidencePanel from '@/components/Chat/LiveEvidencePanel';
import { createWebResearchMessage } from '@/capabilities/webResearchMessage';
import { useUiStore } from '@/stores/ui-store';
import { useWebResearchStore } from '@/stores/web-research-store';
import { useChatStore } from './chat-store';
import { scrollToSource } from '../scroll-to-source';
import Composer from './Composer';
import MessageItem from './MessageItem';
import WelcomeScreen from './WelcomeScreen';

export default function ChatPage() {
    const { threadId: routeThreadId } = useParams();
    const navigate = useNavigate();
    const setHistoryOpen = useUiStore((state) => state.setHistoryOpen);

    const threadId = useChatStore((state) => state.threadId);
    const messages = useChatStore((state) => state.messages);
    const runState = useChatStore((state) => state.runState);
    const eventError = useChatStore((state) => state.eventError);
    const sending = useChatStore((state) => state.sending);
    const sendingThreadId = useChatStore((state) => state.sendingThreadId);

    const containerRef = useRef<HTMLDivElement>(null);

    // The URL is the source of truth for which conversation is open.
    useEffect(() => {
        const chat = useChatStore.getState();
        if (routeThreadId) {
            if (routeThreadId === chat.threadId) return; // already loaded or just created
            useWebResearchStore.getState().select(false);
            void chat.openThread(routeThreadId);
        } else if (chat.threadId) {
            chat.reset(); // /chat without an id means a new conversation
        }
    }, [routeThreadId]);

    useEffect(() => {
        const container = containerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [messages]);

    const handleSend = (text: string) => {
        const { selected, skill } = useWebResearchStore.getState();
        const executionMessage =
            selected && skill ? createWebResearchMessage(text, skill.activation) : text;
        void useChatStore
            .getState()
            .sendMessage(text, executionMessage, (id) => navigate(`/chat/${id}`, { replace: true }));
    };

    return (
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
                <div className="chat-container" ref={containerRef}>
                    {messages.length === 0 ? (
                        <WelcomeScreen />
                    ) : (
                        messages.map((message) => <MessageItem key={message.id} message={message} />)
                    )}
                </div>
                <Composer onSend={handleSend} />
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
    );
}
