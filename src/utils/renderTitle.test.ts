import figlet from 'figlet';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { mockConsole } from 'vitest-console';
import { renderTitle } from './renderTitle';

describe('renderTitle', () => {
	const { clearConsole, restoreConsole } = mockConsole({ quiet: true });
	afterEach(clearConsole);
	afterAll(restoreConsole);

	test('should render title', () => {
		renderTitle();
		expect(console).toHaveLoggedTimes(1);

		const text = figlet.textSync('Contentful Tools', {
			font: 'Small',
		});
		expect(console).toHaveLoggedWith(`\n${text}\n`);
	});
});
