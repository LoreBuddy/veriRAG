import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

export const apiBaseUrl = (import.meta.env.VITE_CORE_API ?? '').trim().replace(/\/+$/, '');

if (!apiBaseUrl && import.meta.env.PROD) {
  throw new Error('VITE_CORE_API was not set at build time');
}

export const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 60000,
  withCredentials: true,
});