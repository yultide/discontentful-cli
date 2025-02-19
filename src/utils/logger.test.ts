import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { mockConsole } from 'vitest-console';
import { logger } from './logger';

describe('renderTitle', () => {
	const { clearConsole, restoreConsole } = mockConsole({ quiet: true });
	afterEach(clearConsole);
	afterAll(restoreConsole);

	test('should log info', () => {
		logger.info('info');
		expect(console).toHaveLoggedTimes(1);
	});

	test('should log warn', () => {
		logger.warn('warn');
		expect(console).toHaveLoggedTimes(1);
	});

	test('should log succeed', () => {
		logger.succeed('succeed');
		expect(console).toHaveLoggedTimes(1);
	});

	test('should log error', () => {
		logger.error('error');
		expect(console).toHaveLoggedTimes(1);
	});
});
