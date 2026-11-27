import { clearAuthSession, revokeRefreshSession } from '@/auth/session';

/** Revokes the refresh credential, then clears the in-memory session. */
export async function logout(): Promise<void> {
    await revokeRefreshSession().catch(() => undefined);
    clearAuthSession();
}
