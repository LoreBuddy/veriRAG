import { createBrowserRouter, Navigate } from 'react-router';
import AppShell from '@/too/shell/AppShell';
import LoginPage from '@/too/auth/LoginPage';
import ChatPage from '@/too/chat/ChatPage';
import PlaceholderPage from '@/too/admin/PlaceholderPage';
import { PublicOnly, RequireAdmin, RequireAuth } from '@/too/auth/guards';

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
                                    Component: (await import('@/too/admin/KnowledgePage')).default,
                                }),
                            },
                            {
                                path: 'capabilities',
                                lazy: async () => ({
                                    Component: (await import('@/too/admin/CapabilitiesPage')).default,
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