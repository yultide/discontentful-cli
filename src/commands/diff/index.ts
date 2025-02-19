import { Maybe, notEmpty } from '@/utils';
import { createClientFromConfig, getContentTypes } from '@/utils/contentful';
import { logger } from '@/utils/logger';
import chalk from 'chalk';
import { Command } from 'commander';
import { ContentFields, ContentType, Control, EditorInterface, Environment, KeyValueMap } from 'contentful-management';
import { diffJson } from 'diff';
import _ from 'lodash';
import { table } from 'table';
import { saveMigration } from './migration';

export interface ContentfulEnvironment {
	contentTypes: Record<string, ContentType>;
	editorInterfaces: Record<string, EditorInterface>;
	environment: Environment;
}

export type ChangeType =
	| 'addContentType'
	| 'removeContentType'
	| 'addField'
	| 'removeField'
	| 'modifyField'
	| 'modifyEditorInterface'
	| 'modifyDisplayField'
	| 'modifyFieldOrder';

export type BasicTypes = string | object | number | boolean;

export interface AddContentType {
	fields: ContentFields<KeyValueMap>[];
}

export type RemoveContentType = Record<string, unknown>;

export interface AddField {
	name: string;
	field: ContentFields<KeyValueMap>;
}

export interface RemoveField {
	name: string;
}

export interface Field extends ContentFields<KeyValueMap>, Record<string, unknown> {}

export interface ModifyField {
	name: string;
	oldField: Field;
	newField: Field;
}

export interface ModifyFieldOrder {
	oldOrder: string[];
	newOrder: string[];
	oldContentType: ContentType;
	newContentType: ContentType;
}

export interface ModifyEditorInterface {
	name: string;
	field: string;
	oldControl: Control;
	newControl: Control;
}

export interface ModifyDisplayField {
	oldDisplayField: string;
	newDisplayField: string;
}

type ContentfulChangeBase = {
	type: ChangeType | string;
	contentType: string;
	data: AddContentType | RemoveContentType | AddField | RemoveField | ModifyField | ModifyEditorInterface | ModifyDisplayField | ModifyFieldOrder;
	_context: {
		contentType: ContentType;
		lowerEnv: Environment;
		higherEnv: Environment;
	};
};

export type ContentfulChange =
	| ContentfulChangeBase
	| (ContentfulChangeBase & {
			type: 'addContentType';
			data: AddContentType;
	  })
	| (ContentfulChangeBase & {
			type: 'removeContentType';
			data: RemoveContentType;
	  })
	| (ContentfulChangeBase & {
			type: 'addField';
			data: AddField;
	  })
	| (ContentfulChangeBase & {
			type: 'removeField';
			data: RemoveField;
	  })
	| (ContentfulChangeBase & {
			type: 'modifyField';
			data: ModifyField;
	  })
	| (ContentfulChangeBase & {
			type: 'modifyEditorInterface';
			data: ModifyEditorInterface;
	  })
	| (ContentfulChangeBase & {
			type: 'modifyDisplayField';
			data: ModifyDisplayField;
	  })
	| (ContentfulChangeBase & {
			type: 'modifyFieldOrder';
			data: ModifyFieldOrder;
	  });

export function command(program: Command): Command {
	program
		.command('diff')
		.option('-m, --create-migration', 'create migration')
		.argument('<lowerEnv>')
		.argument('<higherEnv>')
		.description('Get the diff between two environments')
		.action(async (lowerEnvName, higherEnvName, options) => {
			// contentful client setup
			const { space } = await createClientFromConfig();

			// fetch higher and lower environments
			logger.start(`Contentful env diff ${chalk.cyan(lowerEnvName)} -> ${chalk.yellow(higherEnvName)}`);
			const lowerEnv = await space.getEnvironment(lowerEnvName);
			const higherEnv = await space.getEnvironment(higherEnvName);
			logger.succeed();

			const lower = await getContentfulEnvironment(lowerEnv);
			const higher = await getContentfulEnvironment(higherEnv);

			// do diff & report
			const diff = diffEnvironment(lower, higher);
			const report = diffReport(diff);
			console.log(report);

			if (options.createMigration) {
				await saveMigration(diff);
			}
		});

	return program;
}

/**
 * Creates a diff report
 * @param {ContentfulChange[]} changes - list of environment changes
 * @returns {string} table report of the changes
 */
