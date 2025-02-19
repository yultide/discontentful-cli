#! /usr/bin/env node
import { addCommandHandlers } from '@/commands';
import { packageJSON } from '@/utils/packageJson.js';
import { renderTitle } from '@/utils/renderTitle.js';
import { Command } from 'commander';

renderTitle();

const program = new Command();

program
	.name('contentful-tools-cli')
	.description('Contentful Tools CLI')
	.version(packageJSON.version);

addCommandHandlers(program);

program.parse();
