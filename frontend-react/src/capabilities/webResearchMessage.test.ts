import { describe, expect, it } from 'vitest';
import { createWebResearchMessage } from './webResearchMessage';

describe('createWebResearchMessage', () => {
  it('uses the explicit web-research skill activation and trims the user prompt', () => {
    expect(createWebResearchMessage('  查找公开来源  ', '/web-research')).toBe(
      '/web-research\n查找公开来源'
    );
  });
});
