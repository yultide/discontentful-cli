import { Block, BLOCKS, Document, Hyperlink, Inline, INLINES, ListItem, Node, Paragraph, Text, TopLevelBlock } from '@contentful/rich-text-types';
import { Link } from 'contentful-management';
import _ from 'lodash';
import gfm from 'remark-gfm';
import markdown from 'remark-parse';
import { unified } from 'unified';
import { createLink } from '../contentful';

export interface MarkdownNode extends MarkdownTree {
	depth: string;
	type: string;
	ordered: boolean;
	value: string;
	start?: number;
}

export interface MarkdownTree {
	children: MarkdownNode[];
}

// COMPAT: can resolve with either Node or an array of Nodes for back compatibility.
export type FallbackResolver = (mdNode: MarkdownNode, appliedMarksTypes: string[]) => Promise<Node | Node[] | null>;

export interface EmbeddedNode extends Node {
	nodeType: 'embedded-asset-block' | 'embedded-entry-block' | 'embedded-inline-block';
	content: [];
	data: {
		target: Link<'Asset' | 'Entry'>;
	};
}

export interface MarkdownLinkNode extends MarkdownNode {
	alt?: string;
	url: string;
}

let tableRowCount = 0;

let anchorNode: MarkdownNode | undefined;
let anchorChildNodes: Node[] | undefined;

const markdownNodeTypes = new Map<string, string>([
	['paragraph', BLOCKS.PARAGRAPH],
	['heading', 'heading'],
	['text', 'text'],
	['emphasis', 'text'],
	['strong', 'text'],
	['delete', 'text'],
	['inlineCode', 'text'],
	['link', INLINES.HYPERLINK],
	['thematicBreak', BLOCKS.HR],
	['blockquote', BLOCKS.QUOTE],
	['list', 'list'],
	['listItem', BLOCKS.LIST_ITEM],
	['table', BLOCKS.TABLE],
	['tableRow', BLOCKS.TABLE_ROW],
	['tableCell', BLOCKS.TABLE_CELL],
]);

const nodeTypeFor = (node: MarkdownNode) => {
	const nodeType = markdownNodeTypes.get(node.type) || '';

	switch (nodeType) {
		case 'heading':
			return `${nodeType}-${node.depth}`;
		case 'list':
			return `${node.ordered ? 'ordered' : 'unordered'}-list`;
		default:
			return nodeType;
	}
};

const markTypes = new Map([
	['emphasis', 'italic'],
	['strong', 'bold'],
	['inlineCode', 'code'],
	['blockquote', 'code'],
	['delete', 'strikethrough'],
]);
const markTypeFor = (node: MarkdownNode) => markTypes.get(node.type);

const isLink = (node: MarkdownNode): node is MarkdownLinkNode => node.type === 'link';

const nodeContainerTypes = new Map([
	['delete', 'block'],
	[BLOCKS.HEADING_1, 'block'],
	[BLOCKS.HEADING_2, 'block'],
	[BLOCKS.HEADING_3, 'block'],
	[BLOCKS.HEADING_4, 'block'],
	[BLOCKS.HEADING_5, 'block'],
	[BLOCKS.HEADING_6, 'block'],
	[BLOCKS.LIST_ITEM, 'block'],
	[BLOCKS.UL_LIST, 'block'],
	[BLOCKS.OL_LIST, 'block'],
	[BLOCKS.QUOTE, 'text'],
	[BLOCKS.HR, 'block'],
	[BLOCKS.PARAGRAPH, 'block'],
	[BLOCKS.TABLE, 'block'],
	[BLOCKS.TABLE_CELL, 'block'],
	[BLOCKS.TABLE_HEADER_CELL, 'block'],
	[BLOCKS.TABLE_ROW, 'block'],
	[INLINES.HYPERLINK, 'inline'],
	['text', 'text'],
	['emphasis', 'text'],
	['strong', 'text'],
	['inlineCode', 'text'],
]);

const isBlock = (nodeType: string) => nodeContainerTypes.get(nodeType) === 'block';

const isText = (nodeType: string) => nodeContainerTypes.get(nodeType) === 'text';

const isInline = (nodeType: string) => nodeContainerTypes.get(nodeType) === 'inline';

const isTableCell = (nodeType: string) => nodeType === BLOCKS.TABLE_CELL;

const buildHyperlink = async (node: MarkdownLinkNode, fallback: FallbackResolver, appliedMarksTypes: string[]): Promise<Hyperlink[]> => {
	const content = (await mdToRichTextNodes(node.children, fallback, appliedMarksTypes)) as Text[];

	const hyperlink: Hyperlink = {
		nodeType: INLINES.HYPERLINK,
		data: { uri: node.url },
		content,
	};

	return [hyperlink];
};

