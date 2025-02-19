import { Maybe, openFile } from '@/utils';
import { createClientFromConfig, findAllLinkedReferences, getContentTypes, getEntries, getFilteredFields } from '@/utils/contentful';
import { getAllLocales } from '@/utils/contentful-locales';
import { createWorkbook, Row, saveWorkbook } from '@/utils/excel';
import { richTextToMarkdown } from '@/utils/rich-text/to-markdown';
import { Document } from '@contentful/rich-text-types';
import chalk from 'chalk';
import { Command } from 'commander';
import { Link } from 'contentful-management';
import path from 'node:path';

type Options = {
	recursive?: boolean;
	template?: boolean;
	jsonRichtext?: boolean;
	debug?: boolean;
};

export function command(program: Command): Command {
	program
		.command('export')
		.argument('<entry-ids>', 'comma separated entry ids')
		.argument('[file]', 'output XLSX filename')
		.option('-r, --recursive', 'recursively search entry')
		.option('-t, --template', 'export with a template')
		.option('-j, --json-richtext', 'export richtext has raw json instead of markdown')
		.option('-d, --debug', 'print raw entry as JSON')
		.description('Export contentful entries to xlsx spreadsheet')
		.action(async (entryIds, file, options: Options) => {
			const { env: client } = await createClientFromConfig();
			let ids = entryIds.split(',');
			ids = [...new Set(ids)]; // make unique

			// fetch all the content types
			const contentTypesList = await getContentTypes(client);
			const contentTypes = new Map(contentTypesList.map((ct) => [ct.sys.id, ct]));

			// get recursive entries
			if (options.recursive) {
				let allChildEntries: string[] = [];
				let allChildAssets: string[] = [];
				for (const entryId of ids) {
					const childEntries = await findAllLinkedReferences(client, entryId, 0, {}, []);
					allChildEntries = allChildEntries.concat(childEntries.entries);
					allChildAssets = allChildAssets.concat(childEntries.assets);
				}
				ids = ids.concat(allChildEntries);
			}

			// download entries in chunks
			const entries = await getEntries(client, ids);

			const rows: Row[] = [];
			const allLocales = getAllLocales();

			for (const entry of entries) {
				const contentType = contentTypes.get(entry.sys.contentType.sys.id);
				const fields = getFilteredFields(contentType, []);

				let id = getEntryId(entry.sys.id, !!options.template);
				const ct = contentType?.sys.id || '';

				for (const field of fields) {
					const row: Row = {
						id: id,
						model: ct,
						field: field.id,
					};
					// skip any fields without an english value
					const enValue = entry.fields[field.id]?.['en-US'];
					if (enValue === undefined || enValue === null) {
						continue;
					}
					// clear the id to make xlsx easier to read
					id = '';
					for (const locale of allLocales) {
						const value = processValue(entry.fields[field.id]?.[locale], field.type, !!options.template, !!options.jsonRichtext);
						if (value) {
							row[locale] = value;
						}
					}
					rows.push(row);
				}

				if ((entry.metadata?.tags?.length || 0) > 0) {
					const tags = entry.metadata?.tags.map((t) => t.sys.id);
					const metaRow = {
						id,
						model: entry.sys.contentType.sys.id,
						field: 'metadata',
						'en-US': `tags:${tags?.join(',')}`,
					};
					rows.push(metaRow);
				}
			}

			let saveFileName = file;
			if (!saveFileName) {
				saveFileName = `ctt-export-${ids[0] || 'noentry'}.xlsx`;
			}

			if (options.debug) {
				console.log(JSON.stringify(entries, null, 2));
				console.table(rows);
				return;
			}

			if (rows.length) {
				const wb = createWorkbook({ 'dm batcheditexport': rows });
				console.log(`Saving ${chalk.cyan(saveFileName)} with ${chalk.yellow(`${entries.length} entries`)}`);
				await saveWorkbook(wb, saveFileName);

				// open browser
				openFile(path.resolve(saveFileName));
			} else {
				console.log('No file created. Could not find entries.');
			}
		});

	return program;
}

/**
 * Get entry id based on template name
 * @param entry
 * @param useTemplate
 * @returns
 */
const entryToNewId: Record<string, string> = {};
let lastNewEntryId = 1;
function getEntryId(entry: string, useTemplate: boolean) {
	if (useTemplate) {
		const e = entryToNewId[entry];
		if (e) {
			return e;
		}
		const newId = `new-${lastNewEntryId}`;
		lastNewEntryId += 1;
		entryToNewId[entry] = newId;
		return newId;
	}
	return entry;
}

export function processValue(value: unknown, type: string, template: boolean, jsonRichText: boolean): Maybe<string> {
	if (value === undefined || value === null) return undefined;

	switch (type) {
		case 'Text':
		case 'Symbol':
			return value as string;
		case 'Integer':
			return `number:${value}`;
		case 'RichText':
			if (jsonRichText) {
				return `json:${JSON.stringify(value)}`;
			}
			return `markdown:${richTextToMarkdown(value as Document)}`;
		case 'Object':
		case 'Array': {
			const arrayValue = value as Link<'Asset'>[];
			if (arrayValue[0]?.sys?.id) {
				const linkType = arrayValue[0]?.sys?.linkType || 'Entry';
				if (linkType === 'Asset') {
					return `assets:${arrayValue.map((i) => i.sys.id).join(',')}`;
				}
				return `links:${arrayValue.map((i) => getEntryId(i.sys.id, template)).join(',')}`;
			}
			const stringArray = value as string[];
			if (typeof stringArray[0] === 'string') {
				return `array:${stringArray.join(',')}`;
			}
			return `json:${JSON.stringify(value)}`;
		}
		case 'Link': {
			const linkValue = value as Link<'Asset'>;
			if (linkValue.sys.linkType === 'Asset') {
				return `asset:${linkValue.sys.id}`;
			}
			return `link:${getEntryId(linkValue.sys.id, template)}`;
		}
		case 'Number':
			return `number:${value}`;
		case 'Boolean':
			return `bool:${value === true}`;
		default:
			return value as string;
	}
}
