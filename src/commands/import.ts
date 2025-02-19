import { compressImage, downloadFile, Maybe, notEmpty, readFile, readJsonFile, writeFile } from '@/utils';
import {
	createAsset,
	createClientFromConfig,
	createLink,
	Entity,
	File,
	getContentType,
	getEntry,
	getModel,
	getOrCreateEntry,
	isPublished,
	protectedPublish,
	updateEntry,
	updateTags,
	validateFieldType,
} from '@/utils/contentful';
import { ColumnNameAlias, getAllLocales, localeAliases } from '@/utils/contentful-locales';
import { getEnglishIndex, loadWorkbook, lowerCaseRow, Row, saveWorkbook, worksheetToJson } from '@/utils/excel';
import { logger } from '@/utils/logger';
import { markdownFromDocx, richTextFromDocx, richTextFromHtml, textFromDocx } from '@/utils/rich-text';
import { richTextFromMarkdown } from '@/utils/rich-text/from-markdown';
import { Node } from '@contentful/rich-text-types';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import { ContentType, Entry, Environment, Link } from 'contentful-management';
import exceljs from 'exceljs';
import mime from 'mime-types';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

export type LinkType = 'Entry' | 'Asset' | 'Tag' | 'Upload';

interface EntryToPatch {
	entryId: string;
	fieldName: string;
	prefix: string;
	value: unknown;
	cell: exceljs.Cell;
}

interface LocalizedField {
	[x: string]: {
		[x: string]: unknown;
	};
}

const columnNameAlias: ColumnNameAlias[] = [
	{ id: 'sysid', alias: ['sys/id', 'entry id', 'entryid'] },
	{ id: 'model', alias: ['modelname', 'model name'] },
	{ id: 'field', alias: ['fieldName', 'field name'] },
];

export interface MarkdownNode extends MarkdownTree {
	depth: string;
	type: string;
	ordered: boolean;
	value: string;
	start?: number;
}

export interface MarkdownTree {
	children: MarkdownNode[];
}

// COMPAT: can resolve with either Node or an array of Nodes for back compatibility.
export type FallbackResolver = (mdNode: MarkdownNode, appliedMarksTypes: string[]) => Promise<Node | Node[] | null>;

export const assetFileCache: Record<string, string> = {};

// // fake content type for assets
// const assetContentType: ContentType = {
// 	sys: {
// 		id: 'asset',
// 	},
// 	fields: [
// 		{
// 			type: 'Symbol',
// 			id: 'title',
// 			name: 'title',
// 			required: false,
// 			localized: false,
// 		},
// 		{
// 			type: 'Text',
// 			id: 'description',
// 			name: 'description',
// 			required: false,
// 			localized: false,
// 		},
// 		{
// 			type: 'JSON',
// 			id: 'file',
// 			name: 'file',
// 			required: false,
// 			localized: false,
// 		},
// 	],
// } as ContentType;

// const releaseContentType: ContentType = {
// 	sys: {
// 		id: 'release',
// 	},
// 	fields: [
// 		{
// 			id: 'title',
// 			type: 'Title',
// 			name: 'title',
// 			required: true,
// 			localized: false,
// 		},
// 		{
// 			id: 'entities',
// 			name: 'Entities',
// 			type: 'Array',
// 			localized: false,
// 			required: false,
// 			validations: [],
// 			disabled: false,
// 			omitted: false,
// 			items: {
// 				type: 'Link',
// 				linkType: 'Entry',
// 			},
// 		},
// 	],
// } as ContentType;

export interface ParseValueContext extends Record<string, unknown> {
	updatedValue?: string;
	fieldName?: string;
	contentType?: ContentType;
}

export interface ParseValueOptions {
	escape?: string;
	newValueHandler?: (prefix: 'links' | 'link' | 'asset', value: string | string[]) => void;
	context?: ParseValueContext;
	cmClient?: Environment;
}

// map of new-XXX to entry id for newly created entries
const newEntryMap: Record<string, string> = {};
// list of entries to patch links for new-XXX entries
const linkedEntriesToPatch: EntryToPatch[] = [];

interface Options {
	skip?: string;
	publish?: 'all' | 'preserve';
	tags?: string;
}

