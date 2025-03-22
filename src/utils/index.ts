import chalk from 'chalk';
import { mkdirp } from 'mkdirp';
import fetch from 'node-fetch';
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export type Maybe<T> = NonNullable<T> | undefined | null;

/**
 * Check if value is not empty
 * @param {TValue|null|undefined} value value to check if null
 * @returns {boolean} true or false
 */
export function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
	return value !== null && value !== undefined;
}

/**
 * Read file from disk
 * @param {string} filename
 * @returns {string} file contents
 */
export function readFile(filename: string): string {
	return fs.readFileSync(filename).toString();
}

/**
 * Read json file from disk
 * @param {string} filename
 * @returns {any} parsed json structure
 */
export function readJsonFile(filename: string) {
	return JSON.parse(readFile(filename));
}

/**
 * Write contents to file
 * @param {string} filename
 * @param {string} content
 */
export function writeFile(filename: string, content: string) {
	fs.writeFileSync(filename, content);
}

/**
 * Download a file from a given url
 * @param url which url to download from
 * @param filePath path to save to
 * @returns content type of file if succeeds or throws an error
 */
export async function downloadFile(url: string, filePath: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`unable to download ${url} status=${res.status} ${await res.text()}`);
	}
	const fileStream = fs.createWriteStream(filePath);
	return new Promise((resolve, reject) => {
		res.body?.pipe(fileStream);
		res.body?.on('error', (err) => {
			reject(err);
		});
		fileStream.on('finish', () => {
			if (filePath.endsWith('.xlsx')) {
				openFile(filePath);
			}
			resolve(res.headers.get('content-type') || 'application/octet-stream');
		});
	});
}

/**
 * Open the file using the appropriate application
 * @param {string} filePath
 */
export function openFile(filePath: string) {
	console.log(`Opening ${chalk.blue(filePath)}`);
	if (['darwin', 'linux'].includes(process.platform)) {
		cp.execSync(`open "${filePath}"`);
	} else if (process.platform === 'win32') {
		try {
			cp.execSync(`explorer "${filePath}"`);
		} catch {
			// we don't care about exceptions
		}
	}
}

/**
 * Check if a string is a valid iso 8601 date string
 * @param {string} str
 */
const iso8601RegEx = /^(\d{4})-([01]\d)-([0-3]\d)(?:T([01]\d|2[0-3]):([0-5]\d):([0-5]\d|60)(?:\.\d+)?(?:Z|[+-][01]\d:[0-5]\d)?)?$/;
export function isDateString(str: string): boolean {
	const match = str.match(iso8601RegEx);
	if (!match) return false;

	const [, year, month, day] = match;
	const monthNum = parseInt(month, 10);
	const dayNum = parseInt(day, 10);

	// Check if the day is valid for the given month
	const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	const isLeapYear = (yearNum: number) => (yearNum % 4 === 0 && yearNum % 100 !== 0) || yearNum % 400 === 0;

	const yearNum = parseInt(year, 10);
	if (monthNum === 2 && isLeapYear(yearNum)) {
		return dayNum <= 29;
	}

	return dayNum <= daysInMonth[monthNum - 1];
}

/**
 * sleep using async/await
 * @param {number} ms - number of milliseconds to sleep
 */
export function sleep(ms: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Check if an external command exists
 * @param cmd
 * @returns
 */
export function commandExists(cmd: string) {
	const cleanInput = (input: string) => {
		let s = input;
		if (/[^A-Za-z0-9_/:=-]/.test(s)) {
			s = `'${s.replace(/'/g, "'\\''")}'`;
			s = s
				.replace(/^(?:'')+/g, '') // unduplicate single-quote at the beginning
				.replace(/\\'''/g, "\\'"); // remove non-escaped single-quote if there are enclosed between 2 escaped
		}
		return s;
	};
	const cleanedCommandName = cleanInput(cmd);
	const isWindows = process.platform === 'win32';
	try {
		if (isWindows) {
			const stdout = cp.execSync(`where ${cleanedCommandName}`, { stdio: [] });
			return !!stdout;
		}
		const stdout = cp.execSync(`command -v ${cleanedCommandName}`);
		return !!stdout;
	} catch {
		return false;
	}
}

export async function compressImage(files: string[]) {
	const compressedPaths: string[] = [];

	for (const file of files) {
		const [filePath, queryStr] = file.replace('file://', '').split('?');

		const params = new URLSearchParams(queryStr);
		const quality = parseInt(params?.get('quality') || '', 10) || 90;

		const fullpath = path.resolve(filePath);
		const filename = path.basename(file);
		const ext = path.extname(fullpath);
		mkdirp.sync(path.join(path.dirname(fullpath), 'compressed'));
		const compressedPath = path.join(path.dirname(fullpath), 'compressed', filename.replace(ext, '.jpg'));
		await sharp(fullpath).jpeg({ mozjpeg: true, chromaSubsampling: '4:4:4', quality }).toFile(compressedPath);
		compressedPaths.push(compressedPath);
	}
	return compressedPaths;
}