export function diffReport(changes: ContentfulChange[]): string {
	return table(diffToRows(changes));
}

/**
 * Convert a contentul change to a row object
 * @param {ContentfulChange} item change item from an environment diff
 * @returns {string[4]} ['type', 'contentType', 'field', 'details']
 */
export function diffToRow(item: ContentfulChange) {
	const row: Record<string, string> = { type: '', contentType: '', field: '', details: '' };
	switch (item.type) {
		case 'addContentType': {
			const data = item.data as AddContentType;
			row.type = chalk.green('+ model');
			row.details = data.fields.map((f) => `${chalk.green(f.id)}:${chalk.blue(f.type)}`).join('\n');
			break;
		}
		case 'removeContentType': {
			row.type = chalk.red('⨯ model');
			break;
		}
		case 'addField': {
			const data = item.data as AddField;
			row.type = chalk.green('+ field');
			row.field = chalk.cyan(data.name);
			row.details = `${Object.entries(data.field)
				.map((v) => `${chalk.green(v[0])}=${fieldValueToString(v[1])}`)
				.join('\n')}`;
			break;
		}
		case 'removeField': {
			const data = item.data as RemoveField;
			row.type = chalk.red('⨯ field');
			row.field = `${chalk.cyan(data.name)}`;
			break;
		}
		case 'modifyField': {
			const data = item.data as ModifyField;
			row.type = chalk.blue('✎ field');
			row.field = data.name;
			row.details = `${Object.entries(data.newField)
				.map((v) => {
					const [name, value] = v;
					const old = data.oldField as unknown as Record<string, object>;
					if (!_.isEqual(value, old[name])) {
						return `${chalk.green(name)}=${diffObject(old[name] as object, value as object)}`;
					}
					return undefined;
				})
				.filter(notEmpty)
				.join('\n')}`;
			break;
		}
		case 'modifyEditorInterface': {
			const data = item.data as ModifyEditorInterface;
			row.type = chalk.blue('✎ ui');
			row.field = data.name;
			row.details = `${diffObject(data.oldControl, data.newControl)}`;
			break;
		}
		case 'modifyDisplayField': {
			const data = item.data as ModifyDisplayField;
			row.type = chalk.blue('✎ field');
			row.field = 'displayField';
			row.details = `displayField ${chalk.blue(data.oldDisplayField)} -> ${chalk.green(data.newDisplayField)}`;
			break;
		}
		case 'modifyFieldOrder': {
			const data = item.data as ModifyFieldOrder;
			row.type = chalk.blue('✎ field');
			row.field = 'fieldOrder';
			row.details = `old order:\n${data.oldOrder.map((n) => `  ${chalk.blue(n)}`).join('\n')}\nnew order:\n${data.newOrder
				.map((n) => `  ${chalk.green(n)}`)
				.join('\n')}`;
			break;
		}
		default:
			throw new Error(`unknown type ${item.type}`);
	}
	row.contentType = chalk.cyan(item.contentType);
	row.field = chalk.cyan(row.field);
	return ['type', 'contentType', 'field', 'details'].map((n) => row[n]);
}

/**
 * Creates a table of the environment changes
 * @param {ContentfulChange[]} changes - list of environment changes
 * @returns {string[][]} table of cells that can be rendered
 */
export function diffToRows(changes: ContentfulChange[]) {
	return [['Operation', 'Content Type', 'Field Name', 'Details'].map((h) => chalk.yellow(h))].concat(changes.map(diffToRow));
}

/**
 * Get the contentful environment content types and editor interfaces
 * @param {Environment} env - Contentful environment API object
 * @returns {ContentfulEnvironment} contentful environment data
 */
