import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
	[
		{
			ignores: ['dist', '*.cjs', '*.mjs'],
		},
	],
	eslint.configs.recommended,
	tseslint.configs.strict,
	prettierConfig,
);
