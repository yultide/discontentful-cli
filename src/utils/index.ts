import chalk from 'chalk';
import { mkdirp } from 'mkdirp';
import fetch from 'node-fetch';
import { execSync } from 'node:child_process';
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
	if (process.platform === 'darwin') {
		execSync(`open "${filePath}"`);
	} else if (process.platform === 'win32') {
		try {
			execSync(`explorer "${filePath}"`);
		} catch {
			// we don't care about exceptions
		}
	}
}

const iso8601RegEx = /\d{4}-[01]\d-[0-3]\d(T[0-2]\d:[0-5]\d)?/;
export function isDateString(str: string) {
	return str.match(iso8601RegEx);
}

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
			const stdout = execSync(`where ${cleanedCommandName}`, { stdio: [] });
			return !!stdout;
		}
		const stdout = execSync(`command -v ${cleanedCommandName}`);
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
