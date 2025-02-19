import chalk from 'chalk';
import exceljs from 'exceljs';
import fs from 'node:fs';
import util from 'node:util';
import { Maybe } from '.';
import { logger } from './logger';

export interface Row {
	[x: string]: Maybe<string>;
	sysid?: string;
	model?: string;
	field?: string;
}

/**
 * Adjust the columns of the worksheet to match contents
 * From: https://stackoverflow.com/questions/63189741/how-to-autosize-column-width-in-exceljs
 * @param {Worksheet} worksheet
 * @param {number} maxColumnWidth optional
 */
export function adjustColumnWidth(worksheet: exceljs.Worksheet, maxColumnWidth = 200) {
	worksheet.columns.forEach((column) => {
		const widths = column.values?.map((v) => v?.toString().length).filter((v): v is number => true) || [];
		widths.push((column.header?.length || 0) + 6);
		const maxLength = Math.max(...widths);
		column.width = Math.min(maxColumnWidth, maxLength);
	});
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
 * Check if file is writeable
 * @param {string} filename
 */
export async function checkFileWriteable(filename: string) {
	const forever = true;
	while (forever) {
		try {
			if (fs.existsSync(filename)) {
				fs.openSync(filename, 'r+');
			}
			return;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'EBUSY') {
				console.log(`  File ${chalk.cyan(filename)} is locked. Please close excel.`);
			}
		}
		await sleep(2000);
	}
}

/**
 * Create a workbook given a map of rows
 * @param {sheets:Record<string, Row[]>} map of sheet names to rows
 * @returns {exceljs.Workbook} workbook
 */
export function createWorkbook(sheets: Record<string, Row[]>) {
	const wb = new exceljs.Workbook();

	for (const name of Object.keys(sheets)) {
		const rows = sheets[name];
		const colSet = new Set<string>();
		rows.forEach((r) => {
			Object.keys(r).forEach((k) => colSet.add(k));
		});
		const columns = Array.from(colSet).map((s) => ({ key: s, header: s }));
		const ws = wb.addWorksheet(name);
		ws.columns = columns;
		ws.addRows(rows, 'i+');
		adjustColumnWidth(ws);
	}

	return wb;
}

/**
 * Save workbook.  Will wait until excel can write to the file.
 * @param {exceljs.Workbook} workbook - workbook to save
 * @param {string} filename - filename to save
 */
export async function saveWorkbook(workbook: exceljs.Workbook, filename: string, verbose = true) {
	await checkFileWriteable(filename);
	await workbook.xlsx.writeFile(filename);
	if (verbose) {
		logger.succeed(`workbook saved ${chalk.cyan(filename)}`);
	}
}

/**
 * Load a workbook from the local drive
 *
 * @param {string} filepath - path of the xlsx file to load
 *
 * @return {Workbook} - xlsx workbook
 */
export async function loadWorkbook(filepath: string, options: { sheet?: string } = {}): Promise<exceljs.Workbook> {
	const wb = new exceljs.Workbook();
	try {
		await wb.xlsx.readFile(filepath);
	} catch (e) {
		const err = e as Error;
		// ask if this zip might be password protected
		if (err.message.includes('is this a zip file')) {
			console.log(`${chalk.redBright('[ERROR]')} Is this zip file is password protected?`);
		}
		throw err;
	}
	if (!options.sheet) {
		// we do this to ensure the user knows which sheet is going to be processed
		if (wb.views && wb.views[0].activeTab !== undefined) {
			console.log(
				`${chalk.redBright('[ERROR]')} ${chalk.cyan(filepath)} active worksheet tab is ${chalk.redBright(
					'not the first',
				)}. Please click on the first worksheet tab to select it, save the xlsx, and try again.`,
			);
			process.exit();
		}
	}
	return wb;
}

/**
 * Convert worksheet into json structure
 *
 * @param {exceljs.Worksheet} sheet - exceljs worksheet to parse
 */
export function worksheetToJson(sheet: exceljs.Worksheet): Row[] {
	const result: Row[] = [];
	const header: string[] = [];
	sheet.eachRow((row, i) => {
		if (i === 1) {
			// parse header
			row.eachCell((cell, j) => {
				header[j] = cell.text;
			});
		} else {
			// create data
			const rowData: Row = {};
			row.eachCell((cell, j) => {
				if (cell.value === null) {
					return;
				}
				if (typeof cell.value === 'object') {
					if (util.types.isDate(cell.value)) {
						// Fix the date object. It's by default UTC but converted to localtime
						const fixedDate = new Date(cell.value.toUTCString().replace('GMT', ''));
						rowData[header[j]] = fixedDate.toISOString();
					} else if (typeof cell.text === 'object') {
						const richTextValue = cell.value as exceljs.CellRichTextValue;
						// we convert richText to just a plain string
						// example of richText can be found here:
						// https://github.com/exceljs/exceljs/blob/5efb1c7115f86b483ada46ca82ca9f1d6baaf76e/spec/unit/xlsx/xform/strings/data/sharedStrings.json
						if (richTextValue.richText) {
							rowData[header[j]] = richTextValue.richText.map((t) => t.text).join('');
						}
					} else {
						rowData[header[j]] = cell.text;
					}
				} else {
					if (rowData[header[j]] !== undefined) {
						console.log(
							`${chalk.yellow('[WARN]')} Column ${chalk.cyan(header[j])} was previously set.  There are two columns with a header ${chalk.cyan(header[j])}.`,
						);
					}
					rowData[header[j]] = cell.text;
				}
			});
			result.push(rowData);
		}
	});

	return result;
}

/**
 * Lowercase the headers in the row
 * @param {object} row
 * @returns lowercased keys
 */
export function lowerCaseRow(row: Row) {
	const lcRow: Row = { id: '' };
	Object.entries(row).forEach(([key, value]) => {
		lcRow[key.toLowerCase().trim()] = value;
	});
	return lcRow;
}

/**
 * Get the default en-US column index
 * @param sheet
 * @returns
 */
export function getEnglishIndex(sheet: exceljs.Worksheet) {
	let column = -1;
	const row = sheet.getRow(1);
	row.eachCell((cell, colNumber) => {
		const value = cell?.text as string;
		if (value.toLowerCase() === 'en-US') {
			column = colNumber;
		}
	});
	return column;
}
