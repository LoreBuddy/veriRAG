import { Outlet } from 'react-router';
import HistoryDrawer from './HistoryDrawer';
import Sidebar from './Sidebar';
import { useWorkspaceData } from './useWorkspaceData';

export default function AppShell() {
    useWorkspaceData();

    return (
        <div className="app-page">
            <div className="aurora-orb aurora-orb-one" aria-hidden="true" />
            <div className="aurora-orb aurora-orb-two" aria-hidden="true" />
            <div className="app-wrapper">
                <Sidebar />
                <main className="main-content">
                    <HistoryDrawer />
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
