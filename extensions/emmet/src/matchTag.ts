/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import parse from '@emmetio/html-matcher';
import { HtmlNode } from 'EmmetNode';
import { DocumentStreamReader } from './bufferStream';
import { getNode, validate, getTemplateScriptNestedNode, isTemplateScript } from './util';


export function matchTag() {
	if (!validate(false) || !vscode.window.activeTextEditor) {
		return;
	}

	const editor = vscode.window.activeTextEditor;
	let rootNode: HtmlNode;

	try {
		rootNode = parse(new DocumentStreamReader(editor.document));
		if (!rootNode) {
			return;
		}
	} catch (e) {
		vscode.window.showErrorMessage('Emmet: Failed to parse the file');
		return;
	}


	let updatedSelections: vscode.Selection[] = [];
	editor.selections.forEach(selection => {
		let updatedSelection = getUpdatedSelections(editor, selection.start, rootNode);
		if (updatedSelection) {
			updatedSelections.push(updatedSelection);
		}
	});
	if (updatedSelections.length > 0) {
		editor.selections = updatedSelections;
		editor.revealRange(editor.selections[updatedSelections.length - 1]);
	}
}

function getUpdatedSelections(editor: vscode.TextEditor, position: vscode.Position, rootNode: HtmlNode): vscode.Selection | undefined {
	let currentNode = <HtmlNode>getNode(rootNode, position, true);
	if (!currentNode) { return; }

	if (isTemplateScript(currentNode)) {
		let nestedNode = getTemplateScriptNestedNode(editor.document, currentNode, position);
		currentNode = nestedNode ? nestedNode : currentNode;
	}

	// If no closing tag or cursor is between open and close tag, then no-op
	if (!currentNode.close || (position.isAfter(currentNode.open.end) && position.isBefore(currentNode.close.start))) {
		return;
	}

	// Place cursor inside the close tag if cursor is inside the open tag, else place it inside the open tag
	let finalPosition = position.isBeforeOrEqual(currentNode.open.end) ? currentNode.close.start.translate(0, 2) : currentNode.open.start.translate(0, 1);
	return new vscode.Selection(finalPosition, finalPosition);
}