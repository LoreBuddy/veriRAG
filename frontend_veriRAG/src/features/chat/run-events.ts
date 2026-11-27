import { getPublicError } from '@/utils/api';
import { getRunEvents } from '@/runs/runClient';
import { applyRunEvent, type RunEventState } from '@/events/runEventReducer';
import type { EvidenceMessage } from '@/components/Chat/LiveEvidencePanel';
import type { ThreadMessage } from '@/types/threads';

const PAGE_SIZE = 1000;

/** Pulls every event after the projection's last sequence and folds it in. */
export async function replayRunEvents(
    initialState: RunEventState,
    token: string
): Promise<RunEventState> {
    let current = initialState;
    while (true) {
        const response = await getRunEvents(current.runId, token, {
            after: current.lastSequence,
            limit: PAGE_SIZE,
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
        if (response.events.length < PAGE_SIZE) return current;
    }
}

export function toMessage(message: ThreadMessage): EvidenceMessage | null {
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
