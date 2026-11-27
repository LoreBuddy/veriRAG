export function scrollToSource(messageId: string, chunkIndex: number): void {
    const references = document.getElementById(`references-${messageId}`);
    if (!(references instanceof HTMLDetailsElement)) return;
    references.open = true;
    window.requestAnimationFrame(() => {
        const source = document.getElementById(`chunk-${messageId}-${chunkIndex}`);
        if (!source) return;
        source.scrollIntoView({ behavior: 'smooth', block: 'center' });
        source.classList.add('highlight-chunk');
        window.setTimeout(() => source.classList.remove('highlight-chunk'), 2000);
    });
}
