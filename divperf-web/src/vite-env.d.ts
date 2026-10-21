/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "off": keep no dashboard data in the browser — see queries/dataCache.ts. */
  readonly VITE_DATA_CACHE?: string;
}
