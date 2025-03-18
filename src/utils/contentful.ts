import { LinkType } from '@/commands/import';
import { password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import contentful, { Asset, ClientAPI, ContentFields, ContentType, Entry, Environment, KeyValueMap, Link, QueryOptions } from 'contentful-management';
import fs from 'node:fs';
import { isDateString, Maybe, notEmpty } from '.';
import { getConfig } from './config';
import { logger } from './logger';

export type Entity = Entry | Asset;

export type File = {
	title: string;
	type: string;
	fullpath: string;
	description: string;
	tags?: string[];
};

export const supportedLocales = ['en-US', ''];
const slugRegex = /^[A-Za-z0-9-/]+$/;
const slugCleanerRegex = /[^A-Za-z0-9-/]/g;

// fake content type for assets
const assetContentType: ContentType = {
	sys: {
		id: 'asset',
	},
	fields: [
		{
			type: 'Symbol',
			id: 'title',
			name: 'title',
			required: false,
			localized: false,
		},
		{
			type: 'Text',
			id: 'description',
			name: 'description',
			required: false,
			localized: false,
		},
		{
			type: 'JSON',
			id: 'file',
			name: 'file',
			required: false,
			localized: false,
		},
	],
} as ContentType;

/**
 * Create a management client with an access token
 * @param {string} token - default access token
 * @returns {ClientAPI}
 */
export function createClient(token: string) {
	return contentful.createClient({
		accessToken: token,
	});
}

/**
 * Create management client token in config
 * @returns {ClientAPI}
 */
export async function createClientFromConfig() {
	const config = getConfig();
	const client = createClient(config.cmaToken);
	const space = await client.getSpace(config.spaceId);
	const env = await space.getEnvironment(config.envId);
	return { client, space, env };
}

/**
 * Prompt user for a personal token with some instructions.
 *
 * @param {string} currentToken - Contentful user personal token
 */
export async function promptContentfulToken(currentToken = '') {
	console.log(`You can get the management token from here: ${chalk.cyan('https://app.contentful.com/account/profile/cma_tokens')}`);
	console.log(`Click on ${chalk.yellow('Generate personal token')}.  Remember to save your token.  You will not see it again.`);
	let prompt = 'Contentful Management Token';
	if (currentToken !== undefined && currentToken !== '') {
		const front = currentToken.substring(0, 4);
		const back = currentToken.substring(currentToken.length - 5, currentToken.length - 1);
		prompt += chalk.yellow(` (${front}*****${back})`);
	} else {
		prompt += chalk.yellow(' (required)');
	}
	let user = { firstName: '' };
	const contentfulToken = await password({
		mask: '*',
		message: prompt,
		async validate(val) {
			const token = val.length ? val : currentToken;
			if (token.length === 0) {
				return chalk.yellow('Please enter a valid Token!');
			}
			const client = createClient(token);
			try {
				user = await client.getCurrentUser();
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
			} catch (error) {
				return `${chalk.red('Bad Token!')} Check your token in contentful`;
			}
			return true;
		},
	});

	return {
		token: contentfulToken || currentToken,
		user,
	};
}

/**
 * Prompt user for the space to use in Contentful.  This should list only spaces visible to you.
 *
 * @param {string} - spaceId
 * @param {contentful} - Contentful client
 */
export async function promptSpaceConfig(spaceId: string, client: ClientAPI) {
	const spaces = await client.getSpaces();
	const choices = [];
	const { items } = spaces;
	for (let i = 0, len = items.length; i < len; i += 1) {
		const item = items[i];
		choices.push({ name: item.name, value: item.sys.id });
	}

	const qn = {
		name: 'spaceId',
		type: 'list',
		message: 'Select space to use',
		default: '',
		choices,
	};
	if (spaceId !== undefined && spaceId !== '') {
		qn.default = spaceId;
	}

	return select(qn);
}

/**
 * Prompt user for the space id and environment id.
 *
 * @param {string} spaceId - Prior space id in Contentful
 * @param {string} envId - Prior environment id of the current selection.
 * @param {ContentfulClientApi} cc - Contentful client
 */
export async function promptEnvConfig(spaceId: string, envId: string, cc: ClientAPI) {
	const space = await cc.getSpace(spaceId);
	const envs = await space.getEnvironments();

	const envMap: Record<string, string> = { master: 'master' };
	const { items } = envs;
	for (let i = 0, len = items.length; i < len; i += 1) {
		const item = items[i];
		// remove the aliased master environment, since we have created a default one.
		if (item.sys.id !== 'master') {
			envMap[item.name] = item.sys.id;
		}
	}
	const choices: { name: string; value: string }[] = [];
	Object.entries(envMap).forEach(([key, value]) => {
		choices.push({ name: key, value });
	});
	const qn = {
		type: 'list',
		message: 'Select environment to use',
		default: '',
		choices,
	};
	let newEnvId = envId;
	if (envId === undefined || envId === '') {
		newEnvId = 'master';
	}
	qn.default = newEnvId;
	return select(qn);
}

/**
 * Find the refernce entry ids in an object.
 * @param {object} entry - Contentful Entry Id
 * @returns {array} - Array of Entry Ids
 */
export function findReferencesInEntry(entry: Entity) {
	const values = Object.values(entry.fields);
	const result: { assets: string[]; entries: string[] } = {
		assets: [],
		entries: [],
	};
	values.forEach((value) => {
		if (value !== undefined) {
			const englishValue = value['en-US'];
			if (englishValue?.sys?.type === 'Link' && englishValue?.sys?.id) {
				if (englishValue.sys.linkType === 'Entry') {
					result.entries.push(englishValue.sys.id);
				} else if (englishValue.sys.linkType === 'Asset') {
					result.assets.push(englishValue.sys.id);
				}
			} else if (Array.isArray(englishValue)) {
				englishValue.forEach((link) => {
					if (link?.sys?.type === 'Link' && link?.sys?.id) {
						if (link.sys.linkType === 'Entry') {
							result.entries.push(link.sys.id);
						} else if (link.sys.linkType === 'Asset') {
							result.assets.push(link.sys.id);
						}
					}
				});
			}
		}
	});
	return result;
}

/**
 * Find all the linked references in an object and recursively track them.
 *
 * @param {ContentfulClientAPI} cmClient - Contentful Management API
 * @param {string} entryId  - Contentful Entry ID
 *
 * @returns {array} - list of referenced entry ids
 */
export async function findAllLinkedReferences(
	cmClient: Environment,
	entryId: string,
	depth = 0,
	refs: Record<string, boolean> = {},
	excludeContentTypes: string[] = [],
) {
	const entry = await getEntry(cmClient, entryId);
	if (entry) {
		logger.info(`${'  '.repeat(depth)}${entryId}[${chalk.blue(entry.sys.contentType.sys.id)}] ${chalk.yellow(getName(entry))}`);
		if (excludeContentTypes.length > 0 && excludeContentTypes.includes(entry.sys.contentType.sys.id)) {
			logger.info(`${'  '.repeat(depth)}skipping...`);
			return {
				entries: [],
				assets: [],
			};
		}

		refs[entryId] = true;
		const referenceLinks = findReferencesInEntry(entry);
		const result = {
			entries: [entryId],
			assets: referenceLinks.assets,
		};
		for (const id of referenceLinks.entries) {
			if (refs[id]) {
				continue;
			}
			const referenceResult = await findAllLinkedReferences(cmClient, id, depth + 1, refs, excludeContentTypes);
			result.entries = result.entries.concat(referenceResult.entries);
			result.assets = result.assets.concat(referenceResult.assets);
		}

		return {
			entries: result.entries,
			assets: result.assets,
		};
	}
	return {
		entries: [],
		assets: [],
	};
}

/**
 * Get a Contenful entry with a cached store.  This should be used instead
 * of calling cmClient.getEntry directly.
 *
 * @param {ContentfulClientAPI} cmClient - Contentful Management API
 * @param {string} entryId - Contentful Entry ID
 * @param {boolean} silent - Whether to throw an error if missing an entry id
 * @param {QueryOptions} options - Contentful get entry options
 * @returns contentful entry
 */
const entryCache: Record<string, Entry> = {};
export async function getEntry(cmClient: Environment, entryId: string, silent = false, options: QueryOptions = {}): Promise<Maybe<Entity>> {
	// check cache first
	let entry = entryCache[entryId];
	if (entry !== undefined) {
		return entry;
	}

	try {
		entry = await cmClient.getEntry(entryId, options);
		entryCache[entryId] = entry;
		return entry;
	} catch (err) {
		if ((err as Error).name === 'NotFound') {
			if (!silent) {
				logger.error(`${chalk.redBright('[ERROR]')} unable to find entry id ${chalk.yellow(entryId)}`);
			}
			// don't throw error. we just print out message and return null so bad references don't stop export
			return null;
		}
		logger.error(`${chalk.redBright('[ERROR]')} unable to find entry id ${chalk.yellow(entryId)}`, err);

		return null;
	}
}

/**
 * Get the name of entry or asset
 * @param {Entry|Asset} entryOrAsset
 * @returns {string}
 */
export function getName(entryOrAsset?: Entry | Asset) {
	if (entryOrAsset?.sys.type === 'Entry') {
		const entry = entryOrAsset as Entry;
		if (entry?.fields.internalName) {
			return entry.fields.internalName['en-US'];
		}
		if (entry?.fields.title) {
			return entry.fields.title['en-US'];
		}
		if (entry?.fields.id) {
			return entry.fields.id['en-US'];
		}
	} else {
		const asset = entryOrAsset as Asset;
		if (asset?.fields.title) {
			return asset.fields.title['en-US'];
		}
	}
	return 'unknown name';
}

/**
 * Get the content type AKA model for contentful
 * @param {ContentfulAPI} environment contentful environment api
 * @param {string} contentTypeId optional content id
 * @returns {ContentType[]} array of content types
 */
export async function getContentTypes(environment: Environment, contentTypeId = '') {
	return contentTypeId ? [await environment.getContentType(contentTypeId)] : (await environment.getContentTypes({ limit: 1000 })).items;
}

/**
 * Get fields of a content type
 * @param contentType
 * @param filterFields
 * @returns
 */
export function getFilteredFields(contentType: Maybe<ContentType>, filterFields: string[] = []) {
	if (!contentType) {
		return [];
	}
	const { fields } = contentType;
	return filterFields.length > 0 ? contentType.fields.filter((f) => filterFields.includes(f.id)) : fields;
}

/**
 * Get contentful entries
 * @param client
 * @param ids
 */
export async function getEntries(client: Environment, ids: string[]) {
	let entries: Entry[] = [];
	const chunkSize = 10;
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize);
		const queryOptions: QueryOptions = { 'sys.id[in]': chunk.join(',') };
		const chunkEntries = await client.getEntries(queryOptions);
		entries = entries.concat(Array.from(chunkEntries.items as Entry[]));
	}
	return entries;
}

