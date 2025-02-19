import { Command } from 'commander';

export function command(program: Command): Command {
	program
		.command('export')
		.argument('<file>')
		.description('Export contentful entries to xlsx spreadsheet')
		.action((args, options) => {
			console.log('import', args, options);
		});

	return program;
}
