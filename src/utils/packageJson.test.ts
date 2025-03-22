import { packageJSON } from '@/utils/packageJson';
import { describe, expect, test } from 'vitest';

describe('packageJSON', () => {
	test('should return version correctly ', async () => {
		const ver = packageJSON.version;
		const parts = ver.split('.');
		expect(parts.length).toEqual(3);
	});
});
