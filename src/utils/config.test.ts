import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { getConfig, saveConfig } from './config.js';

describe('getConfig', () => {
	test('should return {} for a non existing config', () => {
		const cfg = getConfig('does-not-exist.cfg');
		expect(cfg).toEqual({});
	});
	test('should return correct config', () => {
		const configName = 'test-config.cfg';
		const configPath = path.join(os.homedir(), configName);
		const testConfig = { pat: 'abcdef12345' };
		fs.writeFileSync(configPath, JSON.stringify(testConfig));

		const cfg = getConfig(configName);
		expect(cfg).toEqual(testConfig);

		fs.unlinkSync(configPath);
	});
});

describe('saveConfig', () => {
	test('should save config file properly', () => {
		const configName = 'test-config.cfg';
		const configPath = path.join(os.homedir(), configName);
		const testConfig = { pat: 'abcdef12345' };

		const cfg = saveConfig(testConfig, configName);
		expect(cfg).toEqual(testConfig);

		const writtenConfig = JSON.parse(fs.readFileSync(configPath).toString());
		expect(writtenConfig).toEqual(cfg);

		fs.unlinkSync(configPath);
	});
});