export function command(program: Command): Command {
	program
		.command('import')
		.option('-s, --skip <number>', 'skip rows', '0')
		.addOption(new Option('-p, --publish <string>', 'publish after updating').choices(['all', 'preserve']))
		.option('-t, --tags <string>', 'add tags to all entries')
		.argument('<file>')
		.summary('Import contentful entries from xlsx spreadsheet')
		.description(
			`Create or update fields in an entry.

  Required fields are ${chalk.cyan('Entry ID, Entry Model, Field Name, English')}
  To create new entries, set the entry id as ${chalk.cyan('new-XXXX')} (e.g. ${chalk.green('new-123,new-foo,new-bar')})

  Supported value prefixes:
  - ${chalk.cyan('links:')} - entry links with comma separated values (e.g. ${chalk.green('links:66iJXokY3NxptpRyZaPA8K,571hHKmL6ypMPQHptUF8KV')})
  - ${chalk.cyan('addlinks:')} - appends entry links with comma separated values (e.g. ${chalk.green('links:66iJXokY3NxptpRyZaPA8K,571hHKmL6ypMPQHptUF8KV')})
  - ${chalk.cyan('sheetlinks:')} - entry links defined by another sheet (e.g. ${chalk.green('sheetlinks:new-sheet-name')})
  - ${chalk.cyan('link:')} - a single entry link (e.g. ${chalk.green('link:66iJXokY3NxptpRyZaPA8K')})
  - ${chalk.cyan('assets:')} - asset links to comma separated assets   (e.g. ${chalk.green('assets:3VtLb74F43DLfYSDCrOEeR,5AyRGYLK1Vo6CyRNCEfKMv')})
  - ${chalk.cyan('asset:')} - a single asset link  (e.g. ${chalk.green('asset:3VtLb74F43DLfYSDCrOEeR')})
  - ${chalk.cyan('assetfile:')} - an asset from a local file and link to entry (e.g. ${chalk.green('assetfile:image.png')})
  - ${chalk.cyan('asseturl:')} - an asset from a url and link to entry (e.g. ${chalk.green('asseturl:https://www.google.com/favicon.ico')})
  - ${chalk.cyan('clear:')} - clear the current field
  - ${chalk.cyan('compressasset:')} - compress the specified asset by converting to jpg
  - ${chalk.cyan('image:')} - alias for ${chalk.cyan('assetfile:')} and ${chalk.cyan('asseturl:')}
  - ${chalk.cyan('tags:')} - metadata tags for the entry (${chalk.cyan('Field Name')} must be ${chalk.green('metadata')})
  - ${chalk.cyan('array:')} - comma separated string (e.g ${chalk.green('array:foo,bar,baz -> ["foo","bar","baz"]')})
  - ${chalk.cyan('bool:')} - coerces value to be a boolean
  - ${chalk.cyan('number:')} - coerces value to be a number (integer or float)
  - ${chalk.cyan('string:')} - coerces value to be a string
  - ${chalk.cyan('json:')} - parses the string into a json structure
  - ${chalk.cyan('jsonfile:')} - parses the json structure from a file
  - ${chalk.cyan('markdown:')} - parses markdown text into Contentful Rich Text
  - ${chalk.cyan('markdownfile:')} - parses markdown file into Contentful Rich Text
  - ${chalk.cyan('docx:')} - parses Word .docx file into Contentful Rich Text
  - ${chalk.cyan('docx2txt:')} - parses Word .docx file into text (not markdown)
  - ${chalk.cyan('docx2md:')} - parses Word .docx file into markdown text
  - ${chalk.cyan('html:')} - parses HTML text into Contentful Rich Text
  - ${chalk.cyan('htmlfile:')} - parses HTML file into Contentful Rich Text
  - ${chalk.cyan('date:')} - coerces value to be a date (value must be ISO-8601 format)
  - ${chalk.cyan('upload:')} - upload an asset to file field (${chalk.cyan('Model Name')} must be ${chalk.green(
		'asset',
	)} and ${chalk.cyan('Field Name')} must be ${chalk.green('file')})
`,
		)
		.action(async (file, options: Options) => {
			const fullpath = path.resolve(file);
			const { env: client } = await createClientFromConfig();

			const workbook = await loadWorkbook(fullpath);
			const sheets = [workbook.worksheets[0]];
			for (const worksheet of sheets) {
				let modified = false;
				logger.info(`Processing worksheet ${chalk.yellow(worksheet.name)}...`);
				[modified] = await parseImport(workbook, worksheet, client, options);
				if (modified) {
					saveWorkbook(workbook, fullpath);
				}
			}
		});

	return program;
}

