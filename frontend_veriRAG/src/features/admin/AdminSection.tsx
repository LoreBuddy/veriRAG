import type { ReactNode } from 'react';

type Variant = 'capabilities' | 'knowledge';

const CLASS_NAMES: Record<Variant, string> = {
    capabilities: 'chat-area capability-admin-host',
    knowledge: 'chat-area knowledge-base-host',
};

/** Shared frame for admin pages; keeps the existing host classes and padding. */
export default function AdminSection({
    variant,
    children,
}: {
    variant?: Variant;
    children: ReactNode;
}) {
    return (
        <section
            className={variant ? CLASS_NAMES[variant] : 'chat-area'}
            style={{ width: '100%', padding: variant ? 0 : 32 }}
        >
            {children}
        </section>
    );
}
