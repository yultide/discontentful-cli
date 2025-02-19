#! /usr/bin/env node
import { Command } from 'commander';
import { packageJSON } from 'utils/packageJson.js';
import { renderTitle } from 'utils/renderTitle.js';

renderTitle();

const program = new Command();

program
	.name('contentful-tools-cli')
	.description('Contentful Tools CLI')
	.version(packageJSON.version);

program
	.command('init')
	.description('Intiailize Contentful credentials')
	.action((str, options) => {
		console.log(packageJSON.version);
	});

program.parse();