/**
 * Get content type name from entry or asset
 * @param entity
 * @returns
 */
export function getContentType(entity: Maybe<Entity>) {
	if (!entity) {
		return 'null';
	}
	if (entity.sys.type === 'Asset') {
		return 'asset';
	}
	const entry = entity as Entry;
	return entry.sys.contentType.sys.id;
}

/**
 * Validate the field type
 * @param modelName
 * @param fieldName
 * @param field
 * @param value
 */
export function validateFieldType(modelName: string, fieldName: string, field: ContentFields<KeyValueMap>, value: Maybe<string | Date>) {
	switch (field.type) {
		case 'Date':
			if (typeof value !== 'string' && !(value instanceof Date)) {
				logger.warn(
					`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be prefixed with ${chalk.green('date:')}? value=${chalk.blue(value)}`,
				);
				break;
			}
			if (typeof value === 'string' && !value.startsWith('date:') && !isDateString(value)) {
				logger.warn(
					`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} have a prefix ${chalk.green('date:')}? value=${chalk.blue(value)}`,
				);
			}
			break;
		case 'Text':
		case 'Symbol':
			if (typeof value !== 'string') {
				logger.warn(`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be a string? value=${chalk.blue(value)}`);
			}
			break;
		case 'Number':
		case 'Integer':
			if (typeof value !== 'string') {
				logger.warn(`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be a string? value=${chalk.blue(value)}`);
				break;
			}
			if (!value.startsWith('number:')) {
				logger.warn(
					`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be prefixed with ${chalk.green(
						'number:',
					)}? value is ${chalk.blue(value)}`,
				);
			}
			break;
		case 'RichText': {
			if (typeof value !== 'string') {
				logger.warn(`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be a string? value=${chalk.blue(value)}`);
				break;
			}
			// const prefixes = ['json:', 'markdown:', 'markdownfile:', 'docx:', 'html:', 'htmlfile:'];
			// if (!prefixes.find(p => value.startsWith(p))) {
			//   logger.warn(
			//     `${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be prefixed with ${prefixes
			//       .map(v => chalk.green(v))
			//       .join(',')} for a rich text? value is ${chalk.blue(value)}`
			//   );
			// }
			break;
		}
		case 'Object':
			if (typeof value !== 'string') {
				logger.warn(`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be a string? value=${chalk.blue(value)}`);
				break;
			}
			if (!value.startsWith('json:') && !value.startsWith('array:')) {
				logger.warn(
					`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be prefixed with ${chalk.green(
						'json:,array:',
					)} for a JSON object? value is ${chalk.blue(value)}`,
				);
			}
			break;
		case 'Array':
			if (typeof value !== 'string') {
				logger.warn(`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be a string? value=${chalk.blue(value)}`);
				break;
			}
			if (field.items?.type === 'Link') {
				if (!value.startsWith('links:')) {
					logger.warn(
						`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} have a prefix ${chalk.green(
							'links:',
						)} for many reference links? value is ${chalk.blue(value)}`,
					);
				}
				break;
			}
			if (!value.startsWith('array:')) {
				logger.warn(
					`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} have a prefix ${chalk.green(
						'array:',
					)} for an array? value is ${chalk.blue(value)}`,
				);
			}
			break;
		case 'Link': {
			if (typeof value !== 'string') {
				logger.warn(`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be a string? value=${chalk.blue(value)}`);
				break;
			}
			if (!value.startsWith('link:') && field.linkType === 'Entry') {
				logger.warn(
					`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} have a prefix ${chalk.green(
						'link:',
					)} for a link reference? value is ${chalk.blue(value)}`,
				);
				break;
			}
			const prefixes = ['asset:', 'assetfile:', 'asseturl:', 'compressasset:', 'image:', 'asset:'];
			if (!prefixes.find((p) => value.startsWith(p)) && field.linkType === 'Asset') {
				logger.warn(
					`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} have a prefix ${prefixes
						.map((v) => chalk.green(v))
						.join(', ')} for a link reference? value is ${chalk.blue(value)}`,
				);
			}
			break;
		}
		case 'Boolean':
			if (typeof value !== 'string') {
				logger.warn(`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} be a string? value=${chalk.blue(value)}`);
				break;
			}
			if (!value.startsWith('bool:')) {
				logger.warn(
					`${chalk.yellow('[WARN]')} Should ${chalk.cyan(`${modelName}.${fieldName}`)} have a prefix ${chalk.green(
						'link:',
					)} for a link reference? value is ${chalk.blue(value)}`,
				);
			}
			break;
		default:
			break;
	}
}

