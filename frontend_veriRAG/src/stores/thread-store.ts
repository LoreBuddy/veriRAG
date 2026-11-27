import { create } from 'zustand';
import { getAuthSession } from '@/auth/session';
import { listThreads } from '@/threads/threadClient';
import type { ThreadSummary } from '@/types/threads';

interface ThreadState {
    threads: ThreadSummary[];
    load: () => Promise<void>;
    prepend: (thread: ThreadSummary) => void;
    reset: () => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
    threads: [],
    load: async () => {
        const username = getAuthSession()?.username;
        try {
            const threads = await listThreads();
            if (getAuthSession()?.username !== username) return;
            set({ threads });
        } catch {
            // The list is a convenience; failures must not break the page.
        }
    },
    prepend: (thread) => set((state) => ({ threads: [thread, ...state.threads] })),
    reset: () => set({ threads: [] }),
}));
