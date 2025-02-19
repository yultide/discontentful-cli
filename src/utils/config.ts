import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface Config {
	pat: string; // personal access token
}

const defaultConfigName = '.ctt.json';

export function getConfig(configName = defaultConfigName): Config {
	const configPath = path.join(os.homedir(), configName);
	if (fs.existsSync(configPath)) {
		const cfg = fs.readFileSync(configPath).toString();
		return JSON.parse(cfg) as Config;
	}
	return {} as Config;
}

export function saveConfig(config: Config, configName = defaultConfigName): Config {
	const configPath = path.join(os.homedir(), configName);
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
	return config;
}
