/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Versão do app injetada pelo Vite (define) a partir do package.json. */
declare const __APP_VERSION__: string;
