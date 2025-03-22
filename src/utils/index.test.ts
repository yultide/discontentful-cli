import cp from 'node:child_process';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { commandExists, downloadFile, isDateString, notEmpty, openFile, readFile, readJsonFile, sleep, writeFile } from '.';

describe('notEmpty', () => {
	test('to return false on undefined and null', () => {
		expect(notEmpty(null)).toEqual(false);
		expect(notEmpty(undefined)).toEqual(false);
	});
	test('to return true on valid values', () => {
		expect(notEmpty({})).toEqual(true);
		expect(notEmpty('')).toEqual(true);
		expect(notEmpty([])).toEqual(true);
		expect(notEmpty(0)).toEqual(true);
		expect(notEmpty(false)).toEqual(true);
	});
});

describe('readFile', () => {
	test('should read a text file correctly', () => {
		expect(readFile('tests/fixtures/helloworld.md')).toEqual('# Hello World\n');
	});
	test('should throw error reading non-existant file', () => {
		expect(() => readFile('file-does-not-exist')).toThrowError();
	});
});

describe('readJsonFile', () => {
	test('should read a json file correctly', () => {
		expect(readJsonFile('tests/fixtures/foobar.json')).toEqual({ foo: 'bar' });
	});
	test('should throw error reading non-existant file', () => {
		expect(() => readJsonFile('file-does-not-exist')).toThrowError();
	});
	test('should throw error reading non json file', () => {
		expect(() => readJsonFile('tests/fixtures/helloworld.md')).toThrowError();
	});
});

describe('writeFile', () => {
	test('should write a text file correctly', () => {
		const content = '# Test Markdown\n';
		writeFile('test.md', content);
		expect(readFile('test.md')).toEqual(content);
		if (fs.existsSync('test.md')) {
			fs.unlinkSync('test.md');
		}
	});
});

describe('downloadFile', () => {
	test('should download url correctly', async () => {
		const url = 'https://www.google.com/robots.txt';
		const contentType = await downloadFile(url, 'robots.txt');
		expect(contentType).toEqual('text/plain');
		expect(readFile('robots.txt')).toContain('User-agent: *');
		if (fs.existsSync('robots.txt')) {
			fs.unlinkSync('robots.txt');
		}
	});
});

describe('openFile', () => {
	const originalPlatform = process.platform;

	afterEach(() => {
		vi.restoreAllMocks();

		Object.defineProperty(process, 'platform', {
			value: originalPlatform,
			writable: true,
		});
	});

	test('should open a file correctly', async () => {
		const execSyncMock = vi.spyOn(cp, 'execSync');
		execSyncMock.mockImplementation(() => '');

		const filepath = 'tests/fixtures/contentful-import-test.xlsx';
		const testCases = [
			{
				platform: 'linux',
				expected: `open "${filepath}"`,
			},
			{
				platform: 'darwin',
				expected: `open "${filepath}"`,
			},
			{
				platform: 'win32',
				expected: `explorer "${filepath}"`,
			},
		];
		for (const t of testCases) {
			// test linux
			Object.defineProperty(process, 'platform', {
				value: t.platform, // or whatever platform you'd like to test
				writable: true,
			});

			openFile(filepath);
			expect(process.platform).toEqual(t.platform);
			expect(execSyncMock).toBeCalledWith(t.expected);
			execSyncMock.mockClear();
		}
	});
});

