/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CORE_API?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
