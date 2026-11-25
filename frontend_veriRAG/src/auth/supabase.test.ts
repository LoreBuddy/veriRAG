import { afterEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.fn(() => ({}));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

describe('Supabase browser client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    createClient.mockClear();
  });

  it('requires both public project settings', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const { getSupabaseClient } = await import('./supabase');

    expect(() => getSupabaseClient()).toThrow('Supabase 尚未配置');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('keeps provider credentials in memory only', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test-key');
    const { getSupabaseClient } = await import('./supabase');

    getSupabaseClient();

    expect(createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'sb_publishable_test-key',
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          flowType: 'implicit',
        },
      }
    );
  });
});
