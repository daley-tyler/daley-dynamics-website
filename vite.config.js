import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        work: resolve(import.meta.dirname, 'work/index.html'),
        serverKnowledge: resolve(
          import.meta.dirname,
          'work/business-server-knowledge-system/index.html',
        ),
        operationalAnalytics: resolve(import.meta.dirname, 'work/operational-analytics/index.html'),
        capabilities: resolve(import.meta.dirname, 'capabilities/index.html'),
        about: resolve(import.meta.dirname, 'about/index.html'),
        startProject: resolve(import.meta.dirname, 'start-a-project/index.html'),
      },
    },
  },
});
