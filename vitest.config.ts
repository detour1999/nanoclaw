import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'setup/**/*.test.ts',
      // Kept outside agent-runner/src: that directory is copied verbatim into
      // every group's container as /app/src and recompiled there, where vitest
      // is not installed.
      'container/agent-runner/test/**/*.test.ts',
    ],
  },
});