/**
 * Parse worksheet to process batch edit command
 * @param {Worksheet} sheet worksheet to parse
 * @param {Environment} cmClient Contentful client API
 * @param {string} publish publish flag
 * @param {number} skip number of rows to skip
 * @returns {[boolean, string[]]} modified flag and entry ids
 */
export async function parseImport(workbook: exceljs.Workbook, sheet: exceljs.Worksheet, cmClient: Environment, options: Options): Promise<[boolean, Entry[]]> {
	const data = normalizeColumns(worksheetToJson(sheet), [...columnNameAlias, ...localeAliases]);
	const skip = parseInt(options.skip || '0', 10);
	const publish = options.publish || '';

	// validate columns
	const requiredColumns = ['sysid', 'field', 'model', 'en-US'];
	const requiredColumnsFound = validateRequiredColumns(data, columnNameAlias, requiredColumns);
	if (!requiredColumnsFound.ok) {
		console.error(`${chalk.red('[ERROR]')} missing ${requiredColumnsFound.missingColumns}`);
		throw new Error('Unable to find all required columns');
	}

	const englishIndex = getEnglishIndex(sheet);

	let currentEntry: Maybe<Entity>;
	let modified = false;
	const entries: Entry[] = [];
	const size = data.length;

	logger.start('Starting batch edit');

	// start with skip which is passed in as 1 based offset plus skip first row for headers
	let i = 0;
	if (skip > 0) {
		logger.info(`Skipping ${chalk.yellow(skip)} rows`);
		i = skip - 2;
	}
	let localizedContent: Maybe<LocalizedField>;

	const models: Record<string, ContentType> = {};

	const allLocales = getAllLocales();

	for (; i < data.length; i += 1) {
		const row = data[i];
		const lcRow = lowerCaseRow(row);
		for (const [key, value] of Object.entries(row)) {
			lcRow[key.toLowerCase().trim()] = value;
		}
		let entryId = getColumnValue(lcRow, 'sysid');

		// skip __ prefix
		if (entryId && entryId.startsWith('__')) {
			continue;
		}
		const fieldName = getColumnValue(lcRow, 'field');

		// model can be omitted
		const entryModel = getColumnValue(lcRow, 'model') || currentEntry?.sys.contentType.sys.id || '';

		const model = await getModel(cmClient, entryModel, models);

		// figure out if we need to create a new entry or reuse an old entry
		if (!currentEntry) {
			currentEntry = await getOrCreateEntry(cmClient, entryModel, entryId, newEntryMap);
			if (!currentEntry) {
				throw new Error(`[${chalk.redBright('ERROR')}] skipping row ${i + 1} failed to create new entry`);
			}
			logger.succeed();
			logger.start(`${chalk.yellow(`${i + 1}/${size}`)} updating ${chalk.blue(`${entryModel}.${fieldName}`)} ${chalk.green(currentEntry.sys.id)}`);

			// update row
			if (entryId !== currentEntry.sys.id) {
				entryId = currentEntry.sys.id;
				const cell = sheet.getRow(i + 2).getCell(1);
				cell.value = entryId;
				modified = true;
			}
			entries.push(currentEntry as Entry);

			localizedContent = {
				[fieldName]: {},
			};
		} else if (entryId && currentEntry.sys.id !== entryId) {
			const inPublishedState = isPublished(currentEntry);
			if (options.tags) {
				updateTags(currentEntry, options.tags.split(','));
			}
			currentEntry = await updateEntry(currentEntry);
			currentEntry = await protectedPublish(inPublishedState, publish, currentEntry);

			logger.succeed(`${chalk.yellow(`${i}/${size}`)} succeeded updating ${chalk.blue(getContentType(currentEntry))} "${chalk.green(currentEntry?.sys.id)}"`);

			currentEntry = await getOrCreateEntry(cmClient, entryModel, entryId, newEntryMap);
			if (!currentEntry) {
				const msg = `[${chalk.redBright('ERROR')}] skipping row ${i + 1} failed to create new entry`;
				logger.error(msg);
				throw new Error(msg);
			}
			entries.push(currentEntry as Entry);

			logger.start(`${chalk.yellow(`${i + 1}/${size}`)} updating ${getContentType(currentEntry)}.${fieldName} "${chalk.cyan(entryId)}"`);

			// update row
			if (entryId !== currentEntry.sys.id) {
				entryId = currentEntry.sys.id;
				const cell = sheet.getRow(i + 2).getCell(1);
				cell.value = entryId;
				modified = true;
			}

			localizedContent = {
				[fieldName]: {},
			};
		}

		checkDuplicateField(i + 2, currentEntry.sys.id, entryModel, fieldName);

		for (const locale of allLocales) {
			const value = lcRow[locale.toLowerCase()];
			if (localizedContent && currentEntry && value) {
				const currentEntryId = currentEntry.sys.id;
				if (!localizedContent[fieldName]) {
					localizedContent[fieldName] = {};
				}
				if (util.types.isDate(value)) {
					localizedContent[fieldName][locale] = (value as Date).toISOString();
					continue;
				}

				const index = i;
				const context: ParseValueContext = {
					fieldName,
					contentType: model,
				};
				const parseValueOptions: ParseValueOptions = {
					escape: '',
					context,
					newValueHandler: (prefix, newValue) => {
						// we store the linked entries to patch later
						linkedEntriesToPatch.push({
							entryId: currentEntryId,
							fieldName,
							prefix,
							value: newValue,
							cell: sheet.getRow(index + 2).getCell(englishIndex),
						});
					},
					cmClient,
				};

				if (value.startsWith('addlinks:')) {
					const links = (await parseValue(value.replace('addlinks:', 'links:'), parseValueOptions)) as Link<'Entry'>[];
					const e = currentEntry as Entry;
					const linksValue = (e?.fields[fieldName]?.[locale] || []).concat(links);
					localizedContent[fieldName][locale] = linksValue;
					parseValueOptions.newValueHandler?.(
						'links',
						linksValue.map((l: Link<'Entry'>) => l.sys.id),
					);
					continue;
				} else if (value.startsWith('tags:')) {
					if (fieldName !== 'metadata') {
						throw new Error('tags: can only be used with metadata field name');
					}
					const tags = await parseValue(value, parseValueOptions);
					// only set tags if not release
					if (currentEntry.sys.type !== 'Release') {
						currentEntry.metadata = { ...(currentEntry.metadata || {}), tags };
					}
					delete localizedContent.metadata;
				} else if (value.startsWith('sheetlinks:')) {
					const sheetName = value.replace('sheetlinks:', '');
					const sheetLinks = workbook.getWorksheet(sheetName);
					if (!sheetLinks) {
						return [false, []];
					}
					const [, beEntries] = await parseImport(workbook, sheetLinks, cmClient, options);
					const entryIds = beEntries.map((e) => e.sys.id);
					const linksValue = `links:${entryIds.join(',')}`;
					localizedContent[fieldName][locale] = await parseValue(linksValue, parseValueOptions);
					sheet.getRow(i + 2).eachCell((cell) => {
						if (cell.text === value) {
							cell.value = linksValue;
						}
					});
					modified = true;
				} else {
					localizedContent[fieldName][locale] = await parseValue(value, parseValueOptions);
					// patch the value if updated
					if (context.updatedValue) {
						sheet.getRow(i + 2).eachCell((cell) => {
							if (cell.text === value) {
								// update the cell
								cell.value = context.updatedValue;
							}
						});
						modified = true;
					}
				}
			}
		}
		if (currentEntry) {
			const e = currentEntry;
			e.fields = { ...e.fields, ...localizedContent };
		}
	}

	if (currentEntry) {
		const inPublishedState = isPublished(currentEntry);
		if (options.tags) {
			updateTags(currentEntry, options.tags.split(','));
		}
		currentEntry = await updateEntry(currentEntry as Entry);
		currentEntry = await protectedPublish(inPublishedState, publish, currentEntry);
	}

	// patch entries
	if (linkedEntriesToPatch.length > 0) {
		await patchNewEntries(cmClient, linkedEntriesToPatch, newEntryMap, publish);
		modified = true;
	}

	if (currentEntry) {
		logger.succeed(`${chalk.yellow(`${i}/${size}`)} succeeded updating ${chalk.blue(getContentType(currentEntry))} "${chalk.green(currentEntry?.sys.id)}"`);
	} else {
		logger.succeed('done');
	}

	return [modified, entries];
}

