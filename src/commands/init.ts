import { Command } from 'commander';

export function command(program: Command): Command {
	program
		.command('init')
		.description('Initialize personal access token credentials')
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		.action((args, options) => {
			console.log('init');
		});

	return program;
}
