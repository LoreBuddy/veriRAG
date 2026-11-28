export function createSkillMessage(
    text: string,
    skill: { name: string; activation: string; available: boolean } | null
): string {
    const trimmed = text.trim();
    return skill?.available ? `${skill.activation}\n${trimmed}` : trimmed;
}