/**
 * Parse excel field value to contentful field value
 * @param inValue
 * @param opt
 * @returns
 */
export async function parseValue(inValue: Maybe<string | Date>, opt: ParseValueOptions = {}) {
	const { cmClient, newValueHandler, context } = opt;

	// try to validate the parse value
	const field = context?.contentType?.fields.find((f) => f.id === context.fieldName);
	if (!context?.contentType?.sys.id || !field) {
		throw new Error(`invalid field ${context?.fieldName} in model ${context?.contentType?.sys.id}`);
	}

	validateFieldType(context?.contentType?.sys.id, field.id, field, inValue);

	if (!inValue) {
		return undefined;
	}
	if (util.types.isDate(inValue)) {
		return (inValue as Date).toISOString();
	}

	const colonIndex = inValue.indexOf(':');
	let prefix = colonIndex > 0 ? inValue.slice(0, colonIndex) : '';
	const value = inValue.slice(colonIndex + 1);

	// we coerce values if the prefix is not defined for certain fields
	if (prefix === '') {
		switch (field.type) {
			case 'Integer':
				prefix = 'number';
				break;
			case 'Array':
				prefix = 'array';
				break;
			case 'Boolean':
				prefix = 'bool';
				break;
			case 'Date':
				prefix = 'date';
				break;
			case 'RichText':
				prefix = 'markdown';
				break;
		}
	}

	switch (prefix) {
		case 'links': {
			const values = value.split(',');
			if (value.includes('new-') && newValueHandler) {
				newValueHandler('links', values);
			}
			return values.map((e) => {
				if (e.startsWith('asset:')) {
					return createLink(e.replace('asset:', ''), 'Asset');
				}
				return createLink(e, 'Entry');
			});
		}
		case 'link': {
			if (value.includes('new-') && newValueHandler) {
				newValueHandler('link', value);
			}
			return createLink(value, 'Entry');
		}
		case 'assets': {
			const values = value.split(',');
			return createLinks(values, 'Asset');
		}
		case 'asset': {
			return createLink(value, 'Asset');
		}
		case 'clear': {
			return null;
		}
		case 'compressasset':
		case 'asseturl':
		case 'image':
		case 'assetFile':
		case 'assetfile': {
			if (!cmClient) {
				throw new Error('upload: not supported w/o cmClient');
			}

			const assetId = assetFileCache[value];
			if (assetId) {
				return createLink(assetId, 'Asset');
			}

			const assetPath = value;
			const isUrl = assetPath.startsWith('http');
			let title = path.basename(assetPath);
			let type = mime.lookup(path.extname(assetPath)) || 'application/octet-stream';
			const description = title;
			let fullpath = isUrl ? `${os.tmpdir()}/asset-${nanoid(8)}` : assetPath;

			if (isUrl) {
				type = await downloadFile(assetPath, fullpath);
			}

			if (!fs.existsSync(fullpath)) {
				throw new Error(`asset file ${fullpath} does not exist`);
			}

			if (prefix === 'compressasset') {
				const [compressedPath] = await compressImage([fullpath]);
				const ext = path.extname(title);
				fullpath = compressedPath;
				title = title.replace(ext, '.jpg');
			}

			const file: File = {
				title,
				type,
				fullpath,
				description,
			};
			const asset = await createAsset(cmClient, file);
			if (isUrl) {
				fs.unlinkSync(fullpath);
			}

			// patch asset
			newValueHandler?.('asset', asset.sys.id);

			assetFileCache[value] = asset.sys.id;
			return createLink(asset.sys.id, 'Asset');
		}
		case 'tags': {
			const values = value.split(',');
			return createLinks(values, 'Tag');
		}
		case 'array':
		case 'jsonlist': {
			return value
				.split(',')
				.map((v) => v.trim())
				.filter((v) => v);
		}
		case 'boolean':
		case 'bool': {
			return value.toLowerCase() === 'true';
		}
		case 'number': {
			return parseFloat(value);
		}
		case 'string': {
			return value.toString();
		}
		case 'richtext':
		case 'json': {
			return JSON.parse(value);
		}
		case 'jsonfile': {
			return readJsonFile(value);
		}
		case 'markdown': {
			// find assets to embed
			const md = await patchAssetfilesInMarkdown(value, cmClient);
			if (md !== value && context) {
				context.updatedValue = `markdown:${md}`;
			}
			return richTextFromMarkdown(md);
		}
		case 'markdownfile': {
			const text = readFile(value);
			// find assets to embed
			const md = await patchAssetfilesInMarkdown(text, cmClient);
			if (md !== text) {
				writeFile(value, md);
			}
			return richTextFromMarkdown(text);
		}
		case 'docx': {
			const richText = await richTextFromDocx(value);
			return richText;
		}
		case 'docx2txt': {
			const text = await textFromDocx(value);
			return text;
		}
		case 'docx2md': {
			const text = await markdownFromDocx(value);
			return text;
		}
		case 'html': {
			const richText = await richTextFromHtml(value);
			return richText;
		}
		case 'htmlfile': {
			const html = readFile(value);
			const richText = await richTextFromHtml(html);
			return richText;
		}
		case 'date': {
			const date = new Date(value);
			return date.toISOString();
		}
		case 'compressupload':
		case 'upload': {
			// used for asset upload
			// example:
			// Entry ID               | Entry Model | Field Name | English
			// 42DJVat6fIvEtlp9N7YIuj | asset       | file       | upload:image.png
			if (!cmClient) {
				throw new Error('upload: not supproted w/o cmClient');
			}
			const url = value;
			const fileName = path.basename(url);
			let contentType = mime.lookup(path.extname(url)) || 'application/octet-stream';
			if (url.startsWith('http')) {
				return {
					contentType,
					fileName,
					upload: url,
				};
			}
			let uploadStream: fs.ReadStream;

			if (prefix === 'compressupload') {
				contentType = 'image/jpeg';
				const filelist = await compressImage([url]);
				uploadStream = fs.createReadStream(filelist[0]);
			} else {
				uploadStream = fs.createReadStream(url.replace('file://', ''));
			}

			const upload = await cmClient.createUpload({ file: uploadStream });
			return {
				contentType,
				fileName,
				uploadFrom: createLink(upload.sys.id, 'Upload'),
			};
		}
		default: {
			// we add "  \n" to preserve line breaks
			let reformattedValue = inValue.replace(/\n/g, '  \n');
			if (opt.escape) {
				const characters = opt.escape.split(',');
				for (const ch of characters) {
					const re = new RegExp(`\\${ch}`, 'g');
					reformattedValue = reformattedValue.replace(re, `\\${ch}`);
				}
			}
			return reformattedValue;
		}
	}
}

