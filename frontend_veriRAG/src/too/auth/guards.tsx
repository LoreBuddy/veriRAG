import { Navigate, Outlet } from 'react-router';
import superMewMark from '@/assets/images/supermew-mark.png';
import { useAuthStore } from '@/stores/auth-store';

function RestoringSession() {
    return (
        <section className="auth-page auth-restore-page" role="status">
            <div className="auth-panel auth-restore-panel">
                <span className="auth-mini-logo">
                    <img src={superMewMark} className="brand-mark-image" alt="" />
                </span>
                <i className="fa-solid fa-spinner fa-spin" />
                <h1>正在恢复登录状态</h1>
                <p>正在安全连接你的私有知识空间…</p>
            </div>
        </section>
    );
}

/** Protected routes: wait for restore, then require a session. */
export function RequireAuth() {
    const resolved = useAuthStore((state) => state.resolved);
    const session = useAuthStore((state) => state.session);
    if (!resolved) return <RestoringSession />;
    if (!session) return <Navigate to="/login" replace />;
    return <Outlet />;
}

/** Login route: signed-in users go straight to the workspace. */
export function PublicOnly() {
    const resolved = useAuthStore((state) => state.resolved);
    const session = useAuthStore((state) => state.session);
    if (!resolved) return <RestoringSession />;
    if (session) return <Navigate to="/chat" replace />;
    return <Outlet />;
}

/** Admin routes. Must be nested inside RequireAuth. */
export function RequireAdmin() {
    const role = useAuthStore((state) => state.session?.role);
    if (role !== 'admin') return <Navigate to="/chat" replace />;
    return <Outlet />;
}
