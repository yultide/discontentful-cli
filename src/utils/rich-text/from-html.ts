import { commandExists } from '@/utils';
import { execSync } from 'child_process';
import { unlinkSync, writeFileSync } from 'fs';
import { pandocError } from '.';
import { richTextFromMarkdown } from './from-markdown';

export async function richTextFromHtml(html: string) {
	if (!commandExists('pandoc')) {
		throw pandocError();
	}

	const htmlfile = `dm-be-html-tmp.html`;
	writeFileSync(htmlfile, html);
	const md = execSync(`pandoc -f html -t markdown_mmd+hard_line_breaks+startnum "${htmlfile}"`).toString();
	unlinkSync(htmlfile);
	return richTextFromMarkdown(md);
}
