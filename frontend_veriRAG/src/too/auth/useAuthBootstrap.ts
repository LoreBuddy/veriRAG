import { useEffect } from 'react';
import { clearAuthSession, restoreAuthSession, subscribeAuthSession } from '@/auth/session';
import { useAuthStore } from '@/stores/auth-store';
import { useThreadStore } from '@/stores/thread-store';
import { useWebResearchStore } from '@/stores/web-research-store';
import { useChatStore } from '@/too/chat/chat-store';

/** Mirrors the auth session module into the store and restores the session on load. */
export function useAuthBootstrap(): void {
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
        const { setSession, setResolved } = useAuthStore.getState();

        const unsubscribe = subscribeAuthSession((session) => {
            setSession(session);
            if (!session) {
                useChatStore.getState().reset();
                useThreadStore.getState().reset();
                useWebResearchStore.getState().reset();
            }
        });

        void restoreAuthSession()
            .catch(() => clearAuthSession())
            .finally(() => setResolved(true));

        const handleUnauthorized = () => clearAuthSession();
        window.addEventListener('unauthorized', handleUnauthorized);

        return () => {
            unsubscribe();
            window.removeEventListener('unauthorized', handleUnauthorized);
        };
    }, []);
}
