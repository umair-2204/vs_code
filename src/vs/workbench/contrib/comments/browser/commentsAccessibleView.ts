/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { MarshalledId } from '../../../../base/common/marshallingIds.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { AccessibleViewProviderId, AccessibleViewType, IAccessibleViewContentProvider } from '../../../../platform/accessibility/browser/accessibleView.js';
import { IAccessibleViewImplentation } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';
import { COMMENTS_VIEW_ID, CommentsMenus } from './commentsTreeViewer.js';
import { CommentsPanel, CONTEXT_KEY_COMMENT_FOCUSED } from './commentsView.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ICommentService } from './commentService.js';
import { CommentContextKeys } from '../common/commentContextKeys.js';
import { revealCommentThread } from './commentsController.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { URI } from '../../../../base/common/uri.js';

export class CommentsAccessibleView extends Disposable implements IAccessibleViewImplentation {
	readonly priority = 90;
	readonly name = 'comment';
	readonly when = CONTEXT_KEY_COMMENT_FOCUSED;
	readonly type = AccessibleViewType.View;
	getProvider(accessor: ServicesAccessor) {
		const contextKeyService = accessor.get(IContextKeyService);
		const viewsService = accessor.get(IViewsService);
		const menuService = accessor.get(IMenuService);
		const commentsView = viewsService.getActiveViewWithId<CommentsPanel>(COMMENTS_VIEW_ID);
		const focusedCommentNode = commentsView?.focusedCommentNode;

		if (!commentsView || !focusedCommentNode) {
			return;
		}
		const menus = this._register(new CommentsMenus(menuService));
		menus.setContextKeyService(contextKeyService);

		return new CommentsAccessibleContentProvider(commentsView, focusedCommentNode, menus);
	}
	constructor() {
		super();
	}
}


export class CommentThreadAccessibleView extends Disposable implements IAccessibleViewImplentation {
	readonly priority = 85;
	readonly name = 'commentThread';
	readonly when = CommentContextKeys.commentFocused;
	readonly type = AccessibleViewType.View;
	getProvider(accessor: ServicesAccessor) {
		const commentService = accessor.get(ICommentService);
		const editorService = accessor.get(IEditorService);
		const uriIdentityService = accessor.get(IUriIdentityService);
		const threads = commentService.commentsModel.hasCommentThreads();
		if (!threads) {
			return;
		}
		return new CommentsThreadWidgetAccessibleContentProvider(commentService, editorService, uriIdentityService);
	}
	constructor() {
		super();
	}
}


class CommentsAccessibleContentProvider extends Disposable implements IAccessibleViewContentProvider {
	constructor(
		private readonly _commentsView: CommentsPanel,
		private readonly _focusedCommentNode: any,
		private readonly _menus: CommentsMenus,
	) {
		super();
	}
	readonly id = AccessibleViewProviderId.Comments;
	readonly verbositySettingKey = AccessibilityVerbositySettingId.Comments;
	readonly options = { type: AccessibleViewType.View };
	public actions = [...this._menus.getResourceContextActions(this._focusedCommentNode)].filter(i => i.enabled).map(action => {
		return {
			...action,
			run: () => {
				this._commentsView.focus();
				action.run({
					thread: this._focusedCommentNode.thread,
					$mid: MarshalledId.CommentThread,
					commentControlHandle: this._focusedCommentNode.controllerHandle,
					commentThreadHandle: this._focusedCommentNode.threadHandle,
				});
			}
		};
	});
	provideContent(): string {
		const commentNode = this._commentsView.focusedCommentNode;
		const content = this._commentsView.focusedCommentInfo?.toString();
		if (!commentNode || !content) {
			throw new Error('Comment tree is focused but no comment is selected');
		}
		return content;
	}
	onClose(): void {
		this._commentsView.focus();
	}
	provideNextContent(): string | undefined {
		this._commentsView.focusNextNode();
		return this.provideContent();
	}
	providePreviousContent(): string | undefined {
		this._commentsView.focusPreviousNode();
		return this.provideContent();
	}
}

class CommentsThreadWidgetAccessibleContentProvider extends Disposable implements IAccessibleViewContentProvider {
	readonly id = AccessibleViewProviderId.CommentThread;
	readonly verbositySettingKey = AccessibilityVerbositySettingId.Comments;
	readonly options = { type: AccessibleViewType.View };
	constructor(@ICommentService private readonly _commentService: ICommentService,
		@IEditorService private readonly _editorService: IEditorService,
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService,
	) {
		super();
	}
	provideContent(): string {
		if (!this._commentService.activeCommentInfo) {
			throw new Error('No current comment thread');
		}
		const comment = this._commentService.activeCommentInfo.comment?.body;
		const commentLabel = typeof comment === 'string' ? comment : comment?.value ?? '';
		const resource = this._commentService.activeCommentInfo.thread.resource;
		const range = this._commentService.activeCommentInfo.thread.range;
		let contentLabel = '';
		if (resource && range) {
			const editor = this._editorService.findEditors(URI.parse(resource)) || [];
			const codeEditor = this._editorService.activeEditorPane?.getControl();
			if (editor?.length && isCodeEditor(codeEditor)) {
				const content = codeEditor.getModel()?.getValueInRange(range);
				if (content) {
					contentLabel = '\nCorresponding code: \n' + content;
				}
			}
		}
		return commentLabel + contentLabel;
	}
	onClose(): void {
		const commentInfo = this._commentService.activeCommentInfo;
		if (!commentInfo) {
			return;
		}
		// TODO: is there a way to focus the comment not the thread?
		this._commentService.setActiveCommentAndThread(commentInfo.owner, { comment: commentInfo.comment, thread: commentInfo.thread });
		revealCommentThread(this._commentService, this._editorService, this._uriIdentityService, commentInfo.thread, commentInfo.comment);
	}
	provideNextContent(): string | undefined {
		this._commentService.navigateToCommentAndThread('next');
		return this.provideContent();
	}
	providePreviousContent(): string | undefined {
		this._commentService.navigateToCommentAndThread('previous');
		return this.provideContent();
	}
}
