import { create } from 'zustand';
import { getAuthSession } from '@/auth/session';
import { getCapabilityCatalog } from '@/capabilities/capabilityClient';
import type { CapabilityAvailabilityReason, CapabilitySkill } from '@/types/capabilities';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface WebResearchState {
    skill: CapabilitySkill | null;
    status: Status;
    reason: CapabilityAvailabilityReason;
    error: string;
    selected: boolean;
    select: (selected: boolean) => void;
    load: () => Promise<void>;
    reset: () => void;
}

const empty = {
    skill: null,
    status: 'idle' as Status,
    reason: null as CapabilityAvailabilityReason,
    error: '',
    selected: false,
};

export const useWebResearchStore = create<WebResearchState>((set, get) => ({
    ...empty,
    select: (selected) => set({ selected }),
    reset: () => set(empty),
    load: async () => {
        const username = getAuthSession()?.username;
        if (!username) {
            get().reset();
            return;
        }
        set({ status: 'loading', error: '' });
        try {
            const catalog = await getCapabilityCatalog();
            if (getAuthSession()?.username !== username) return;
            const skill = catalog.skills.find((item) => item.name === 'web-research') ?? null;
            set((state) => ({
                skill,
                reason: skill?.availability_reason ?? 'not_configured',
                status: 'ready',
                selected: skill?.available ? state.selected : false,
            }));
        } catch (error: unknown) {
            if (getAuthSession()?.username === username) {
                set({
                    error: error instanceof Error ? error.message : '网络研究能力目录加载失败。',
                    status: 'error',
                });
            }
            throw error;
        }
    },
}));
