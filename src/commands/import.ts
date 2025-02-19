import { Command } from 'commander';

export function command(program: Command): Command {
	program
		.command('import')
		.argument('<file>')
		.description('Import contentful entries from xlsx spreadsheet')
		.action((args, options) => {
			console.log('import', args, options);
		});

	return program;
}
