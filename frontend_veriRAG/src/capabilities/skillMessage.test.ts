import { describe, expect, it } from 'vitest';
import { createSkillMessage } from './skillMessage';

describe('createSkillMessage', () => {
    it('adds the selected skill activation and trims the prompt', () => {
        expect(
            createSkillMessage('  查找私有文档  ', {
                name: 'knowledge-base',
                activation: '/knowledge-base',
                available: true,
            })
        ).toBe('/knowledge-base\n查找私有文档');
    });

    it('falls back to a plain prompt when the skill is unavailable', () => {
        expect(
            createSkillMessage(' 查找私有文档 ', {
                name: 'knowledge-base',
                activation: '/knowledge-base',
                available: false,
            })
        ).toBe('查找私有文档');
    });
});
