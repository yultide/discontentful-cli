import { Command } from 'commander';

export function command(program: Command): Command {
	program
		.command('diff')
		.argument('<lowerEnv>')
		.argument('<higherEnv>')
		.description('Get the diff between two environments')
		.action((args, options) => {
			console.log('diff', args, options);
		});

	return program;
}
