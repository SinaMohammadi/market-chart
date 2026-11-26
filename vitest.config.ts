import { defineConfig } from 'vitest/config';
import { alias } from './vitest.aliases';

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'core',
          root: './packages/core',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'testing',
          root: './packages/testing',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'indicators',
          root: './packages/indicators',
          // Pure engine tests run in Node; chart/React tests opt into jsdom with a file comment.
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'drawing-tools',
          root: './packages/drawing-tools',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'charts',
          root: './packages/charts',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'datafeed',
          root: './packages/datafeed',
          // Chart and React tests opt into jsdom with a file comment.
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'persistence',
          root: './packages/persistence',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'i18n',
          root: './packages/i18n',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'ui',
          root: './packages/ui',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'trading',
          root: './packages/trading',
          // Chart and React tests opt into jsdom with a file comment.
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          // Cross-package SSR checks: imports in plain Node, server rendering, hydration (jsdom per file).
          name: 'ssr',
          root: './tests',
          environment: 'node',
          include: ['ssr/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          // Publishing and repository hygiene (package manifests, ignore rules, secret scan).
          name: 'repo',
          root: './tests',
          environment: 'node',
          include: ['repo/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          // The documentation site's own components (Markdown renderer, settings).
          name: 'docs',
          root: './apps/docs',
          environment: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'react',
          root: './packages/react',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
