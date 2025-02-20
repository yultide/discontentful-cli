import { password, select } from '@inquirer/prompts';
import chalk from 'chalk';
import contentful, { ClientAPI } from 'contentful-management';

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
		message: 'Select Environment to use',
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
