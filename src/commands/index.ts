import { command as cmdDiff } from '@/commands/diff';
import { command as cmdExport } from '@/commands/export';
import { command as cmdImport } from '@/commands/import';
import { command as cmdInit } from '@/commands/init';
import { Command } from 'commander';

export function addCommandHandlers(program: Command): Command {
	cmdInit(program);
	cmdImport(program);
	cmdExport(program);
	cmdDiff(program);

	return program;
}
