import { describe, expect, test } from 'vitest';
import { readFile } from '..';
import { richTextFromMarkdown } from './from-markdown';

describe('richTextFromMarkdown', () => {
	test('should return version correctly ', async () => {
		const md = readFile('./tests/fixtures/markdown.md');
		const rtExpected = JSON.parse(readFile('./tests/fixtures/markdown-to-richtext-expected.json'));
		const richText = await richTextFromMarkdown(md);
		expect(richText).toEqual(rtExpected);
	});
});