const buildGenericBlockOrInline = async (node: MarkdownNode, fallback: FallbackResolver, appliedMarksTypes: string[]): Promise<Array<Block | Inline>> => {
	let nodeType = nodeTypeFor(node);
	let content = await mdToRichTextNodes(node.children, fallback, appliedMarksTypes);

	// HACK: convert single item ordered list to paragraph
	if (nodeType === 'ordered-list' && content.length === 1) {
		if (content[0].nodeType === 'list-item') {
			const listItem = content[0] as ListItem;
			const listItemContent = listItem.content as Node[];
			if (listItemContent[0].nodeType === 'paragraph') {
				content = (listItemContent[0] as Paragraph).content;
				const text = content[0] as Text;
				content[0] = { ...content[0], value: `${node.start}. ${text.value}` } as Node;
				nodeType = listItemContent[0].nodeType;
			}
		}
	}

	return [
		{
			nodeType,
			content,
			data: {},
		} as Block | Inline,
	];
};

const buildTableCell = async (node: MarkdownNode, fallback: FallbackResolver, appliedMarksTypes: string[], rowCount: number): Promise<Array<Block>> => {
	const nodeChildren = await mdToRichTextNodes(node.children, fallback, appliedMarksTypes);

	const content = nodeChildren.map((contentNode) => ({
		nodeType: BLOCKS.PARAGRAPH,
		data: {},
		content: [contentNode],
	}));

	// A table cell can't be empty
	if (content.length === 0) {
		content.push({
			nodeType: BLOCKS.PARAGRAPH,
			data: {},
			content: [
				{
					nodeType: 'text',
					data: {},
					marks: [],
					value: '',
				} as Text,
			],
		});
	}

	/**
	 * We should only support texts inside table cells.
	 * Some markdowns might contain html inside tables such as <ul>, <blockquote>, etc
	 * but they are pretty much filtered out by markdownNodeTypes and nodeContainerTypes variables.
	 * so we ended up receiving only `text` nodes.
	 * We can't have table cells with text nodes directly, we must wrap text nodes inside paragraphs.
	 */
	return [
		{
			nodeType: rowCount === 1 ? BLOCKS.TABLE_HEADER_CELL : BLOCKS.TABLE_CELL,
			content,
			data: {},
		} as Block,
	];
};

const buildText = async (node: MarkdownNode, fallback: FallbackResolver, appliedMarksTypes: string[]): Promise<Array<Inline | Text>> => {
	const nodeType = nodeTypeFor(node);
	const markType = markTypeFor(node);
	const marks = [...appliedMarksTypes];
	if (markType) {
		marks.push(markType);
	}

	if (node.type !== 'text' && node.children) {
		return (await mdToRichTextNodes(node.children, fallback, marks)) as Array<Inline | Text>;
	}

	if (node.value) {
		return [
			{
				nodeType,
				value: node.value,
				marks: marks.map((type) => ({ type })),
				data: {},
			} as Text,
		];
	}
	return [];
};

const defaultFallback = async (mdNode: MarkdownNode, appliedMarksTypes: string[]) => {
	// handle underline
	switch (mdNode.value) {
		case '<u>':
			appliedMarksTypes.push('underline');
			break;
		case '</u>':
			appliedMarksTypes.splice(appliedMarksTypes.indexOf('underline'), 1);
			break;
		default:
			break;
	}

	if (mdNode.value?.startsWith('<a')) {
		anchorNode = mdNode;
		anchorChildNodes = [];
		return null;
	}
	if (mdNode.value === '</a>') {
		const match = anchorNode?.value.match(/href="([^"]+)"/);
		const uri = match?.[1];
		const content = anchorChildNodes;
		anchorChildNodes = undefined;
		anchorNode = undefined;
		return {
			nodeType: 'hyperlink',
			content,
			data: {
				uri,
			},
		};
	}

	// handle embeds
	const node = mdNode as MarkdownLinkNode;
	switch (node?.alt) {
		case 'embedded-asset-block': {
			return {
				nodeType: 'embedded-asset-block',
				content: [],
				data: {
					target: createLink(node?.url || '', 'Asset'),
				},
			};
		}
		case 'embedded-entry-block': {
			return {
				nodeType: 'embedded-entry-block',
				content: [],
				data: {
					target: createLink(node?.url || '', 'Entry'),
				},
			};
		}
		default:
			return null;
	}
};

const buildFallbackNode = async (node: MarkdownNode, fallback: FallbackResolver, appliedMarksTypes: string[] = []): Promise<Node[]> => {
	// handle fallback
	const fallbackResult = (await defaultFallback(node, appliedMarksTypes)) || (await fallback(node, appliedMarksTypes));

	if (_.isArray(fallbackResult)) {
		return fallbackResult;
	}
	if (!fallbackResult) {
		return [];
	}
	return [fallbackResult];
};

