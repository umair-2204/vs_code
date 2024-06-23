/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { renderFormattedText } from 'vs/base/browser/formattedTextRenderer';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IActionViewItemOptions } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { getDefaultHoverDelegate } from 'vs/base/browser/ui/hover/hoverDelegateFactory';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { IAction } from 'vs/base/common/actions';
import { coalesce, distinct } from 'vs/base/common/arrays';
import { Codicon } from 'vs/base/common/codicons';
import { Emitter, Event } from 'vs/base/common/event';
import { FuzzyScore } from 'vs/base/common/filters';
import { IMarkdownString, MarkdownString } from 'vs/base/common/htmlContent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore, IDisposable, dispose, toDisposable } from 'vs/base/common/lifecycle';
import { ResourceMap } from 'vs/base/common/map';
import { FileAccess } from 'vs/base/common/network';
import { clamp } from 'vs/base/common/numbers';
import { autorun } from 'vs/base/common/observable';
import { ThemeIcon } from 'vs/base/common/themables';
import { URI } from 'vs/base/common/uri';
import { MarkdownRenderer } from 'vs/editor/browser/widget/markdownRenderer/browser/markdownRenderer';
import { localize } from 'vs/nls';
import { IMenuEntryActionViewItemOptions, MenuEntryActionViewItem, createActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { MenuWorkbenchToolBar } from 'vs/platform/actions/browser/toolbar';
import { MenuId, MenuItemAction } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILogService } from 'vs/platform/log/common/log';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ChatTreeItem, GeneratingPhrase, IChatCodeBlockInfo, IChatFileTreeInfo } from 'vs/workbench/contrib/chat/browser/chat';
import { ChatAgentHover, getChatAgentHoverOptions } from 'vs/workbench/contrib/chat/browser/chatAgentHover';
import { ChatCommandButtonContentPart } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatCommandContentPart';
import { ChatConfirmationContentPart } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatConfirmationContentPart';
import { IChatContentPart, IChatContentPartRenderContext } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatContentParts';
import { ChatMarkdownContentPart, EditorPool } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatMarkdownContentPart';
import { ChatProgressContentPart } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatProgressContentPart';
import { ChatReferencesContentPart, ContentReferencesListPool } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatReferencesContentPart';
import { ChatTextEditContentPart, DiffEditorPool } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatTextEditContentPart';
import { ChatTreeContentPart, TreePool } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatTreeContentPart';
import { ChatWarningContentPart } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatWarningContentPart';
import { ChatFollowups } from 'vs/workbench/contrib/chat/browser/chatFollowups';
import { ChatMarkdownDecorationsRenderer } from 'vs/workbench/contrib/chat/browser/chatMarkdownDecorationsRenderer';
import { ChatMarkdownRenderer } from 'vs/workbench/contrib/chat/browser/chatMarkdownRenderer';
import { ChatEditorOptions } from 'vs/workbench/contrib/chat/browser/chatOptions';
import { ChatCodeBlockContentProvider } from 'vs/workbench/contrib/chat/browser/codeBlockPart';
import { ChatAgentLocation, IChatAgentMetadata } from 'vs/workbench/contrib/chat/common/chatAgents';
import { CONTEXT_CHAT_RESPONSE_SUPPORT_ISSUE_REPORTING, CONTEXT_REQUEST, CONTEXT_RESPONSE, CONTEXT_RESPONSE_DETECTED_AGENT_COMMAND, CONTEXT_RESPONSE_FILTERED, CONTEXT_RESPONSE_VOTE } from 'vs/workbench/contrib/chat/common/chatContextKeys';
import { IChatProgressRenderableResponseContent, IChatTextEditGroup } from 'vs/workbench/contrib/chat/common/chatModel';
import { chatSubcommandLeader } from 'vs/workbench/contrib/chat/common/chatParserTypes';
import { ChatAgentVoteDirection, IChatConfirmation, IChatContentReference, IChatFollowup, IChatTask, IChatTreeData, IChatWarningMessage } from 'vs/workbench/contrib/chat/common/chatService';
import { IChatResponseViewModel, IChatWelcomeMessageViewModel, isRequestVM, isResponseVM, isWelcomeVM } from 'vs/workbench/contrib/chat/common/chatViewModel';
import { getNWords } from 'vs/workbench/contrib/chat/common/chatWordCounter';
import { annotateSpecialMarkdownContent } from '../common/annotations';
import { CodeBlockModelCollection } from '../common/codeBlockModelCollection';
import { IChatListItemRendererOptions } from './chat';
import { ChatTaskContentPart } from 'vs/workbench/contrib/chat/browser/chatContentParts/chatTaskContentPart';

const $ = dom.$;

interface IChatListItemTemplate {
	currentElement?: ChatTreeItem;
	renderedParts?: IChatContentPart[];
	readonly rowContainer: HTMLElement;
	readonly titleToolbar?: MenuWorkbenchToolBar;
	readonly avatarContainer: HTMLElement;
	readonly username: HTMLElement;
	readonly detail: HTMLElement;
	readonly value: HTMLElement;
	readonly referencesListContainer: HTMLElement;
	readonly contextKeyService: IContextKeyService;
	readonly instantiationService: IInstantiationService;
	readonly templateDisposables: IDisposable;
	readonly elementDisposables: DisposableStore;
	readonly agentHover: ChatAgentHover;
}

