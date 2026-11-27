import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useThreadStore } from '@/stores/thread-store';
import { useWebResearchStore } from '@/stores/web-research-store';

/** Loads per-user data whenever the signed-in user changes. */
export function useWorkspaceData(): void {
    const username = useAuthStore((state) => state.session?.username);

    useEffect(() => {
        const webResearch = useWebResearchStore.getState();
        webResearch.reset();
        if (!username) return;
        void useThreadStore.getState().load();
        void webResearch.load().catch(() => undefined);
    }, [username]);
}