export async function getContentfulEnvironment(env: Environment): Promise<ContentfulEnvironment> {
	logger.start(`Fetching ${chalk.cyan('content types')} for ${chalk.cyan(env.name)}`);
	const contentTypesList = await getContentTypes(env);
	logger.succeed(`Got ${chalk.yellow(contentTypesList.length)} types from ${chalk.cyan(env.name)}`);

	logger.start(`Fetching ${chalk.cyan('editor interfaces')} in environment ${chalk.cyan(env.name)}`);
	const collection = await env.getEditorInterfaces();
	const editorInterfacesList = collection.items;
	logger.succeed(`Got ${chalk.yellow(editorInterfacesList.length)} editor interface in environment ${chalk.cyan(env.name)}`);

	const contentTypes: Record<string, ContentType> = {};
	const editorInterfaces: Record<string, EditorInterface> = {};

	for (const ct of contentTypesList) {
		contentTypes[ct.sys.id] = ct;
	}

	for (const ei of editorInterfacesList) {
		editorInterfaces[ei.sys.contentType.sys.id] = ei;
	}

	return {
		contentTypes,
		editorInterfaces,
		environment: env,
	};
}

/**
 * Create diffs of the contentent models and editor interfaces
 * @param {ContentfulEnvironment} lowerEnv - New environment to promote
 * @param {ContentfulEnvironment} higherEnv - Original environment to check against (usually master)
 * @returns {ContentfulChange[]} array of contentful changes
 */
export function diffEnvironment(lowerEnv: ContentfulEnvironment, higherEnv: ContentfulEnvironment): ContentfulChange[] {
	const changes: ContentfulChange[] = [];
	const modifiedContentTypeCandidates: string[] = [];

	// 1. look for content type additions
	for (const [name] of Object.entries(lowerEnv.contentTypes)) {
		if (!higherEnv.contentTypes[name]) {
			changes.push({
				type: 'addContentType',
				contentType: name,
				data: {
					fields: lowerEnv.contentTypes[name].fields,
				},
				_context: {
					contentType: lowerEnv.contentTypes[name],
					lowerEnv: lowerEnv.environment,
					higherEnv: higherEnv.environment,
				},
			});
		} else {
			modifiedContentTypeCandidates.push(name);
		}
	}

	// 2. look for content type removals
	for (const [name] of Object.entries(higherEnv.contentTypes)) {
		if (!lowerEnv.contentTypes[name]) {
			changes.push({
				type: 'removeContentType',
				contentType: name,
				data: {},
				_context: {
					contentType: higherEnv.contentTypes[name],
					lowerEnv: lowerEnv.environment,
					higherEnv: higherEnv.environment,
				},
			});
		}
	}

	// 3. look for content type field changes
	for (const contentType of modifiedContentTypeCandidates) {
		const newFields: Record<string, ContentFields<KeyValueMap>> = {};
		const oldFields: Record<string, ContentFields<KeyValueMap>> = {};
		lowerEnv.contentTypes[contentType].fields.forEach((f) => {
			newFields[f.id] = f;
		});
		higherEnv.contentTypes[contentType].fields.forEach((f) => {
			oldFields[f.id] = f;
		});
		for (const [name, newField] of Object.entries(newFields)) {
			// field added
			const oldField = oldFields[name];
			if (!oldField) {
				const field: Record<string, unknown> = { ...newField };
				delete field.id;
				changes.push({
					type: 'addField',
					contentType,
					data: {
						name,
						field,
					},
					_context: {
						contentType: lowerEnv.contentTypes[name],
						lowerEnv: lowerEnv.environment,
						higherEnv: higherEnv.environment,
					},
				});
			} else if (!_.isEqual(newField, oldField)) {
				// field modified
				changes.push({
					type: 'modifyField',
					contentType,
					data: {
						name,
						newField,
						oldField,
					},
					_context: {
						contentType: lowerEnv.contentTypes[name],
						lowerEnv: lowerEnv.environment,
						higherEnv: higherEnv.environment,
					},
				});
			}
		}

		for (const [name] of Object.entries(oldFields)) {
			// field removed
			if (!newFields[name]) {
				changes.push({
					type: 'removeField',
					contentType,
					data: {
						name,
					},
					_context: {
						contentType: lowerEnv.contentTypes[name],
						lowerEnv: lowerEnv.environment,
						higherEnv: higherEnv.environment,
					},
				});
			}
		}
	}

	// 4. Look for changes in display field
	for (const [name] of Object.entries(lowerEnv.contentTypes)) {
		const ctLower = lowerEnv.contentTypes[name];
		const ctHigher = higherEnv.contentTypes[name];
		if (ctHigher === undefined || ctLower === undefined) {
			continue;
		}
		if (ctLower.displayField !== ctHigher.displayField) {
			changes.push({
				type: 'modifyDisplayField',
				contentType: name,
				data: {
					newDisplayField: ctLower.displayField,
					oldDisplayField: ctHigher.displayField,
				},
				_context: {
					contentType: lowerEnv.contentTypes[name],
					lowerEnv: lowerEnv.environment,
					higherEnv: higherEnv.environment,
				},
			});
		}
	}

	// 5. look for editor interface changes
	for (const [name, value] of Object.entries(lowerEnv.editorInterfaces)) {
		const oldEditorInterface = higherEnv.editorInterfaces[name];
		if (!oldEditorInterface) {
			// skip if oldEditorInterface is missing because this would be a new model
			continue;
		}
		const newEditorInterface = value;

		// create map of editor controls
		const oldControls: Record<string, Control> = {};
		const newControls: Record<string, Control> = {};
		oldEditorInterface.controls?.forEach((c) => {
			oldControls[c.fieldId] = c;
		});
		newEditorInterface.controls?.forEach((c) => {
			newControls[c.fieldId] = c;
		});

		for (const newControl of newEditorInterface.controls || []) {
			const { fieldId } = newControl;
			const oldControl = oldControls[fieldId];
			if (!_.isEqual(oldControl, newControl)) {
				changes.push({
					type: 'modifyEditorInterface',
					contentType: name,
					data: {
						name: fieldId,
						field: newControl,
						oldControl,
						newControl,
					},
					_context: {
						contentType: lowerEnv.contentTypes[fieldId],
						lowerEnv: lowerEnv.environment,
						higherEnv: higherEnv.environment,
					},
				});
			}
		}
	}

	// 6. look for ordering changes
	for (const [name] of Object.entries(higherEnv.contentTypes)) {
		const ctHigher = higherEnv.contentTypes[name];
		const ctLower = lowerEnv.contentTypes[name];
		if (ctHigher === undefined || ctLower === undefined) {
			continue;
		}
		const ctHigherOrder = ctHigher.fields.map((f) => f.id);
		const ctLowerOrder = ctLower.fields.map((f) => f.id);
		if (ctHigherOrder.length === ctLowerOrder.length && ctHigherOrder.join(',') !== ctLowerOrder.join(',')) {
			changes.push({
				type: 'modifyFieldOrder',
				contentType: name,
				data: {
					oldOrder: ctHigherOrder,
					newOrder: ctLowerOrder,
					oldContentType: ctHigher,
					newContentType: ctLower,
				},
				_context: {
					contentType: lowerEnv.contentTypes[name],
					lowerEnv: lowerEnv.environment,
					higherEnv: higherEnv.environment,
				},
			});
		}
	}

	return changes;
}

