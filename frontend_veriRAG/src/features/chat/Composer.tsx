import { useState, type KeyboardEvent } from 'react';
import { useChatStore } from './chat-store';
import { useWebResearchStore } from '@/stores/web-research-store';

interface ComposerProps {
    onSend: (text: string) => void;
}

export default function Composer({ onSend }: ComposerProps) {
    const [input, setInput] = useState('');
    const sending = useChatStore((state) => state.sending);
    const hasMessages = useChatStore((state) => state.messages.length > 0);
    const { skill, selected, select } = useWebResearchStore();

    const submit = () => {
        const text = input.trim();
        if (!text || sending) return;
        setInput('');
        onSend(text);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
        }
    };

    return (
        <div className="input-area-wrapper">
            {selected && (
                <div className="selected-mode-banner">
                    <i className="fa-solid fa-globe" aria-hidden="true" />
                    <span>网络研究 · 查询公开来源</span>
                    <button type="button" onClick={() => select(false)} aria-label="切回智能对话">
                        切回智能对话
                    </button>
                </div>
            )}
            {!selected && hasMessages && (
                <div className="selected-mode-banner">
                    <i className="fa-solid fa-globe" aria-hidden="true" />
                    <span>需要查询公开来源？</span>
                    <button
                        type="button"
                        disabled={!skill?.available}
                        onClick={() => select(true)}
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
                    onKeyDown={onKeyDown}
                    placeholder={selected ? '描述要调研的公开问题…' : '和喵喵说点什么吧...'}
                    rows={1}
                />
                <button
                    type="button"
                    className="send-btn"
                    disabled={!input.trim() || sending}
                    onClick={submit}
                    aria-label="发送消息"
                >
                    <i className={sending ? 'fa-solid fa-spinner fa-spin' : 'fa-regular fa-paper-plane'} />
                </button>
            </div>
            <div className="input-footer">
                <span>
                    {selected
                        ? '网页信息可能过时，请核对来源与发布时间。'
                        : 'SuperMew · 可信知识工作台'}
                </span>
                <span>
                    <kbd>Enter</kbd> 发送 · <kbd>Shift</kbd> + <kbd>Enter</kbd> 换行
                </span>
            </div>
        </div>
    );
}