/**
 * get or create contentful entry
 * @param {Environment} cmClient contentful environment to create the entry in
 * @param {string} entryModel content model
 * @param {string} entryId entry id or a new-XXX to create a new object
 * @param {Record<string,string>} newEntryMap map of the new entries
 * @returns {Entry}
 */
export async function getOrCreateEntry(cmClient: Environment, entryModel: string, entryId: string, newEntryMap: Record<string, string>) {
	// if entry id starts with 'asset:' we try to find an asset instead of an entry.
	// asset creation is not supported
	switch (entryModel) {
		case 'asset':
			try {
				const asset = await cmClient.getAsset(entryId);
				if (!asset) {
					logger.error(`[${chalk.redBright('ERROR')}] failed to find asset ${entryId}`);
				}
				return asset;
			} catch {
				// we didn't find the asset
			}
			break;
		default:
			// this is an entry
			break;
	}

	let currentEntry: Maybe<Entity>;
	// check to see if this entry was previously created
	if (newEntryMap[entryId]) {
		entryId = newEntryMap[entryId];
	}
	if (!entryId || entryId.startsWith('new-')) {
		// create a new entry or asset
		switch (entryModel) {
			case 'asset':
				currentEntry = await cmClient.createAsset({
					fields: {
						title: { 'en-US': '' },
						file: {},
					},
				});
				break;
			default:
				// create a new entry
				currentEntry = await cmClient.createEntry(entryModel, { fields: {} });
				if (!currentEntry) {
					logger.error(`[${chalk.redBright('ERROR')}] failed to create new entry ${entryId}`);
					return undefined;
				}
				if (entryId.startsWith('new-')) {
					// can be used to patch link: and links: later
					newEntryMap[entryId] = currentEntry.sys.id;
				}
		}
	} else {
		const silent = true;
		// checkItemId(entryId);
		currentEntry = await getEntry(cmClient, entryId, silent);
		if (!currentEntry) {
			if (entryModel === 'asset') {
				currentEntry = await cmClient.createAssetWithId(entryId, {
					fields: {
						title: { 'en-US': '' },
						file: {},
					},
				});
			} else {
				// we create w/ the entry Id
				currentEntry = await cmClient.createEntryWithId(entryModel, entryId, {
					fields: {},
				});
			}
		}
	}
	return currentEntry;
}

