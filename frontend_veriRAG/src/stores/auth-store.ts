import { create } from 'zustand';
import { getAuthSession, type AuthSession } from '@/auth/session';

interface AuthState {
    session: AuthSession | null;
    resolved: boolean;
    setSession: (session: AuthSession | null) => void;
    setResolved: (resolved: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    session: getAuthSession(),
    resolved: false,
    setSession: (session) => set({ session }),
    setResolved: (resolved) => set({ resolved }),
}));