async function mdToRichTextNode(node: MarkdownNode, fallback: FallbackResolver, appliedMarksTypes: string[] = []): Promise<Node[]> {
	const nodeType = nodeTypeFor(node);

	if (isLink(node)) {
		return buildHyperlink(node, fallback, appliedMarksTypes);
	}

	if (isTableCell(nodeType)) {
		return buildTableCell(node, fallback, appliedMarksTypes, tableRowCount);
	}

	if (isBlock(nodeType) || isInline(nodeType)) {
		if (nodeType === 'table') {
			tableRowCount = 0;
		}
		if (nodeType === 'table-row') {
			tableRowCount += 1;
		}

		if (nodeType === 'ordered-list') {
			// write raw
		}

		return buildGenericBlockOrInline(node, fallback, appliedMarksTypes);
	}

	if (isText(nodeType)) {
		return buildText(node, fallback, appliedMarksTypes);
	}

	return buildFallbackNode(node, fallback, appliedMarksTypes);
}

async function mdToRichTextNodes(nodes: MarkdownNode[], fallback: FallbackResolver, appliedMarksTypes: string[] = []): Promise<Node[]> {
	if (!nodes) {
		return Promise.resolve([]);
	}

	const rtNodes: Node[][] = [];
	for (const node of nodes) {
		const n = await mdToRichTextNode(node, fallback, appliedMarksTypes);
		// save nodes if we are processing an anchor
		if (anchorChildNodes) {
			anchorChildNodes = [...anchorChildNodes, ...n.filter((x) => x.nodeType === 'text')];
		} else {
			rtNodes.push(n);
		}
	}

	return _.flatten(rtNodes).filter(Boolean);
}

const astToRichTextDocument = async (tree: MarkdownTree, fallback: FallbackResolver): Promise<Document> => {
	const content = await mdToRichTextNodes(tree.children, fallback);
	return {
		nodeType: BLOCKS.DOCUMENT,
		data: {},
		content: content as TopLevelBlock[],
	};
};

function expandParagraphWithInlineImages(node: MarkdownNode): MarkdownNode[] {
	if (node.type !== 'paragraph') {
		return [node];
	}
	const imageNodeIndices: number[] = [];
	for (let i = 0; i < node.children.length; i++) {
		if (node.children[i].type === 'image') {
			imageNodeIndices.push(i);
		}
	}

	if (imageNodeIndices.length === 0) {
		// If no images in children, return.
		return [node];
	}
	const allNodes: MarkdownNode[] = [];
	let lastIndex = -1;
	for (let j = 0; j < imageNodeIndices.length; j++) {
		const index = imageNodeIndices[j];
		// before
		if (index !== 0) {
			const nodesBefore: MarkdownNode[] = node.children.slice(lastIndex + 1, index);

			if (nodesBefore.length > 0) {
				allNodes.push({
					...node,
					children: nodesBefore,
				});
			}
		}
		// image
		const imageNode = node.children[index];
		allNodes.push(imageNode);

		// till end
		let nodesAfter: MarkdownNode[] = [];
		const rangeEnd = j + 1 < imageNodeIndices.length ? imageNodeIndices[j + 1] : node.children.length;
		if (index + 1 < rangeEnd && index === imageNodeIndices.slice(-1)[0]) {
			nodesAfter = node.children.slice(index + 1, rangeEnd);

			if (nodesAfter.length > 0) {
				allNodes.push({
					...node,
					children: nodesAfter,
				});
			}
		}
		lastIndex = index;
	}
	return allNodes;
}

// Inline markdown images come in as nested within a MarkdownNode paragraph
// so we must hoist them out before transforming to rich text.
export function prepareMdAST(ast: MarkdownTree): MarkdownNode {
	function prepareASTNodeChildren(node: MarkdownNode): MarkdownNode {
		if (!node.children) {
			return node;
		}

		const children = _.flatMap(node.children, (n) => expandParagraphWithInlineImages(n)).map((n) => prepareASTNodeChildren(n));

		return { ...node, children };
	}

	return prepareASTNodeChildren({
		depth: '0',
		type: 'root',
		value: '',
		ordered: true,
		children: ast.children,
	});
}

export function markdownAst(md: string) {
	const processor = unified().use(markdown).use(gfm);
	const tree = processor.parse(md) as unknown as MarkdownTree;
	const ast = prepareMdAST(tree);
	return ast;
}

export async function richTextFromMarkdown(markdownText: string, fallback: FallbackResolver = () => Promise.resolve(null)): Promise<Document> {
	const md = markdownText
		// markdown parser considers chinese "。" a space so it doesn't properly parse bold
		// this will swap the period to be outside of the bold
		.replace(/。\*\*/g, '**。');

	const ast = markdownAst(md);
	const richText = await astToRichTextDocument(ast, fallback);
	return richText;
}