/**
 * Update entry
 * @param {ContentfulEntry} entry - Contentful Entry Object
 */
export async function updateEntry(entry: Maybe<Entity>): Promise<Maybe<Entity>> {
	if (!entry) {
		return entry;
	}
	// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
	delete entryCache[entry.sys.id];

	if (entry.sys.type === 'Entry') {
		const e = entry as Entry;
		const slug = e.fields.slug?.['en-US'];
		if (slug && !slug.match(slugRegex)) {
			e.fields.slug['en-US'] = slug.replace(/[._]/g, '-').replace(slugCleanerRegex, '');
		}
	}

	const updatedEntry = await entry.update();

	// process the image if upload or uploadFrom field set
	if (updatedEntry.sys.type === 'Asset') {
		const asset = updatedEntry as Asset;
		if (asset.fields.file?.['en-US'].upload || asset.fields.file?.['en-US'].uploadFrom) {
			entry = await asset.processForAllLocales();
		}
	}

	return updatedEntry;
}

/**
 * Check if entry or asset is published
 * @param entity
 * @returns
 */
export function isPublished(entity: Maybe<Entity>) {
	if (!entity) {
		return false;
	}
	const e = entity;
	return !!e.sys.publishedVersion && e.sys.version === e.sys.publishedVersion + 1;
}

