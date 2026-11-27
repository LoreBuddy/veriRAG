import KnowledgeBasePage from '@/components/Documents/KnowledgeBasePage';
import { useAuthStore } from '@/stores/auth-store';
import AdminSection from './AdminSection';

export default function KnowledgePage() {
    const username = useAuthStore((state) => state.session?.username);
    return (
        <AdminSection variant="knowledge">
            <KnowledgeBasePage key={username} />
        </AdminSection>
    );
}
