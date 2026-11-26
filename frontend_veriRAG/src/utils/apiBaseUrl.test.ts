import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalAdapter = axios.defaults.adapter;
const requests: InternalAxiosRequestConfig[] = [];

afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  vi.unstubAllEnvs();
  vi.resetModules();
  requests.length = 0;
});

describe('configured API origin', () => {
  it('is used for API and refresh requests', async () => {
    const apiOrigin = 'https://api.example.test';
    vi.stubEnv('VITE_CORE_API', apiOrigin);
    axios.defaults.adapter = async (config) => {
      requests.push(config);
      return {
        data:
          config.url === '/auth/refresh'
            ? { access_token: 'fresh-access', username: 'alice', role: 'user' }
            : { ok: true },
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      };
    };

    const [{ default: api }, { refreshAuthSession }] = await Promise.all([
      import('./api'),
      import('@/auth/session'),
    ]);

    await api.get('/health/live');
    await refreshAuthSession();

    expect(requests.map(({ baseURL, url }) => [baseURL, url])).toEqual([
      [apiOrigin, '/health/live'],
      [apiOrigin, '/auth/refresh'],
    ]);
    expect(requests.every(({ withCredentials }) => withCredentials)).toBe(true);
  });
});