/**
 * Update tags for the entry
 * @param entity
 * @param tags
 * @returns
 */
export function updateTags(entity: Maybe<Entity>, tags: string[]) {
	if (!entity) {
		return;
	}

	if (!entity.metadata) {
		entity.metadata = { tags: [] };
	}
	const currentTags: string[] = entity.metadata.tags.map((tag) => tag.sys.id);
	const uniqueTags = new Set([...currentTags, ...tags]);

	// we want to add to existing tags and not overwrite
	entity.metadata.tags = createLinks([...uniqueTags], 'Tag') as Link<'Tag'>[];
}

/**
 * Create a link structure.  Will return null if value is an empty string
 * @param {string} value value to link
 * @param {LinkType} linkType 'Asset' | 'Entry' | 'Tag'
 * @returns {Link<LinkType> | null} Link object
 */
export function createLink(value: string, linkType: LinkType): Link<LinkType> | null {
	if (!value) {
		return null;
	}
	return {
		sys: {
			type: 'Link',
			linkType,
			id: value,
		},
	};
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
 * publishEntity
 * @param entity
 * @param publish
 * @returns
 */
export function publishEntity(entity: Maybe<Entity>, publish: string) {
	if (!entity) {
		return Promise.resolve(undefined);
	}
	if (publish === 'preserve' && isPublished(entity)) {
		return entity.publish();
	}
	if (publish === 'all') {
		return entity.publish();
	}
	return Promise.resolve(entity);
}

/**
 * Publish based on state
 * @param inPublishedState
 * @param publish
 * @param currentEntry
 * @returns
 */
export async function protectedPublish(inPublishedState: boolean, publish: string, currentEntry: Maybe<Entity>) {
	if (!currentEntry) {
		return currentEntry;
	}
	if ((inPublishedState && publish === 'preserve') || publish === 'all') {
		return publishEntity(currentEntry, 'all');
	}
	return currentEntry;
}

/**
 * Get content model
 * @param cmClient
 * @param name
 * @param cache
 * @returns
 */
export async function getModel(cmClient: Environment, name: string, cache: Record<string, ContentType>) {
	if (!name) {
		throw new Error('invalid model empty string');
	}
	if (name === 'asset') {
		return assetContentType;
	}

	if (cache[name]) {
		return cache[name];
	}
	const model = await cmClient.getContentType(name);
	cache[name] = model;
	return model;
}

/**
 * Creates a media asset. Ex. screenshots, images, or videos
 *
 * @param {Environment} cmClient - Contentful Management client
 * @param {object} file - File object with type, description, and fullPath as keys
 */
export async function createAsset(cmClient: Environment, file: File) {
	const contentType = file.type;
	const fileName = file.description;
	if (!fs.existsSync(file.fullpath)) {
		throw new Error(`createAssset: Cannot find file ${file.fullpath}`);
	}
	let asset = await cmClient.createAssetFromFiles({
		fields: {
			title: {
				'en-US': file.title,
			},
			description: {
				'en-US': file.description,
			},
			file: {
				'en-US': {
					contentType,
					fileName,
					file: fs.createReadStream(file.fullpath),
				},
			},
		},
	});

	asset.metadata = {
		tags: createLinks(file.tags || [], 'Tag') as Link<'Tag'>[],
	};
	asset = await asset.update();
	return asset.processForLocale('en-US');
}
