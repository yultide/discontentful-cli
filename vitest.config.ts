import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		server: {
			deps: {
				inline: ['vitest-console'],
			},
		},
		setupFiles: ['vitest.setup.ts'],
		coverage: {
			exclude: [...(configDefaults.coverage.exclude || []), 'src/types'],
			// you can include other reporters, but 'json-summary' is required, json is recommended
			reporter: ['text', 'json-summary', 'json'],
			// If you want a coverage reports even if your tests are failing, include the reportOnFailure option
			reportOnFailure: true,
		},
	},
});
