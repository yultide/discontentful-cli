import { getConfig, saveConfig } from '@/utils/config';
import { createClientFromConfig } from '@/utils/contentful';
import { logger } from '@/utils/logger';
import chalk from 'chalk';
import { Command } from 'commander';

export function command(program: Command): Command {
	program
		.command('env')
		.argument('<environment>')
		.description('Change environments')
		.action(async (newEnvId) => {
			const config = getConfig();
			if (newEnvId === config.envId) {
				logger.succeed(`environment set to ${chalk.yellow(newEnvId)}`);
				return;
			}

			const { client } = await createClientFromConfig();
			const space = await client.getSpace(config.spaceId);
			try {
				await space.getEnvironment(newEnvId);
			} catch {
				logger.error(`environment ${chalk.yellow(newEnvId)} doesn't exist`);
				return;
			}
			const prevEnvId = config.envId;
			config.envId = newEnvId;
			saveConfig(config);
			logger.info(`changed environment ${chalk.green(prevEnvId)} ->  ${chalk.yellow(newEnvId)}`);
		});

	return program;
}
