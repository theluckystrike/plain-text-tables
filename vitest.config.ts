import { defineConfig } from 'vitest/config';

// obsidian ships typings only, so tests run against obsidian-test-mocks in happy-dom.
// The editor tests (tests/harness.ts) need one copy of @codemirror/state and @codemirror/view: dedupe and inline them.
export default defineConfig({
	resolve: { alias: { obsidian: 'obsidian-test-mocks/obsidian' }, dedupe: ['@codemirror/state', '@codemirror/view'] },
	test: {
		environment: 'happy-dom',
		setupFiles: ['obsidian-test-mocks/vitest-setup'],
		include: ['tests/**/*.test.ts'],
		server: { deps: { inline: [/@codemirror/, /obsidian-test-mocks/] } },
		// Large-input regression tests need more than 5 seconds on shared CI runners.
		testTimeout: 30000,
	},
});
