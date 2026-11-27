import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const THEME_KEY = 'supermew-theme';

function readTheme(): Theme {
    try {
        return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    } catch {
        return 'dark';
    }
}

function applyTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch {
        // Theme still applies for this page when storage is unavailable.
    }
}

interface UiState {
    theme: Theme;
    historyOpen: boolean;
    toggleTheme: () => void;
    setHistoryOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
    theme: readTheme(),
    historyOpen: false,
    toggleTheme: () => {
        const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        set({ theme: next });
    },
    setHistoryOpen: (historyOpen) => set({ historyOpen }),
}));

applyTheme(useUiStore.getState().theme);