/**
 * Create link array structure
 * @param {string[]} values array of values to add
 * @param {LinkType} linkType 'Asset' | 'Entry' | 'Tag'
 * @returns {Link<LinkType>[]} Array of links
 */
export function createLinks(values: string[], linkType: LinkType): Link<LinkType>[] {
	if (!values) return [];
	return values.map((v) => createLink(v, linkType)).filter(notEmpty);
}

/**
 * Validate required columns exists in the xlsx
 * @param {Row[]} data
 * @param {string[][]} requiredFields
 * @returns {boolean}
 */
export function validateRequiredColumns(data: Row[], alias: ColumnNameAlias[], requiredFields: string[]) {
	const row = data[0];
	let ok = true;
	const missingColumns: string[] = [];
	for (const columnName of requiredFields) {
		const value = getColumnValue(row, columnName);
		if (value === '') {
			ok = false;
			missingColumns.push(columnName);
		}
	}
	return { ok, missingColumns };
}

/**
 * Patch new entries
 * @param cmClient
 * @param patchEntries
 * @param patchEntryMap
 * @param publish
 */
export async function patchNewEntries(cmClient: Environment, patchEntries: EntryToPatch[], patchEntryMap: Record<string, string>, publish: string) {
	for (const patchEntry of patchEntries) {
		let entryOrAsset = await getEntry(cmClient, patchEntry.entryId, false);
		if (!entryOrAsset) continue;

		// we dont' handle assets
		if (entryOrAsset.sys.type === 'Asset') {
			continue;
		}

		const entry = entryOrAsset as Entry;
		if (patchEntry.prefix === 'links') {
			const values = patchEntry.value as string[];
			const newEntryIds = values.map((e) => patchEntryMap[e] || e);
			entry.fields[patchEntry.fieldName] = createLinks(newEntryIds, 'Entry');
			patchEntry.cell.value = `links:${newEntryIds.join(',')}`;
		} else if (patchEntry.prefix === 'link') {
			const key = patchEntry.value as string;
			const newEntryId = patchEntryMap[key];
			entry.fields[patchEntry.fieldName] = createLink(newEntryId, 'Entry');
			patchEntry.cell.value = `link:${newEntryId}`;
		} else if (patchEntry.prefix === 'asset') {
			patchEntry.cell.value = `asset:${patchEntry.value}`;
		} else {
			logger.info(`${chalk.yellow('[WARN]')} unknown prefix ${patchEntry.prefix} for ${patchEntry.entryId}`);
			continue;
		}

		const inPublishedState = isPublished(entry);
		entryOrAsset = await updateEntry(entry);
		entryOrAsset = await protectedPublish(inPublishedState, publish, entryOrAsset);
	}
}