describe('isDateString', () => {
	test('should accept valid ISO 8601 date-only strings', () => {
		expect(isDateString('2024-03-20')).toBeTruthy();
		expect(isDateString('2024-01-01')).toBeTruthy();
		expect(isDateString('2024-12-31')).toBeTruthy();
		expect(isDateString('2024-02-29')).toBeTruthy(); // Leap year
	});

	test('should accept valid ISO 8601 date-time strings', () => {
		expect(isDateString('2024-03-20T15:30:00')).toBeTruthy();
		expect(isDateString('2024-03-20T15:30:00.123')).toBeTruthy();
		expect(isDateString('2024-03-20T15:30:00.123456')).toBeTruthy();
	});

	test('should accept valid ISO 8601 date-time strings with timezone', () => {
		expect(isDateString('2024-03-20T15:30:00Z')).toBeTruthy();
		expect(isDateString('2024-03-20T15:30:00+01:00')).toBeTruthy();
		expect(isDateString('2024-03-20T15:30:00-05:00')).toBeTruthy();
	});

	test('should reject invalid date strings', () => {
		expect(isDateString('2024-13-20')).toBeFalsy(); // Invalid month
		expect(isDateString('2024-03-32')).toBeFalsy(); // Invalid day
		expect(isDateString('2024-02-30')).toBeFalsy(); // Invalid day in February
		expect(isDateString('2024-02-29')).toBeTruthy(); // Check leap year
		expect(isDateString('2024-03-20T25:00:00')).toBeFalsy(); // Invalid hour
		expect(isDateString('2024-03-20T15:60:00')).toBeFalsy(); // Invalid minute
		expect(isDateString('2024-03-20T15:30:61')).toBeFalsy(); // Invalid second
		expect(isDateString('2024-03-20T15:30:00+25:00')).toBeFalsy(); // Invalid timezone
		expect(isDateString('2024-03-20T15:30:00+01:60')).toBeFalsy(); // Invalid timezone minutes
	});

	test('should reject non-ISO 8601 format strings', () => {
		expect(isDateString('2024/03/20')).toBeFalsy();
		expect(isDateString('03-20-2024')).toBeFalsy();
		expect(isDateString('20-03-2024')).toBeFalsy();
		expect(isDateString('March 20, 2024')).toBeFalsy();
		expect(isDateString('')).toBeFalsy();
		expect(isDateString('not a date')).toBeFalsy();
	});
});

describe('sleep', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('should resolve after specified milliseconds', async () => {
		const ms = 1000;
		const sleepPromise = sleep(ms);

		// Fast-forward timers
		await vi.advanceTimersByTimeAsync(ms);

		// The promise should resolve
		await expect(sleepPromise).resolves.toBeUndefined();
	});

	test('should resolve immediately for 0ms', async () => {
		const sleepPromise = sleep(0);

		// Fast-forward timers
		await vi.advanceTimersByTimeAsync(0);

		// The promise should resolve
		await expect(sleepPromise).resolves.toBeUndefined();
	});
});

describe('commandExists', () => {
	const originalPlatform = process.platform;

	afterEach(() => {
		vi.restoreAllMocks();
		Object.defineProperty(process, 'platform', {
			value: originalPlatform,
			writable: true,
		});
	});

	test('should detect command on Unix-like systems', () => {
		// Mock Unix-like platform
		Object.defineProperty(process, 'platform', {
			value: 'darwin',
			writable: true,
		});

		// Mock successful command check
		const execSyncMock = vi.spyOn(cp, 'execSync');
		execSyncMock.mockReturnValue(Buffer.from('/usr/bin/command'));

		expect(commandExists('git')).toBe(true);
		expect(execSyncMock).toHaveBeenCalledWith('command -v git');
	});

	test('should detect command on Windows', () => {
		// Mock Windows platform
		Object.defineProperty(process, 'platform', {
			value: 'win32',
			writable: true,
		});

		// Mock successful command check
		const execSyncMock = vi.spyOn(cp, 'execSync');
		execSyncMock.mockReturnValue(Buffer.from('C:\\Program Files\\Git\\cmd\\git.exe'));

		expect(commandExists('git')).toBe(true);
		expect(execSyncMock).toHaveBeenCalledWith('where git', { stdio: [] });
	});

	test('should handle non-existent commands', () => {
		// Mock Unix-like platform
		Object.defineProperty(process, 'platform', {
			value: 'darwin',
			writable: true,
		});

		// Mock command not found
		const execSyncMock = vi.spyOn(cp, 'execSync');
		execSyncMock.mockImplementation(() => {
			throw new Error('Command not found');
		});

		expect(commandExists('nonexistent-command')).toBe(false);
	});

	test('should handle special characters in command names', () => {
		// Mock Unix-like platform
		Object.defineProperty(process, 'platform', {
			value: 'darwin',
			writable: true,
		});

		// Mock successful command check
		const execSyncMock = vi.spyOn(cp, 'execSync');
		execSyncMock.mockReturnValue(Buffer.from('/usr/bin/command'));

		expect(commandExists('command-with-special-chars!@#$')).toBe(true);
		expect(execSyncMock).toHaveBeenCalledWith("command -v 'command-with-special-chars!@#$'");
	});

	test('should handle empty command names', () => {
		expect(commandExists('')).toBe(false);
	});
});
