import CapabilityAdminPage from '@/components/Capabilities/CapabilityAdminPage';
import { useAuthStore } from '@/stores/auth-store';
import { useWebResearchStore } from '@/stores/web-research-store';
import AdminSection from './AdminSection';

const refreshWebResearch = () => useWebResearchStore.getState().load();

export default function CapabilitiesPage() {
    const username = useAuthStore((state) => state.session?.username);
    return (
        <AdminSection variant="capabilities">
            <CapabilityAdminPage key={username} onWebResearchUpdated={refreshWebResearch} />
        </AdminSection>
    );
}
