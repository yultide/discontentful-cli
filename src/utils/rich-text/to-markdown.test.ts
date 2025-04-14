import { describe, expect, test } from 'vitest';
import { readFile } from '..';
import { richTextToMarkdown } from './to-markdown';

describe('richTextToMarkdown', () => {
	test('should convert richtext to markdown correctly ', async () => {
		const mdExpected = readFile('./tests/fixtures/markdown-expected.md');
		const rt = JSON.parse(readFile('./tests/fixtures/markdown-to-richtext-expected.json'));
		const md = await richTextToMarkdown(rt);
		expect(md).toEqual(mdExpected);
	});
});
