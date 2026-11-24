export function createWebResearchMessage(text: string, activation = '/web-research'): string {
  return `${activation}\n${text.trim()}`;
}
