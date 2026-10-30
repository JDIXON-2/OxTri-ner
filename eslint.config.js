import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const serviceWorkerGlobals = Object.fromEntries(
  ['self', 'caches', 'fetch', 'URL'].map((g) => [g, 'readonly']),
);

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['public/sw.js'], languageOptions: { globals: serviceWorkerGlobals } },
);