interface IItemHeightChangeParams {
	element: ChatTreeItem;
	height: number;
}

const forceVerboseLayoutTracing = false
	// || Boolean("TRUE") // causes a linter warning so that it cannot be pushed
	;

export interface IChatRendererDelegate {
	getListLength(): number;

	readonly onDidScroll?: Event<void>;
}

export class ChatListItemRenderer extends Disposable implements ITreeRenderer<ChatTreeItem, FuzzyScore, IChatListItemTemplate> {
	static readonly ID = 'item';

	private readonly codeBlocksByResponseId = new Map<string, IChatCodeBlockInfo[]>();
	private readonly codeBlocksByEditorUri = new ResourceMap<IChatCodeBlockInfo>();

	private readonly fileTreesByResponseId = new Map<string, IChatFileTreeInfo[]>();
	private readonly focusedFileTreesByResponseId = new Map<string, number>();

	private readonly renderer: MarkdownRenderer;
	private readonly markdownDecorationsRenderer: ChatMarkdownDecorationsRenderer;

	protected readonly _onDidClickFollowup = this._register(new Emitter<IChatFollowup>());
	readonly onDidClickFollowup: Event<IChatFollowup> = this._onDidClickFollowup.event;

	private readonly _onDidClickRerunWithAgentOrCommandDetection = new Emitter<IChatResponseViewModel>();
	readonly onDidClickRerunWithAgentOrCommandDetection: Event<IChatResponseViewModel> = this._onDidClickRerunWithAgentOrCommandDetection.event;

	protected readonly _onDidChangeItemHeight = this._register(new Emitter<IItemHeightChangeParams>());
	readonly onDidChangeItemHeight: Event<IItemHeightChangeParams> = this._onDidChangeItemHeight.event;

	private readonly _editorPool: EditorPool;
	private readonly _diffEditorPool: DiffEditorPool;
	private readonly _treePool: TreePool;
	private readonly _contentReferencesListPool: ContentReferencesListPool;

	private _currentLayoutWidth: number = 0;
	private _isVisible = true;
	private _onDidChangeVisibility = this._register(new Emitter<boolean>());

	constructor(
		editorOptions: ChatEditorOptions,
		private readonly location: ChatAgentLocation,
		private readonly rendererOptions: IChatListItemRendererOptions,
		private readonly delegate: IChatRendererDelegate,
		private readonly codeBlockModelCollection: CodeBlockModelCollection,
		overflowWidgetsDomNode: HTMLElement | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService configService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IThemeService private readonly themeService: IThemeService,
		@ICommandService private readonly commandService: ICommandService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();

		this.renderer = this._register(this.instantiationService.createInstance(ChatMarkdownRenderer, undefined));
		this.markdownDecorationsRenderer = this.instantiationService.createInstance(ChatMarkdownDecorationsRenderer);
		this._editorPool = this._register(this.instantiationService.createInstance(EditorPool, editorOptions, delegate, overflowWidgetsDomNode));
		this._diffEditorPool = this._register(this.instantiationService.createInstance(DiffEditorPool, editorOptions, delegate, overflowWidgetsDomNode));
		this._treePool = this._register(this.instantiationService.createInstance(TreePool, this._onDidChangeVisibility.event));
		this._contentReferencesListPool = this._register(this.instantiationService.createInstance(ContentReferencesListPool, this._onDidChangeVisibility.event));

		this._register(this.instantiationService.createInstance(ChatCodeBlockContentProvider));
	}

	get templateId(): string {
		return ChatListItemRenderer.ID;
	}

	editorsInUse() {
		return this._editorPool.inUse();
	}

	private traceLayout(method: string, message: string) {
		if (forceVerboseLayoutTracing) {
			this.logService.info(`ChatListItemRenderer#${method}: ${message}`);
		} else {
			this.logService.trace(`ChatListItemRenderer#${method}: ${message}`);
		}
	}

	private getProgressiveRenderRate(element: IChatResponseViewModel): number {
		if (element.isComplete) {
			return 80;
		}

		if (element.contentUpdateTimings && element.contentUpdateTimings.impliedWordLoadRate) {
			// words/s
			const minRate = 12;
			const maxRate = 80;

			// This doesn't account for dead time after the last update. When the previous update is the final one and the model is only waiting for followupQuestions, that's good.
			// When there was one quick update and then you are waiting longer for the next one, that's not good since the rate should be decreasing.
			// If it's an issue, we can change this to be based on the total time from now to the beginning.
			const rateBoost = 1.5;
			const rate = element.contentUpdateTimings.impliedWordLoadRate * rateBoost;
			return clamp(rate, minRate, maxRate);
		}

		return 8;
	}

	getCodeBlockInfosForResponse(response: IChatResponseViewModel): IChatCodeBlockInfo[] {
		const codeBlocks = this.codeBlocksByResponseId.get(response.id);
		return codeBlocks ?? [];
	}

	getCodeBlockInfoForEditor(uri: URI): IChatCodeBlockInfo | undefined {
		return this.codeBlocksByEditorUri.get(uri);
	}

	getFileTreeInfosForResponse(response: IChatResponseViewModel): IChatFileTreeInfo[] {
		const fileTrees = this.fileTreesByResponseId.get(response.id);
		return fileTrees ?? [];
	}

