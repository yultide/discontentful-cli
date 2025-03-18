import { Asset, Environment } from 'contentful-management';
import { describe, expect, it, vi } from 'vitest';
import { createLink } from '../utils/contentful';
import { richTextFromMarkdown } from '../utils/rich-text/from-markdown';
import { createLinks, parseValue, ParseValueContext, ParseValueOptions } from './import';

const context = {
	fieldName: 'field',
	contentType: {
		sys: {
			id: 'testModel',
		},
		fields: [
			{
				id: 'field',
			},
		],
	},
} as ParseValueContext;

describe('parseValue', () => {
	it('should parse correctly', async () => {
		const d = new Date();
		const testCases: { value: string | Date | undefined; expected: unknown }[] = [
			{ value: d, expected: d.toISOString() },
			{ value: undefined, expected: undefined },
			{ value: 'links:entry1,entry2', expected: createLinks(['entry1', 'entry2'], 'Entry') },
			{
				value: 'links:entry1,entry2,asset:asset1,asset:asset2',
				expected: [...createLinks(['entry1', 'entry2'], 'Entry'), ...createLinks(['asset1', 'asset2'], 'Asset')],
			},
			{ value: 'link:entry1', expected: createLink('entry1', 'Entry') },
			{ value: 'assets:asset1,asset2', expected: createLinks(['asset1', 'asset2'], 'Asset') },
			{ value: 'asset:asset1', expected: createLink('asset1', 'Asset') },
			{ value: 'array:a,b,c', expected: ['a', 'b', 'c'] },
			{ value: `jsonlist:a,b,c`, expected: ['a', 'b', 'c'] },
			{ value: 'bool:true', expected: true },
			{ value: 'bool:xxx', expected: false },
			{ value: 'number:123.123', expected: 123.123 },
			{ value: `json:{"foo":"bar"}`, expected: { foo: 'bar' } },
			{ value: `richtext:{"document":{}}`, expected: { document: {} } },
			{ value: 'jsonfile:./tests/fixtures/foobar.json', expected: { foo: 'bar' } },
			{ value: 'tags:tag1,tag2', expected: createLinks(['tag1', 'tag2'], 'Tag') },
			{ value: 'markdown:# Hello World', expected: await richTextFromMarkdown('# Hello World') },
			{ value: 'markdownfile:./tests/fixtures/helloworld.md', expected: await richTextFromMarkdown('# Hello World\n') },
			{ value: 'date:2020-11-11', expected: new Date('2020-11-11').toISOString() },
			{ value: 'foo\nbar\n', expected: 'foo  \nbar  \n' },
			{ value: 'foo:bar', expected: 'foo:bar' },
		];

		for (const tc of testCases) {
			expect(await parseValue(tc.value, { context })).toEqual(tc.expected);
		}
	});

	it('should parse markdown w/ embedded assetfile: correctly', async () => {
		const assetFileCache: Record<string, string> = {};
		assetFileCache['./tests/fixtures/images/image.png'] = '1234';
		assetFileCache['./tests/fixtures/images/frame.jpg'] = '4567';

		const createAssetFromFiles = vi.fn();
		const opt: ParseValueOptions = {
			context: { ...context, assetFileCache },
			cmClient: {
				createAssetFromFiles,
			} as unknown as Environment,
		};
		const mockAsset = {
			sys: {
				id: '1234',
			},
			metadata: {},
			update: vi.fn(),
			processForLocale: vi.fn(),
		};
		createAssetFromFiles.mockImplementation((input: Asset) => {
			const filename = input.fields.title['en-US'];
			const mockFn = vi.fn();
			const asset = {
				...mockAsset,
				sys: {
					id: assetFileCache[`./tests/fixtures/images/${filename}`],
				},
				update: mockFn,
				processForLocale: mockFn,
			};
			mockFn.mockResolvedValue(asset);
			return asset;
		});
		const md = [
			'markdown:# embedded asset 1',
			'![embedded-asset-block](assetfile:./tests/fixtures/images/image.png)',
			'# embedded asset 2',
			'![embedded-asset-block](assetfile:./tests/fixtures/images/frame.jpg)',
		].join('\n');
		const result = await parseValue(md, opt);
		expect(result).toEqual({
			nodeType: 'document',
			data: {},
			content: [
				{
					nodeType: 'heading-1',
					content: [
						{
							nodeType: 'text',
							value: 'embedded asset 1',
							marks: [],
							data: {},
						},
					],
					data: {},
				},
				{
					nodeType: 'embedded-asset-block',
					content: [],
					data: {
						target: {
							sys: {
								type: 'Link',
								linkType: 'Asset',
								id: '1234',
							},
						},
					},
				},
				{
					nodeType: 'heading-1',
					content: [
						{
							nodeType: 'text',
							value: 'embedded asset 2',
							marks: [],
							data: {},
						},
					],
					data: {},
				},
				{
					nodeType: 'embedded-asset-block',
					content: [],
					data: {
						target: {
							sys: {
								type: 'Link',
								linkType: 'Asset',
								id: '4567',
							},
						},
					},
				},
			],
		});
	});
});
