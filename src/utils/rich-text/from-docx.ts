import { commandExists } from '@/utils';
import { execSync } from 'child_process';
import { pandocError } from '.';
import { richTextFromMarkdown } from './from-markdown';

export function checkPandoc() {
	if (!commandExists('pandoc')) {
		throw pandocError();
	}
}

export function escapeFilename(filename: string) {
	return (
		filename
			.trim()
			.replace(/[\\"']/g, '\\$&')
			// eslint-disable-next-line no-control-regex
			.replace(/\u0000/g, '\\0')
	);
}

export async function richTextFromDocx(filename: string) {
	checkPandoc();
	const escapedFilename = escapeFilename(filename);
	const md = execSync(`pandoc -f docx -t markdown_mmd+hard_line_breaks+startnum "${escapedFilename}"`).toString();
	return richTextFromMarkdown(md);
}

export async function textFromDocx(filename: string) {
	checkPandoc();
	const escapedFilename = escapeFilename(filename);
	const md = execSync(`pandoc -f docx -t plain "${escapedFilename}"`).toString();
	return md;
}

export async function markdownFromDocx(filename: string) {
	checkPandoc();
	const escapedFilename = escapeFilename(filename);
	const md = execSync(`pandoc -f docx -t markdown_mmd+hard_line_breaks+startnum-raw_html "${escapedFilename}"`).toString();
	return md;
}
