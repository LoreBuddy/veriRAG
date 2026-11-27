import { createBrowserRouter, Navigate } from 'react-router';
import AppShell from '@/features/shell/AppShell';
import LoginPage from '@/features/auth/LoginPage';
import ChatPage from '@/features/chat/ChatPage';
import PlaceholderPage from '@/features/admin/PlaceholderPage';
import { PublicOnly, RequireAdmin, RequireAuth } from '@/features/auth/guards';

export const router = createBrowserRouter([
    {
        element: <AppShell />,
        children: [
            { index: true, element: <Navigate to="/chat" replace /> },
            {
                path: 'login',
                element: <PublicOnly />,
                children: [{ index: true, element: <LoginPage /> }],
            },
            {
                element: <RequireAuth />,
                children: [
                    { path: 'chat/:threadId?', element: <ChatPage /> },
                    {
                        element: <RequireAdmin />,
                        children: [
                            {
                                path: 'knowledge',
                                lazy: async () => ({
                                    Component: (await import('@/features/admin/KnowledgePage')).default,
                                }),
                            },
                            {
                                path: 'capabilities',
                                lazy: async () => ({
                                    Component: (await import('@/features/admin/CapabilitiesPage')).default,
                                }),
                            },
                            { path: 'models', element: <PlaceholderPage title="模型中心" /> },
                            { path: 'evaluations', element: <PlaceholderPage title="RAG 评估" /> },
                        ],
                    },
                ],
            },
            { path: '*', element: <Navigate to="/chat" replace /> },
        ],
    },
]);