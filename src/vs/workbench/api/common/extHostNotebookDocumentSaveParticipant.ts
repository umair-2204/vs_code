/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { AsyncEmitter, Event } from 'vs/base/common/event';
import { LinkedList } from 'vs/base/common/linkedList';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { ExtHostNotebookDocumentSaveParticipantShape, IWorkspaceEditDto, MainThreadBulkEditsShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { NotebookDocumentSaveReason, WorkspaceEdit as WorksapceEditConverter } from 'vs/workbench/api/common/extHostTypeConverters';
import { WorkspaceEdit } from 'vs/workbench/api/common/extHostTypes';
import { SaveReason } from 'vs/workbench/common/editor';
import { NotebookDocumentWillSaveEvent } from 'vscode';

interface IExtensionListener<E> {
	extension: IExtensionDescription;
	(e: E): any;
}

type Listener = [Function, any, IExtensionDescription];
export class ExtHostNotebookDocumentSaveParticipant implements ExtHostNotebookDocumentSaveParticipantShape {
	private readonly _callbacks = new LinkedList<Listener>();

	private readonly _onWillSaveNotebookDocumentEvent = new AsyncEmitter<NotebookDocumentWillSaveEvent>();

	constructor(
		private readonly _logService: ILogService,
		private readonly _notebooksAndEditors: ExtHostNotebookController,
		private readonly _mainThreadBulkEdits: MainThreadBulkEditsShape,
		private readonly _thresholds: { timeout: number; errors: number } = { timeout: 1500, errors: 3 }) {

	}

	dispose(): void {
		this._callbacks.clear();
	}

	getOnWillSaveNotebookDocumentEvent(extension: IExtensionDescription): Event<NotebookDocumentWillSaveEvent> {
		return (listener, thisArg, disposables) => {
			const wrappedListener: IExtensionListener<NotebookDocumentWillSaveEvent> = function wrapped(e) { listener.call(thisArg, e); };
			wrappedListener.extension = extension;
			return this._onWillSaveNotebookDocumentEvent.event(wrappedListener, undefined, disposables);
		};
	}

	async $participateInSave(resource: UriComponents, reason: SaveReason, token: CancellationToken): Promise<boolean> {
		const revivedUri = URI.revive(resource);
		const document = this._notebooksAndEditors.getNotebookDocument(revivedUri);

		if (!document) {
			throw new Error('Unable to resolve notebook document');
		}

		const edits: WorkspaceEdit[] = [];

		await this._onWillSaveNotebookDocumentEvent.fireAsync({ document: document.apiNotebook, reason: NotebookDocumentSaveReason.to(reason) }, token, async (thenable: Promise<unknown>, listener) => {
			const now = Date.now();
			const data = await await Promise.resolve(thenable);
			if (Date.now() - now > this._thresholds.timeout) {
				this._logService.warn('onWillSaveNotebookDocument-listener from extension', (<IExtensionListener<NotebookDocumentWillSaveEvent>>listener).extension.identifier);
			}

			if (token.isCancellationRequested) {
				return;
			}

			if (data && Array.isArray(data)) {
				// data can be an array of WorkspaceEdit
				for (const edit of data) {
					if (edit instanceof WorkspaceEdit) {
						edits.push(edit);
					} else {
						// ignore invalid data
						this._logService.warn('onWillSaveNotebookDocument-listener from extension', (<IExtensionListener<NotebookDocumentWillSaveEvent>>listener).extension.identifier, 'ignored due to invalid data');
					}
				}
			}

			return;
		});

		if (token.isCancellationRequested) {
			return false;
		}

		if (edits.length === 0) {
			return true;
		}

		const dto: IWorkspaceEditDto = { edits: [] };
		for (const edit of edits) {
			const { edits } = WorksapceEditConverter.from(edit);
			dto.edits = dto.edits.concat(edits);
		}

		return this._mainThreadBulkEdits.$tryApplyWorkspaceEdit(dto);
	}
}
