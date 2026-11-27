import AdminSection from './AdminSection';

export default function PlaceholderPage({ title }: { title: string }) {
    return (
        <AdminSection>
            <h1>{title}</h1>
        </AdminSection>
    );
}
