import figlet from 'figlet';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { mockConsole } from 'vitest-console';
import { renderTitle } from './renderTitle';

describe('renderTitle', () => {
	const { clearConsole, restoreConsole } = mockConsole({ quiet: true });
	afterEach(clearConsole);
	afterAll(restoreConsole);

	test('should render title', () => {
		const result = renderTitle();

		const text = figlet.textSync('Discontentful CLI', {
			font: 'Small',
		});
		expect(result).toEqual(text);
	});
});
