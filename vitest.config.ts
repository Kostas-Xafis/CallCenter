import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        // Miniflare needs a longer timeout for D1 operations
        testTimeout: 15000,
        hookTimeout: 15000,
    },
    resolve: {
        alias: {
            '@src': path.resolve(__dirname, 'src'),
            '@_types': path.resolve(__dirname, 'types'),
        },
    },
});
