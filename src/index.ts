#! /usr/bin/env node
import { addCommandHandlers } from '@/commands';
import { packageJSON } from '@/utils/packageJson';
import { renderTitle } from '@/utils/renderTitle';
import { Command } from 'commander';

// renderTitle();

const program = new Command();

program.name('ct').description(`Contentful Tools CLI (${packageJSON.version})`).version(packageJSON.version).addHelpText('before', renderTitle());

addCommandHandlers(program);

program.parse();
