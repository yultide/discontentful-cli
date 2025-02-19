import chalk from 'chalk';
import ora from 'ora';

const progress = ora();

export const logger = {
	start: (msg: string) => {
		progress.text = msg;
		progress.start();
	},

	info: (...text: unknown[]) => {
		if (progress.isSpinning) {
			const prevText = progress.text;
			progress.info(text.join(' '));
			progress.text = prevText;
			progress.start();
		} else {
			console.log(chalk.cyan('ℹ'), ...text);
		}
	},
	warn: (...text: unknown[]) => {
		if (progress.isSpinning) {
			const prevText = progress.text;
			progress.warn(text.join(' '));
			progress.text = prevText;
			progress.start();
		} else {
			console.log(chalk.yellow('⚠'), ...text);
		}
	},
	succeed: (...text: unknown[]) => {
		if (progress.isSpinning) {
			progress.succeed();
		} else {
			console.log(chalk.green('✔'), ...text);
		}
	},
	error: (...text: unknown[]) => {
		if (progress.isSpinning) {
			progress.fail(text.join(' '));
		} else {
			console.log(chalk.red('⨯'), ...text);
		}
	},
};
