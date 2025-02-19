import { getConfig, saveConfig } from '@/utils/config';
import { createClient, promptContentfulToken, promptEnvConfig, promptSpaceConfig } from '@/utils/contentful';
import chalk from 'chalk';
import { Command } from 'commander';

export function command(program: Command): Command {
	program
		.command('init')
		.description('Initialize personal access token credentials')
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		.action(async (args, options) => {
			const config = getConfig();
			const cred = await promptContentfulToken(config.cmaToken);
			config.cmaToken = cred.token;
			console.log(`Hi ${chalk.cyan(cred.user.firstName)}, let's get you setup.`);
			const client = createClient(cred.token);
			const spaceId = await promptSpaceConfig(config.spaceId, client);
			config.spaceId = spaceId;
			const envId = await promptEnvConfig(config.spaceId, config.envId, client);
			config.envId = envId;
			saveConfig(config);
		});

	return program;
}