/**
 * Check duplicate name
 */
const checkDuplicateFieldMap: Record<string, number> = {};
export function checkDuplicateField(rowNumber: number, entryId: string, entryModel: string, fieldName: string) {
	const dupKey = `${entryId}:${entryModel}:${fieldName}`;
	const prevRow = checkDuplicateFieldMap[dupKey];
	if (prevRow) {
		const errMessage = `${chalk.redBright(`[ERROR]`)} duplicate row ${chalk.red(rowNumber)} ${chalk.green(
			entryId,
		)} ${chalk.blue(entryModel)} ${chalk.cyan(fieldName)} of row ${chalk.yellow(prevRow)}`;
		logger.error(errMessage);
		throw new Error(errMessage);
	}
	checkDuplicateFieldMap[dupKey] = rowNumber;
}

function getColumnValue(row: Row, columnName: string): string {
	return row[columnName] || '';
}

/**
 * Patch embedded asset blocks into asset files
 * @param value
 * @param cmClient
 * @returns
 */
export async function patchAssetfilesInMarkdown(value: string, cmClient?: Environment) {
	const matches = value.match(/!\[embedded-asset-block\]\(assetfile:([^)]+)/g);
	let md = value;
	if (matches) {
		for (const filepath of matches.map((m) => m.split('assetfile:')[1])) {
			const assetLink = (await parseValue(`assetfile:${filepath}`, {
				context: {},
				cmClient,
			})) as Link<'Asset'>;
			md = md.replace(`assetfile:${filepath}`, assetLink.sys.id);
		}
	}
	return md;
}

export function normalizeColumns(rows: Row[], aliases: ColumnNameAlias[]) {
	// create reverse map
	const aliasMap: Record<string, string> = {};
	for (const a of aliases) {
		for (const aliasValue of a.alias) {
			aliasMap[aliasValue.toLowerCase()] = a.id;
		}
	}

	// rename column name
	for (const row of rows) {
		for (const [key, value] of Object.entries(row)) {
			const lcKey = key.toLowerCase();
			if (aliasMap[lcKey]) {
				const aliasKey = aliasMap[lcKey];
				row[aliasKey] = value;
				// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
				delete row[key];
			}
		}
	}

	return rows;
}
