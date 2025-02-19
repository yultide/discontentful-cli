import { CommonNode, Next } from '@contentful/rich-text-html-renderer';
import { Block, BLOCKS, Document, Inline, MARKS, TableRow } from '@contentful/rich-text-types';
import { contentfulRichTextRenderer } from './rich-text-renderer';

/**
 * Convert richtext JSON structure to markdown for easier translation
 * @param {Document} doc
 * @return {string} markdown text
 */
export function richTextToMarkdown(richText: Document) {
	let inOL = false;
	let olCount = 1;
	// let inUL = false;
	let inTable = false;
	let inTableHeader = false;
	let tableColumnCount = 0;

	const options = {
		renderNode: {
			[BLOCKS.DOCUMENT]: (node: Block | Inline, next: Next) => `${next(node.content)}\n`,
			[BLOCKS.PARAGRAPH]: (node: Block | Inline, next: Next) => (inTable ? `${next(node.content)}<br/>` : `${next(node.content)}\n\n`),
			[BLOCKS.HEADING_1]: (node: Block | Inline, next: Next) => `# ${next(node.content)}\n`,
			[BLOCKS.HEADING_2]: (node: Block | Inline, next: Next) => `## ${next(node.content)}\n`,
			[BLOCKS.HEADING_3]: (node: Block | Inline, next: Next) => `### ${next(node.content)}\n`,
			[BLOCKS.HEADING_4]: (node: Block | Inline, next: Next) => `#### ${next(node.content)}\n`,
			[BLOCKS.HEADING_5]: (node: Block | Inline, next: Next) => `##### ${next(node.content)}\n`,
			[BLOCKS.HEADING_6]: (node: Block | Inline, next: Next) => `###### ${next(node.content)}\n`,
			[BLOCKS.OL_LIST]: (node: Block | Inline, next: Next) => {
				inOL = true;
				olCount = 1;
				const result = `${next(node.content)}\n`;
				inOL = false;
				return result;
			},
			[BLOCKS.UL_LIST]: (node: Block | Inline, next: Next) => {
				// inUL = true;
				const result = `${next(node.content)}\n`;
				// inUL = false;
				return result;
			},
			[BLOCKS.LIST_ITEM]: (node: Block | Inline, next: Next) => {
				const result = `${inOL ? `${olCount}.` : ' *'} ${next(node.content)}`;
				olCount += 1;
				return result;
			},
			[BLOCKS.HR]: (/* node: Block | Inline, next: Next */) => `----------\n`,
			// [BLOCKS.QUOTE]: (node: Block | Inline, next: Next) => `> ${next(node.content).replace('\n', '\n> ')}\n`,
			[BLOCKS.QUOTE]: (node: Block | Inline, next: Next) => {
				const out = next(node.content);
				const result = out
					.split(/\n/g)
					.map((l) => `> ${l}`)
					.join('\n');
				return `${result}\n`;
			},
			[BLOCKS.EMBEDDED_ENTRY]: (node: Block | Inline) => `![embedded-entry-block](${node.data.target.sys.id})`,
			[BLOCKS.EMBEDDED_ASSET]: (node: Block | Inline) => `![embedded-asset-block](${node.data.target.sys.id})`,
			[BLOCKS.TABLE]: (node: Block | Inline, next: Next) => {
				inTable = true;
				const tableRows = node.content as TableRow[];
				tableColumnCount = tableRows[0].content.length;
				inTableHeader = true;
				const tableHeader = next([tableRows[0] as CommonNode]);
				inTableHeader = false;
				const result = [
					`${tableHeader}`,
					`|${Array.from(Array(tableColumnCount).keys())
						.map(() => '--|')
						.join('')}\n`,
					`${next(tableRows.slice(1) as CommonNode[])}`,
				].join('');
				inTable = false;
				return `${result}\n`;
			},
			[BLOCKS.TABLE_ROW]: (node: Block | Inline, next: Next) => `| ${next(node.content)}\n`,
			[BLOCKS.TABLE_CELL]: (node: Block | Inline, next: Next) => ` ${next(node.content).replace(/\n/g, inTableHeader ? '' : '<br/>')} |`,
			[BLOCKS.TABLE_HEADER_CELL]: (node: Block | Inline, next: Next) => ` ${next(node.content).replace(/\n/g, inTableHeader ? '' : '<br/>')} |`,
		},
		renderMark: {
			[MARKS.BOLD]: (text: string) => (text.trim() ? `**${text.trim()}**` : ''),
			[MARKS.ITALIC]: (text: string) => (text.trim() ? `_${text.trim()}_` : ''),
			[MARKS.UNDERLINE]: (text: string) => `<u>${text.trim()}</u>`,
			[MARKS.CODE]: (text: string) => `\`${text}\``,
			[MARKS.SUPERSCRIPT]: (text: string) => `<sup>${text.trim()}</sup>`,
			[MARKS.SUBSCRIPT]: (text: string) => `<sub>${text.trim()}</sub>`,
		},
	};

	const result = contentfulRichTextRenderer(richText, options);
	return result;
}
