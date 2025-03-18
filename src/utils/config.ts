import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Config {
	cmaToken: string; // personal access token
	cdToken: string; // delivery token
	cpToken: string; // preview token
	spaceId: string; // space id
	envId: string; // env id
}

const defaultConfigName = '.dc.config.json';

export function getConfig(configName = defaultConfigName): Config {
	const configPath = path.join(os.homedir(), configName);
	if (fs.existsSync(configPath)) {
		const cfg = fs.readFileSync(configPath).toString();
		return JSON.parse(cfg) as Config;
	}
	return {
		cmaToken: '',
		cdToken: '',
		cpToken: '',
		spaceId: '',
		envId: '',
	};
}

export function saveConfig(config: Config, configName = defaultConfigName): Config {
	const configPath = path.join(os.homedir(), configName);
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
	return config;
}
