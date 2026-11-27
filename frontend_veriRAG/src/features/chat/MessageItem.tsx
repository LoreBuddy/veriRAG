import type { EvidenceMessage } from '@/components/Chat/LiveEvidencePanel';
import { scrollToSource } from '../scroll-to-source';

export default function MessageItem({ message }: { message: EvidenceMessage }) {
    const chunks = message.ragTrace?.retrieved_chunks;
    return (
        <article
            id={`message-${message.id}`}
            className={message.isUser ? 'chat-message chat-message-user' : 'chat-message'}
        >
            <div className="message-bubble" aria-live={message.isThinking ? 'polite' : undefined}>
                {message.text || (message.isThinking ? '正在处理…' : '')}
            </div>
            {!message.isUser && Boolean(chunks?.length) && (
                <details
                    className="references-details references-section"
                    id={`references-${message.id}`}
                >
                    <summary className="references-title">
                        <span>
                            <i className="fa-solid fa-link" aria-hidden="true" />
                            参考来源
                        </span>
                        <small>{chunks?.length} 个片段</small>
                    </summary>
                    <ul className="sources-list references-list">
                        {chunks?.map((source, index) => (
                            <li
                                className="source-item"
                                id={`chunk-${message.id}-${index + 1}`}
                                key={`${source.filename}:${source.chunk_id}`}
                            >
                                <button
                                    className="ref-index"
                                    type="button"
                                    aria-label={`跳转到引用 ${index + 1}`}
                                    onClick={() => scrollToSource(message.id, index + 1)}
                                >
                                    {index + 1}
                                </button>
                                <div className="source-content">
                                    <div className="source-title-line">
                                        <strong className="source-file">
                                            <i className="fa-regular fa-file-lines" aria-hidden="true" />
                                            {source.filename}
                                        </strong>
                                        {source.page_number && (
                                            <span className="source-page">第 {source.page_number} 页</span>
                                        )}
                                    </div>
                                    <div className="source-meta-line">
                                        RRF #{source.rrf_rank || index + 1}
                                        {source.rerank_score != null &&
                                            ` · 精排 ${source.rerank_score.toFixed(2)}`}
                                    </div>
                                    {source.text && <p className="source-excerpt">{source.text}</p>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </article>
    );
}
