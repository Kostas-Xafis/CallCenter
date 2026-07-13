import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Use tsx for TypeScript transformation
        globals: false,
    },
    resolve: {
        alias: {
            '@src': path.resolve(import.meta.dirname!, 'src'),
            '@_types': path.resolve(import.meta.dirname!, 'types'),
        },
    },
});
