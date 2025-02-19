import chalk from 'chalk';

export { richTextFromDocx, textFromDocx, markdownFromDocx } from './from-docx';
export { richTextFromHtml } from './from-html';
export { richTextFromMarkdown } from './from-markdown';
export { richTextToMarkdown } from './to-markdown';

export function pandocError() {
	new Error(`Please install ${chalk.yellow('pandoc')}
* Document on installation: ${chalk.green('https://pandoc.org/installing.html')}
* Windows: ${chalk.cyan('scoop install pandoc')}
* Mac: ${chalk.cyan('brew install pandoc')}
`);
}
