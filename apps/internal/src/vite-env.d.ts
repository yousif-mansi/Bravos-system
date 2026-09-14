/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface Window {
  __bravosDecideUpdate?: () => Promise<void>;
}
