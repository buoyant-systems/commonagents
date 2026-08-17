import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/*
 * The site's browser code, linted for one thing above all: Node's globals must
 * not appear in it.
 *
 * A module that reads one builds, server-renders and reviews cleanly, then
 * throws on the first page a visitor opens — Node has the global, the browser
 * does not, and only the browser runs the page. Nothing else in the pipeline
 * objects: Docusaurus renders every page under Node before it emits it, so the
 * build is the one environment where the mistake works.
 *
 * TypeScript cannot express the ban. Withholding @types/node achieves nothing,
 * because the Docusaurus type surface a site legitimately imports carries
 * `/// <reference types="node" />` transitively, and that reference resolves
 * from inside the package that wrote it — no `types` or `typeRoots` setting
 * overrides it. So the ban lives here, where it is a question about names
 * rather than about types.
 *
 * src/ holds only stylesheets today, so this lints nothing yet. That is the
 * point: it is here for the first component someone adds, which is when the
 * mistake becomes possible.
 *
 * The build's own Node context — docusaurus.config.ts and sidebars.ts — is
 * outside `files` below and may read process.env. That is the supported route
 * for a build-time value: read it there, and hand it to the browser through
 * `customFields`.
 */

const NODE_ONLY_GLOBALS = [
  'process',
  'Buffer',
  'global',
  '__dirname',
  '__filename',
  'require',
  'module',
];

const NOT_IN_THE_BROWSER =
  'Node global — this code runs in a browser, where it does not exist. Read the ' +
  'value in docusaurus.config.ts and pass it through customFields instead.';

export default defineConfig([
  globalIgnores(['build', '.docusaurus', 'versioned_docs']),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-restricted-globals': [
        'error',
        ...NODE_ONLY_GLOBALS.map((name) => ({ name, message: NOT_IN_THE_BROWSER })),
      ],
    },
  },
]);