/**
 * Create pretty printed diff of an object
 * @param {object} a
 * @param {object} b
 * @returns {string} diff report
 */
export function diffObject(a: Maybe<BasicTypes>, b: Maybe<BasicTypes>): string {
	const at = typeof a;
	const bt = typeof b;

	// both are basic types
	if (['string', 'number', 'boolean'].includes(at) && at === bt) {
		return `${chalk.yellow(a)}->${chalk.blue(b)}`;
	}
	// a null/undefined or b null/undefined
	if ((['undefined', 'null'].includes(at) && b) || (['undefined', 'null'].includes(bt) && a)) {
		return `${chalk.red(JSON.stringify(a, null, 2))}->${chalk.green(JSON.stringify(b, null, 2))}`;
	}
	// both null/undefined
	if (['undefined', 'null'].includes(at) && ['undefined', 'null'].includes(bt)) {
		return '';
	}

	const d = diffJson(a as object, b as object);

	return d
		.map((l) => {
			if (l.added) {
				return chalk.green(`+${l.value}`);
			}
			if (l.removed) {
				return chalk.red(`-${l.value}`);
			}
			return l.value;
		})
		.join('');
}

/**
 * Turns values into string based on type.
 * @param {any} value - value to convert
 * @returns {string} string representation
 */
export function fieldValueToString(value: unknown): string {
	const t = typeof value;
	switch (t) {
		case 'boolean':
			return chalk.blue((value as boolean).toString());
		case 'object':
			return JSON.stringify(value as object, null, 2);
		case 'string':
			return chalk.blue((value as string).toString());
		case 'number':
			return chalk.yellow((value as number).toString());
		default:
			return (value as string).toString();
	}
}