	getLastFocusedFileTreeForResponse(response: IChatResponseViewModel): IChatFileTreeInfo | undefined {
		const fileTrees = this.fileTreesByResponseId.get(response.id);
		const lastFocusedFileTreeIndex = this.focusedFileTreesByResponseId.get(response.id);
		if (fileTrees?.length && lastFocusedFileTreeIndex !== undefined && lastFocusedFileTreeIndex < fileTrees.length) {
			return fileTrees[lastFocusedFileTreeIndex];
		}
		return undefined;
	}

	setVisible(visible: boolean): void {
		this._isVisible = visible;
		this._onDidChangeVisibility.fire(visible);
	}

	layout(width: number): void {
		this._currentLayoutWidth = width - (this.rendererOptions.noPadding ? 0 : 40); // padding
		for (const editor of this._editorPool.inUse()) {
			editor.layout(this._currentLayoutWidth);
		}
		for (const diffEditor of this._diffEditorPool.inUse()) {
			diffEditor.layout(this._currentLayoutWidth);
		}
	}

	renderTemplate(container: HTMLElement): IChatListItemTemplate {
		const templateDisposables = new DisposableStore();
		const rowContainer = dom.append(container, $('.interactive-item-container'));
		if (this.rendererOptions.renderStyle === 'compact') {
			rowContainer.classList.add('interactive-item-compact');
		}
		if (this.rendererOptions.noPadding) {
			rowContainer.classList.add('no-padding');
		}

		let headerParent = rowContainer;
		let referencesListParent = rowContainer;
		let valueParent = rowContainer;
		let detailContainerParent: HTMLElement | undefined;
		let toolbarParent: HTMLElement | undefined;

		if (this.rendererOptions.renderStyle === 'minimal') {
			rowContainer.classList.add('interactive-item-compact');
			rowContainer.classList.add('minimal');
			// -----------------------------------------------------
			//  icon | details
			//       | references
			//       | value
			// -----------------------------------------------------
			const lhsContainer = dom.append(rowContainer, $('.column.left'));
			const rhsContainer = dom.append(rowContainer, $('.column'));

			headerParent = lhsContainer;
			detailContainerParent = rhsContainer;
			referencesListParent = rhsContainer;
			valueParent = rhsContainer;
			toolbarParent = dom.append(rowContainer, $('.header'));
		}

		const header = dom.append(headerParent, $('.header'));
		const user = dom.append(header, $('.user'));
		user.tabIndex = 0;
		user.role = 'toolbar';
		const avatarContainer = dom.append(user, $('.avatar-container'));
		const username = dom.append(user, $('h3.username'));
		const detailContainer = dom.append(detailContainerParent ?? user, $('span.detail-container'));
		const detail = dom.append(detailContainer, $('span.detail'));
		dom.append(detailContainer, $('span.chat-animated-ellipsis'));
		const referencesListContainer = dom.append(referencesListParent, $('.referencesListContainer'));
		const value = dom.append(valueParent, $('.value'));
		const elementDisposables = new DisposableStore();

		const contextKeyService = templateDisposables.add(this.contextKeyService.createScoped(rowContainer));
		const scopedInstantiationService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, contextKeyService]));
		let titleToolbar: MenuWorkbenchToolBar | undefined;
		if (this.rendererOptions.noHeader) {
			header.classList.add('hidden');
		} else {
			titleToolbar = templateDisposables.add(scopedInstantiationService.createInstance(MenuWorkbenchToolBar, toolbarParent ?? header, MenuId.ChatMessageTitle, {
				menuOptions: {
					shouldForwardArgs: true
				},
				toolbarOptions: {
					shouldInlineSubmenu: submenu => submenu.actions.length <= 1
				},
				actionViewItemProvider: (action: IAction, options: IActionViewItemOptions) => {
					if (action instanceof MenuItemAction && (action.item.id === 'workbench.action.chat.voteDown' || action.item.id === 'workbench.action.chat.voteUp')) {
						return scopedInstantiationService.createInstance(ChatVoteButton, action, options as IMenuEntryActionViewItemOptions);
					}
					return createActionViewItem(scopedInstantiationService, action, options);
				}
			}));
		}

		const agentHover = templateDisposables.add(this.instantiationService.createInstance(ChatAgentHover));
		const hoverContent = () => {
			if (isResponseVM(template.currentElement) && template.currentElement.agent && !template.currentElement.agent.isDefault) {
				agentHover.setAgent(template.currentElement.agent.id);
				return agentHover.domNode;
			}

			return undefined;
		};
		const hoverOptions = getChatAgentHoverOptions(() => isResponseVM(template.currentElement) ? template.currentElement.agent : undefined, this.commandService);
		templateDisposables.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), user, hoverContent, hoverOptions));
		templateDisposables.add(dom.addDisposableListener(user, dom.EventType.KEY_DOWN, e => {
			const ev = new StandardKeyboardEvent(e);
			if (ev.equals(KeyCode.Space) || ev.equals(KeyCode.Enter)) {
				const content = hoverContent();
				if (content) {
					this.hoverService.showHover({ content, target: user, trapFocus: true, actions: hoverOptions.actions }, true);
				}
			} else if (ev.equals(KeyCode.Escape)) {
				this.hoverService.hideHover();
			}
		}));
		const template: IChatListItemTemplate = { avatarContainer, username, detail, referencesListContainer, value, rowContainer, elementDisposables, titleToolbar, templateDisposables, contextKeyService, instantiationService: scopedInstantiationService, agentHover };
		return template;
	}

	renderElement(node: ITreeNode<ChatTreeItem, FuzzyScore>, index: number, templateData: IChatListItemTemplate): void {
		this.renderChatTreeItem(node.element, index, templateData);
	}

	renderChatTreeItem(element: ChatTreeItem, index: number, templateData: IChatListItemTemplate): void {
		templateData.currentElement = element;
		const kind = isRequestVM(element) ? 'request' :
			isResponseVM(element) ? 'response' :
				'welcome';
		this.traceLayout('renderElement', `${kind}, index=${index}`);

		CONTEXT_RESPONSE.bindTo(templateData.contextKeyService).set(isResponseVM(element));
		CONTEXT_REQUEST.bindTo(templateData.contextKeyService).set(isRequestVM(element));
		CONTEXT_RESPONSE_DETECTED_AGENT_COMMAND.bindTo(templateData.contextKeyService).set(isResponseVM(element) && element.agentOrSlashCommandDetected);
		if (isResponseVM(element)) {
			CONTEXT_CHAT_RESPONSE_SUPPORT_ISSUE_REPORTING.bindTo(templateData.contextKeyService).set(!!element.agent?.metadata.supportIssueReporting);
			CONTEXT_RESPONSE_VOTE.bindTo(templateData.contextKeyService).set(element.vote === ChatAgentVoteDirection.Up ? 'up' : element.vote === ChatAgentVoteDirection.Down ? 'down' : '');
		} else {
			CONTEXT_RESPONSE_VOTE.bindTo(templateData.contextKeyService).set('');
		}

		if (templateData.titleToolbar) {
			templateData.titleToolbar.context = element;
		}

		const isFiltered = !!(isResponseVM(element) && element.errorDetails?.responseIsFiltered);
		CONTEXT_RESPONSE_FILTERED.bindTo(templateData.contextKeyService).set(isFiltered);

		templateData.rowContainer.classList.toggle('interactive-request', isRequestVM(element));
		templateData.rowContainer.classList.toggle('interactive-response', isResponseVM(element));
		templateData.rowContainer.classList.toggle('interactive-welcome', isWelcomeVM(element));
		templateData.rowContainer.classList.toggle('filtered-response', isFiltered);
		templateData.rowContainer.classList.toggle('show-detail-progress', isResponseVM(element) && !element.isComplete && !element.progressMessages.length);
		templateData.username.textContent = element.username;
		if (!this.rendererOptions.noHeader) {
			this.renderAvatar(element, templateData);
		}

		dom.clearNode(templateData.detail);
		if (isResponseVM(element)) {
			this.renderDetail(element, templateData);
		}

		// Do a progressive render if
		// - This the last response in the list
		// - And it has some content
		// - And the response is not complete
		//   - Or, we previously started a progressive rendering of this element (if the element is complete, we will finish progressive rendering with a very fast rate)
		if (isResponseVM(element) && index === this.delegate.getListLength() - 1 && (!element.isComplete || element.renderData) && element.response.value.length) {
			this.traceLayout('renderElement', `start progressive render ${kind}, index=${index}`);

			const progressiveRenderingDisposables = templateData.elementDisposables.add(new DisposableStore()); // TODO
			const timer = templateData.elementDisposables.add(new dom.WindowIntervalTimer());
			const runProgressiveRender = (initial?: boolean) => {
				try {
					if (this.doNextProgressiveRender(element, index, templateData, !!initial, progressiveRenderingDisposables)) {
						timer.cancel();
					}
				} catch (err) {
					// Kill the timer if anything went wrong, avoid getting stuck in a nasty rendering loop.
					timer.cancel();
					throw err;
				}
			};
			timer.cancelAndSet(runProgressiveRender, 50, dom.getWindow(templateData.rowContainer));
			runProgressiveRender(true);
		} else if (isResponseVM(element)) {
			this.basicRenderElement(element, index, templateData);
		} else if (isRequestVM(element)) {
			this.basicRenderElement(element, index, templateData);
		} else {
			this.renderWelcomeMessage(element, templateData);
		}
	}

	private renderDetail(element: IChatResponseViewModel, templateData: IChatListItemTemplate): void {
		templateData.elementDisposables.add(autorun(reader => {
			this._renderDetail(element, templateData);
		}));
	}

	private _renderDetail(element: IChatResponseViewModel, templateData: IChatListItemTemplate): void {

		dom.clearNode(templateData.detail);

		if (element.slashCommand && element.agentOrSlashCommandDetected) {
			const usingMsg = `${chatSubcommandLeader}${element.slashCommand.name}`;
			const msg = localize('usedAgent', "used {0} [[(rerun without)]]", usingMsg);

			dom.reset(templateData.detail, renderFormattedText(msg, {
				className: 'agentOrSlashCommandDetected',
				inline: true,
				actionHandler: {
					disposables: templateData.elementDisposables,
					callback: (content) => {
						this._onDidClickRerunWithAgentOrCommandDetection.fire(element);
					},
				}
			}));

		} else if (!element.isComplete) {
			templateData.detail.textContent = GeneratingPhrase;
		}
	}

	private renderAvatar(element: ChatTreeItem, templateData: IChatListItemTemplate): void {
		const icon = isResponseVM(element) ?
			this.getAgentIcon(element.agent?.metadata) :
			(element.avatarIcon ?? Codicon.account);
		if (icon instanceof URI) {
			const avatarIcon = dom.$<HTMLImageElement>('img.icon');
			avatarIcon.src = FileAccess.uriToBrowserUri(icon).toString(true);
			templateData.avatarContainer.replaceChildren(dom.$('.avatar', undefined, avatarIcon));
		} else {
			const avatarIcon = dom.$(ThemeIcon.asCSSSelector(icon));
			templateData.avatarContainer.replaceChildren(dom.$('.avatar.codicon-avatar', undefined, avatarIcon));
		}
	}

	private getAgentIcon(agent: IChatAgentMetadata | undefined): URI | ThemeIcon {
		if (agent?.themeIcon) {
			return agent.themeIcon;
		} else if (agent?.iconDark && this.themeService.getColorTheme().type === ColorScheme.DARK) {
			return agent.iconDark;
		} else if (agent?.icon) {
			return agent.icon;
		} else {
			return Codicon.copilot;
		}
	}

	private basicRenderElement(element: ChatTreeItem, index: number, templateData: IChatListItemTemplate) {
		let value: ReadonlyArray<IChatProgressRenderableResponseContent> = [];
		if (isRequestVM(element)) {
			const markdown = 'message' in element.message ?
				element.message.message :
				this.markdownDecorationsRenderer.convertParsedRequestToMarkdown(element.message);
			value = [{ content: new MarkdownString(markdown), kind: 'markdownContent' }];
		} else if (isResponseVM(element)) {
			value = annotateSpecialMarkdownContent(element.response.value);
		}

		dom.clearNode(templateData.value);
		dom.clearNode(templateData.referencesListContainer);

		if (isResponseVM(element)) {
			this.renderDetail(element, templateData);
		}

		this.renderContentReferencesIfNeeded(element, templateData, templateData.elementDisposables);

		const parts: IChatContentPart[] = [];
		value.forEach((data, index) => {
			const context: IChatContentPartRenderContext = {
				element,
				index,
				content: value,
				preceedingContentParts: parts,
			};
			const newPart = this.renderChatContentPart(data, templateData, context);
			if (newPart) {
				templateData.value.appendChild(newPart.domNode);
				parts.push(newPart);
			}
		});
		templateData.renderedParts = parts;

		if (isResponseVM(element) && element.errorDetails?.message) {
			const renderedError = this.instantiationService.createInstance(ChatWarningContentPart, element.errorDetails.responseIsFiltered ? 'info' : 'error', new MarkdownString(element.errorDetails.message), this.renderer);
			templateData.elementDisposables.add(renderedError);
			templateData.value.appendChild(renderedError.domNode);
		}

		const newHeight = templateData.rowContainer.offsetHeight;
		const fireEvent = !element.currentRenderedHeight || element.currentRenderedHeight !== newHeight;
		element.currentRenderedHeight = newHeight;
		if (fireEvent) {
			const disposable = templateData.elementDisposables.add(dom.scheduleAtNextAnimationFrame(dom.getWindow(templateData.value), () => {
				// Have to recompute the height here because codeblock rendering is currently async and it may have changed.
				// If it becomes properly sync, then this could be removed.
				element.currentRenderedHeight = templateData.rowContainer.offsetHeight;
				disposable.dispose();
				this._onDidChangeItemHeight.fire({ element, height: element.currentRenderedHeight });
			}));
		}
	}

	private updateItemHeight(templateData: IChatListItemTemplate): void {
		if (!templateData.currentElement) {
			return;
		}

		const newHeight = templateData.rowContainer.offsetHeight;
		templateData.currentElement.currentRenderedHeight = newHeight;
		this._onDidChangeItemHeight.fire({ element: templateData.currentElement, height: newHeight });
	}

	private renderWelcomeMessage(element: IChatWelcomeMessageViewModel, templateData: IChatListItemTemplate) {
		dom.clearNode(templateData.value);
		dom.clearNode(templateData.referencesListContainer);
		dom.hide(templateData.referencesListContainer);

		element.content.forEach((item, i) => {
			if (Array.isArray(item)) {
				const scopedInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, templateData.contextKeyService]));
				templateData.elementDisposables.add(
					scopedInstaService.createInstance<typeof ChatFollowups<IChatFollowup>, ChatFollowups<IChatFollowup>>(
						ChatFollowups,
						templateData.value,
						item,
						this.location,
						undefined,
						followup => this._onDidClickFollowup.fire(followup)));
			} else {
				const context: IChatContentPartRenderContext = {
					element,
					index: i,
					// NA for welcome msg
					content: [],
					preceedingContentParts: []
				};
				const result = this.renderMarkdown(item, templateData, context);
				templateData.value.appendChild(result.domNode);
				templateData.elementDisposables.add(result);
			}
		});

		const newHeight = templateData.rowContainer.offsetHeight;
		const fireEvent = !element.currentRenderedHeight || element.currentRenderedHeight !== newHeight;
		element.currentRenderedHeight = newHeight;
		if (fireEvent) {
			const disposable = templateData.elementDisposables.add(dom.scheduleAtNextAnimationFrame(dom.getWindow(templateData.value), () => {
				// Have to recompute the height here because codeblock rendering is currently async and it may have changed.
				// If it becomes properly sync, then this could be removed.
				element.currentRenderedHeight = templateData.rowContainer.offsetHeight;
				disposable.dispose();
				this._onDidChangeItemHeight.fire({ element, height: element.currentRenderedHeight });
			}));
		}
	}

	/**
	 *	@returns true if progressive rendering should be considered complete- the element's data is fully rendered or the view is not visible
	 */
	private doNextProgressiveRender(element: IChatResponseViewModel, index: number, templateData: IChatListItemTemplate, isInRenderElement: boolean, disposables: DisposableStore): boolean {
		if (!this._isVisible) {
			return true;
		}

		let isFullyRendered = false;
		if (element.isCanceled) {
			this.traceLayout('doNextProgressiveRender', `canceled, index=${index}`);
			element.renderData = undefined;
			this.basicRenderElement(element, index, templateData);
			isFullyRendered = true;
			// Maybe return here, shouldn't need to fire onDidChangeItemHeight here
		} else {
			this.traceLayout('doNextProgressiveRender', `START progressive render, index=${index}, renderData=${JSON.stringify(element.renderData)}`);
			const contentForThisTurn = this.getNextProgressiveRenderContent(element);
			const partsToRender = this.diff(templateData.renderedParts ?? [], contentForThisTurn, element);
			isFullyRendered = partsToRender.every(part => part === null);

			if (isFullyRendered && element.isComplete) {
				// Response is done and content is rendered, so do a normal render
				this.traceLayout('doNextProgressiveRender', `END progressive render, index=${index} and clearing renderData, response is complete`);
				element.renderData = undefined;
				disposables.clear();
				this.basicRenderElement(element, index, templateData);
				// TODO return here
			} else if (!isFullyRendered) {
				this.traceLayout('doNextProgressiveRender', `doing progressive render, ${partsToRender.length} parts to render`);
				this.renderContentReferencesIfNeeded(element, templateData, disposables);
				this.renderChatContentDiff(partsToRender, contentForThisTurn, element, templateData);
			} else {
				// Nothing new to render, not done, keep waiting
				return false;
			}
		}

		// Some render happened - update the height
		const height = templateData.rowContainer.offsetHeight;
		element.currentRenderedHeight = height;
		if (!isInRenderElement) {
			this._onDidChangeItemHeight.fire({ element, height: templateData.rowContainer.offsetHeight });
		}

		return isFullyRendered;
	}

	private renderChatContentDiff(partsToRender: ReadonlyArray<IChatProgressRenderableResponseContent | null>, contentForThisTurn: IChatProgressRenderableResponseContent[], element: IChatResponseViewModel, templateData: IChatListItemTemplate): void {
		const renderedParts = templateData.renderedParts ?? [];
		templateData.renderedParts = renderedParts;
		partsToRender.forEach((partToRender, index) => {
			if (!partToRender) {
				// null=no change
				return;
			}

			const alreadyRenderedPart = templateData.renderedParts?.[index];
			if (alreadyRenderedPart) {
				alreadyRenderedPart.dispose();
			}

			const preceedingContentParts = renderedParts.slice(0, index);
			const context: IChatContentPartRenderContext = {
				element,
				content: contentForThisTurn,
				preceedingContentParts,
				index
			};
			const newPart = this.renderChatContentPart(partToRender, templateData, context);
			if (newPart) {
				// Maybe the part can't be rendered in this context, but this shouldn't really happen
				if (alreadyRenderedPart) {
					try {
						// This method can throw HierarchyRequestError
						alreadyRenderedPart.domNode.replaceWith(newPart.domNode);
					} catch (err) {
						this.logService.error('ChatListItemRenderer#renderChatContentDiff: error replacing part', err);
					}
				} else {
					templateData.value.appendChild(newPart.domNode);
				}

				renderedParts[index] = newPart;
			} else if (alreadyRenderedPart) {
				alreadyRenderedPart.domNode.remove();
			}
		});
	}

	/**
	 * Returns all content parts that should be rendered, and trimmed markdown content. We will diff this with the current rendered set.
	 */
	private getNextProgressiveRenderContent(element: IChatResponseViewModel): IChatProgressRenderableResponseContent[] {
		const data = this.getDataForProgressiveRender(element);

		// Recomputes the same data over and over even when nothing changed- can be optimized but have to know to initialize a new template
		// if (!data) {
		// 	return;
		// }

		const renderableResponse = annotateSpecialMarkdownContent(element.response.value);

		this.traceLayout('getNextProgressiveRenderContent', `Want to render ${data.numWordsToRender}, counting...`);
		let numNeededWords = data.numWordsToRender;
		const partsToRender: IChatProgressRenderableResponseContent[] = [];
		for (const part of renderableResponse) {
			if (numNeededWords <= 0) {
				break;
			}

			if (part.kind === 'markdownContent') {
				const wordCountResult = getNWords(part.content.value, numNeededWords);
				if (wordCountResult.isFullString) {
					partsToRender.push(part);
				} else {
					partsToRender.push({ kind: 'markdownContent', content: new MarkdownString(wordCountResult.value, part.content) });
				}

				this.traceLayout('getNextProgressiveRenderContent', `  Want to render ${numNeededWords} words and found ${wordCountResult.returnedWordCount} words. Total words in chunk: ${wordCountResult.totalWordCount}`);
				numNeededWords -= wordCountResult.returnedWordCount;
			} else {
				partsToRender.push(part);
			}
		}

		this.traceLayout('getNextProgressiveRenderContent', `Want to render ${data.numWordsToRender} words and ${data.numWordsToRender - numNeededWords} words available`);
		const newRenderedWordCount = data.numWordsToRender - numNeededWords;
		if (newRenderedWordCount !== element.renderData?.renderedWordCount) {
			// Only update lastRenderTime when we actually render new content
			element.renderData = { lastRenderTime: Date.now(), renderedWordCount: newRenderedWordCount, renderedParts: partsToRender };
		}

		return partsToRender;
	}

	private getDataForProgressiveRender(element: IChatResponseViewModel) {
		const renderData = element.renderData ?? { lastRenderTime: 0, renderedWordCount: 0 };

		const rate = this.getProgressiveRenderRate(element);
		const numWordsToRender = renderData.lastRenderTime === 0 ?
			1 :
			renderData.renderedWordCount +
			// Additional words to render beyond what's already rendered
			Math.floor((Date.now() - renderData.lastRenderTime) / 1000 * rate);

		// if (numWordsToRender === renderData.renderedWordCount) {
		// 	return undefined;
		// }

		return {
			numWordsToRender,
			rate
		};
	}

	private diff(renderedParts: ReadonlyArray<IChatContentPart>, partsToRender: ReadonlyArray<IChatProgressRenderableResponseContent>, element: ChatTreeItem): ReadonlyArray<IChatProgressRenderableResponseContent | null> {
		const diff: (IChatProgressRenderableResponseContent | null)[] = [];
		for (let i = 0; i < partsToRender.length; i++) {
			const part = partsToRender[i];
			const renderedPart = renderedParts[i];

			if (!renderedPart || !renderedPart.hasSameContent(part, partsToRender.slice(i + 1), element)) {
				diff.push(part);
			} else {
				diff.push(null);
			}
		}

		return diff;
	}

	private renderChatContentPart(contentPart: IChatProgressRenderableResponseContent, templateData: IChatListItemTemplate, context: IChatContentPartRenderContext): IChatContentPart | undefined {
		if (contentPart.kind === 'treeData') {
			return this.renderTreeData(contentPart, templateData, context);
		} else if (contentPart.kind === 'progressMessage') {
			return this.instantiationService.createInstance(ChatProgressContentPart, contentPart, this.renderer, context);
		} else if (contentPart.kind === 'progressTask') {
			return this.renderProgressTask(contentPart, templateData, context);
		} else if (contentPart.kind === 'command') {
			return this.instantiationService.createInstance(ChatCommandButtonContentPart, contentPart, context);
		} else if (contentPart.kind === 'textEditGroup') {
			return this.renderTextEdit(context, contentPart, templateData);
		} else if (contentPart.kind === 'confirmation') {
			return this.renderConfirmation(context, contentPart, templateData);
		} else if (contentPart.kind === 'warning') {
			return this.instantiationService.createInstance(ChatWarningContentPart, 'warning', contentPart.content, this.renderer);
		} else if (contentPart.kind === 'markdownContent') {
			return this.renderMarkdown(contentPart.content, templateData, context);
		}

		return undefined;
	}

	private renderTreeData(content: IChatTreeData, templateData: IChatListItemTemplate, context: IChatContentPartRenderContext): IChatContentPart {
		const data = content.treeData;
		const treeDataIndex = context.preceedingContentParts.filter(part => part instanceof ChatTreeContentPart).length;
		const treePart = this.instantiationService.createInstance(ChatTreeContentPart, data, context.element, this._treePool, treeDataIndex);

		treePart.addDisposable(treePart.onDidChangeHeight(() => {
			this.updateItemHeight(templateData);
		}));

		if (isResponseVM(context.element)) {
			const fileTreeFocusInfo = {
				treeDataId: data.uri.toString(),
				treeIndex: treeDataIndex,
				focus() {
					treePart.domFocus();
				}
			};

			// TODO@roblourens there's got to be a better way to navigate trees
			treePart.addDisposable(treePart.onDidFocus(() => {
				this.focusedFileTreesByResponseId.set(context.element.id, fileTreeFocusInfo.treeIndex);
			}));

			const fileTrees = this.fileTreesByResponseId.get(context.element.id) ?? [];
			fileTrees.push(fileTreeFocusInfo);
			this.fileTreesByResponseId.set(context.element.id, distinct(fileTrees, (v) => v.treeDataId));
			treePart.addDisposable(toDisposable(() => this.fileTreesByResponseId.set(context.element.id, fileTrees.filter(v => v.treeDataId !== data.uri.toString()))));
		}

		return treePart;
	}

	private renderContentReferencesIfNeeded(element: ChatTreeItem, templateData: IChatListItemTemplate, disposables: DisposableStore): void {
		if (isResponseVM(element) && element.contentReferences.length) {
			dom.show(templateData.referencesListContainer);
			const contentReferencesListResult = this.renderContentReferencesListData(element.contentReferences, undefined, element, templateData);
			if (templateData.referencesListContainer.firstChild) {
				templateData.referencesListContainer.replaceChild(contentReferencesListResult.domNode, templateData.referencesListContainer.firstChild!);
			} else {
				templateData.referencesListContainer.appendChild(contentReferencesListResult.domNode);
			}
			disposables.add(contentReferencesListResult);
		} else {
			dom.hide(templateData.referencesListContainer);
		}
	}

	private renderContentReferencesListData(data: ReadonlyArray<IChatContentReference | IChatWarningMessage>, labelOverride: string | undefined, element: IChatResponseViewModel, templateData: IChatListItemTemplate): ChatReferencesContentPart {
		const referencesPart = this.instantiationService.createInstance(ChatReferencesContentPart, data, labelOverride, element, this._contentReferencesListPool);
		referencesPart.addDisposable(referencesPart.onDidChangeHeight(() => {
			this.updateItemHeight(templateData);
		}));

		return referencesPart;
	}

	private renderProgressTask(task: IChatTask, templateData: IChatListItemTemplate, context: IChatContentPartRenderContext): IChatContentPart | undefined {
		if (!isResponseVM(context.element)) {
			return;
		}

		const taskPart = this.instantiationService.createInstance(ChatTaskContentPart, task, this._contentReferencesListPool, this.renderer, context);
		taskPart.addDisposable(taskPart.onDidChangeHeight(() => {
			this.updateItemHeight(templateData);
		}));
		return taskPart;
	}

	private renderConfirmation(context: IChatContentPartRenderContext, confirmation: IChatConfirmation, templateData: IChatListItemTemplate): IChatContentPart {
		const part = this.instantiationService.createInstance(ChatConfirmationContentPart, confirmation, context);
		part.addDisposable(part.onDidChangeHeight(() => this.updateItemHeight(templateData)));
		return part;
	}

	private renderTextEdit(context: IChatContentPartRenderContext, chatTextEdit: IChatTextEditGroup, templateData: IChatListItemTemplate): IChatContentPart {
		const textEditPart = this.instantiationService.createInstance(ChatTextEditContentPart, chatTextEdit, context, this.rendererOptions, this._diffEditorPool, this._currentLayoutWidth);
		textEditPart.addDisposable(textEditPart.onDidChangeHeight(() => {
			textEditPart.layout(this._currentLayoutWidth);
			this.updateItemHeight(templateData);
		}));

		return textEditPart;
	}

	private renderMarkdown(markdown: IMarkdownString, templateData: IChatListItemTemplate, context: IChatContentPartRenderContext): IChatContentPart {
		const element = context.element;
		const fillInIncompleteTokens = isResponseVM(element) && (!element.isComplete || element.isCanceled || element.errorDetails?.responseIsFiltered || element.errorDetails?.responseIsIncomplete);
		const codeBlockStartIndex = context.preceedingContentParts.reduce((acc, part) => acc + (part instanceof ChatMarkdownContentPart ? part.codeblocks.length : 0), 0);
		const markdownPart = this.instantiationService.createInstance(ChatMarkdownContentPart, markdown, context, this._editorPool, fillInIncompleteTokens, codeBlockStartIndex, this.renderer, this._currentLayoutWidth, this.codeBlockModelCollection, this.rendererOptions);
		markdownPart.addDisposable(markdownPart.onDidChangeHeight(() => {
			markdownPart.layout(this._currentLayoutWidth);
			this.updateItemHeight(templateData);
		}));

		const codeBlocksByResponseId = this.codeBlocksByResponseId.get(element.id) ?? [];
		this.codeBlocksByResponseId.set(element.id, codeBlocksByResponseId);
		markdownPart.addDisposable(toDisposable(() => {
			const codeBlocksByResponseId = this.codeBlocksByResponseId.get(element.id);
			if (codeBlocksByResponseId) {
				markdownPart.codeblocks.forEach((info, i) => delete codeBlocksByResponseId[codeBlockStartIndex + i]);
			}
		}));

		markdownPart.codeblocks.forEach((info, i) => {
			codeBlocksByResponseId[codeBlockStartIndex + i] = info;
			if (info.uri) {
				const uri = info.uri;
				this.codeBlocksByEditorUri.set(uri, info);
				markdownPart.addDisposable(toDisposable(() => this.codeBlocksByEditorUri.delete(uri)));
			}
		});

		return markdownPart;
	}

	disposeElement(node: ITreeNode<ChatTreeItem, FuzzyScore>, index: number, templateData: IChatListItemTemplate): void {
		this.traceLayout('disposeElement', `Disposing element, index=${index}`);

		// We could actually reuse a template across a renderElement call?
		if (templateData.renderedParts) {
			try {
				dispose(coalesce(templateData.renderedParts));
				templateData.renderedParts = undefined;
				dom.clearNode(templateData.value);
			} catch (err) {
				throw err;
			}
		}

		templateData.currentElement = undefined;
		templateData.elementDisposables.clear();
	}

	disposeTemplate(templateData: IChatListItemTemplate): void {
		templateData.templateDisposables.dispose();
	}
}

export class ChatListDelegate implements IListVirtualDelegate<ChatTreeItem> {
	constructor(
		private readonly defaultElementHeight: number,
		@ILogService private readonly logService: ILogService
	) { }

	private _traceLayout(method: string, message: string) {
		if (forceVerboseLayoutTracing) {
			this.logService.info(`ChatListDelegate#${method}: ${message}`);
		} else {
			this.logService.trace(`ChatListDelegate#${method}: ${message}`);
		}
	}

	getHeight(element: ChatTreeItem): number {
		const kind = isRequestVM(element) ? 'request' : 'response';
		const height = ('currentRenderedHeight' in element ? element.currentRenderedHeight : undefined) ?? this.defaultElementHeight;
		this._traceLayout('getHeight', `${kind}, height=${height}`);
		return height;
	}

	getTemplateId(element: ChatTreeItem): string {
		return ChatListItemRenderer.ID;
	}

	hasDynamicHeight(element: ChatTreeItem): boolean {
		return true;
	}
}

class ChatVoteButton extends MenuEntryActionViewItem {
	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.toggle('checked', this.action.checked);
	}
}
