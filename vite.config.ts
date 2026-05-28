/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import babel from '@rollup/plugin-babel';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

import viteCopyExcalidrawAssets from './viteCopyExcalidrawAssets';

// https://vitejs.dev/config/
export default defineConfig(({mode}) => ({
  base: './',
  build: {
    outDir: 'build',
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        split: new URL('./split/index.html', import.meta.url).pathname,
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('excalidraw')) {
              return 'excalidraw';
            }
            if (id.includes('katex')) {
              return 'katex';
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'react';
            }
            if (id.includes('lexical')) {
              return 'lexical';
            }
            if (id.includes('yjs') || id.includes('y-websocket')) {
              return 'yjs';
            }
            return 'vendor';
          }
        },
      },
    },
    target: 'es2022',
    ...(mode === 'production'
      ? {
          minify: 'terser',
          terserOptions: {
            compress: {
              toplevel: true,
            },
            keep_classnames: true,
          },
        }
      : {minify: false}),
  },
  plugins: [
    babel({
      babelHelpers: 'bundled',
      babelrc: false,
      configFile: false,
      exclude: '**/node_modules/**',
      extensions: ['jsx', 'js', 'ts', 'tsx', 'mjs'],
      plugins: [
        '@babel/plugin-transform-flow-strip-types',
      ],
      presets: [['@babel/preset-react', {runtime: 'automatic'}]],
    }),
    react(),
    ...viteCopyExcalidrawAssets(),
  ],
}));
