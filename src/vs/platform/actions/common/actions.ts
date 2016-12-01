/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { IAction, Action } from 'vs/base/common/actions';
import { Promise, TPromise } from 'vs/base/common/winjs.base';
import { SyncDescriptor0, createSyncDescriptor, AsyncDescriptor0 } from 'vs/platform/instantiation/common/descriptors';
import { IConstructorSignature2, IInstantiationService, createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindings } from 'vs/platform/keybinding/common/keybinding';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IDisposable } from 'vs/base/common/lifecycle';
import Event from 'vs/base/common/event';

export interface ICommandAction {
	id: string;
	title: string;
	category?: string;
	iconClass?: string;
}

export interface IMenu extends IDisposable {
	onDidChange: Event<IMenu>;
	getActions(arg?: any): [string, MenuItemAction[]][];
}

export interface IMenuItem {
	command: ICommandAction;
	alt?: ICommandAction;
	when?: ContextKeyExpr;
	group?: 'navigation' | string;
	order?: number;
}

export class MenuId {

	static readonly EditorTitle = new MenuId('1');
	static readonly EditorTitleContext = new MenuId('2');
	static readonly EditorContext = new MenuId('3');
	static readonly ExplorerContext = new MenuId('4');
	static readonly ProblemsPanelContext = new MenuId('5');
	static readonly DebugVariablesContext = new MenuId('6');
	static readonly DebugWatchContext = new MenuId('7');
	static readonly DebugCallStackContext = new MenuId('8');
	static readonly DebugBreakpointsContext = new MenuId('9');
	static readonly DebugConsoleContext = new MenuId('10');

	constructor(private _id: string) {

	}

	get id(): string {
		return this._id;
	}
}

export class SCMTitleMenuId extends MenuId {

	static parse(value: string): MenuId | null {
		const match = /^scm\/([^/]+)\/title$/.exec(value);
		return match ? new SCMTitleMenuId(match[1]) : null;
	}

	constructor(private _providerId: string) {
		super(`scm/${_providerId}/title`);
	}
}

export const enum SCMMenuType {
	ResourceGroup,
	Resource
}

export class SCMMenuId extends MenuId {

	static parse(value: string): MenuId | null {
		const match = /^scm\/([^/]+)\/([^/]+)\/(group|resource)(\/context)?$/.exec(value);

		if (match) {
			const [, providerId, resourceGroupId, typeStr, isContext] = match;
			const type = typeStr === 'group' ? SCMMenuType.ResourceGroup : SCMMenuType.Resource;

			return new SCMMenuId(providerId, resourceGroupId, type, !!isContext);
		}
	}

	constructor(private providerId: string, private resourceGroupId: string, private type: SCMMenuType, private isContext: boolean) {
		super(`scm/${providerId}/${resourceGroupId}/${type === SCMMenuType.ResourceGroup ? 'group' : 'resource'}${isContext ? '/context' : ''}`);
	}
}

export const IMenuService = createDecorator<IMenuService>('menuService');

export interface IMenuService {

	_serviceBrand: any;

	createMenu(id: MenuId, scopedKeybindingService: IContextKeyService): IMenu;

	getCommandActions(): ICommandAction[];
}

export interface IMenuRegistry {
	commands: { [id: string]: ICommandAction };
	addCommand(userCommand: ICommandAction): boolean;
	getCommand(id: string): ICommandAction;
	appendMenuItem(menu: MenuId, item: IMenuItem): IDisposable;
	getMenuItems(loc: MenuId): IMenuItem[];
}

export const MenuRegistry: IMenuRegistry = new class {

	commands: { [id: string]: ICommandAction } = Object.create(null);

	menuItems: { [loc: string]: IMenuItem[] } = Object.create(null);

	addCommand(command: ICommandAction): boolean {
		const old = this.commands[command.id];
		this.commands[command.id] = command;
		return old !== void 0;
	}

	getCommand(id: string): ICommandAction {
		return this.commands[id];
	}

	appendMenuItem({id}: MenuId, item: IMenuItem): IDisposable {
		let array = this.menuItems[id];
		if (!array) {
			this.menuItems[id] = array = [item];
		} else {
			array.push(item);
		}
		return {
			dispose() {
				const idx = array.indexOf(item);
				if (idx >= 0) {
					array.splice(idx, 1);
				}
			}
		};
	}

	getMenuItems({id}: MenuId): IMenuItem[] {
		return this.menuItems[id] || [];
	}
};

export class ExecuteCommandAction extends Action {

	constructor(
		id: string,
		label: string,
		@ICommandService private _commandService: ICommandService) {

		super(id, label);
	}

	run(...args: any[]): TPromise<any> {
		return this._commandService.executeCommand(this.id, ...args);
	}
}

export class MenuItemAction extends ExecuteCommandAction {

	private _arg: any;

	readonly item: ICommandAction;
	readonly alt: MenuItemAction;

	constructor(
		item: ICommandAction,
		alt: ICommandAction,
		arg: any,
		@ICommandService commandService: ICommandService
	) {
		super(item.id, item.title, commandService);
		this._cssClass = item.iconClass;
		this._enabled = true;
		this._arg = arg;

		this.item = item;
		this.alt = alt ? new MenuItemAction(alt, undefined, arg, commandService) : undefined;
	}

	run(): TPromise<any> {
		return super.run(this._arg);
	}
}

export class SyncActionDescriptor {

	private _descriptor: SyncDescriptor0<Action>;

	private _id: string;
	private _label: string;
	private _keybindings: IKeybindings;
	private _keybindingContext: ContextKeyExpr;
	private _keybindingWeight: number;

	constructor(ctor: IConstructorSignature2<string, string, Action>,
		id: string, label: string, keybindings?: IKeybindings, keybindingContext?: ContextKeyExpr, keybindingWeight?: number
	) {
		this._id = id;
		this._label = label;
		this._keybindings = keybindings;
		this._keybindingContext = keybindingContext;
		this._keybindingWeight = keybindingWeight;
		this._descriptor = createSyncDescriptor(ctor, this._id, this._label);
	}

	public get syncDescriptor(): SyncDescriptor0<Action> {
		return this._descriptor;
	}

	public get id(): string {
		return this._id;
	}

	public get label(): string {
		return this._label;
	}

	public get keybindings(): IKeybindings {
		return this._keybindings;
	}

	public get keybindingContext(): ContextKeyExpr {
		return this._keybindingContext;
	}

	public get keybindingWeight(): number {
		return this._keybindingWeight;
	}
}

/**
 * A proxy for an action that needs to load code in order to confunction. Can be used from contributions to defer
 * module loading up to the point until the run method is being executed.
 */
export class DeferredAction extends Action {
	private _cachedAction: IAction;
	private _emitterUnbind: IDisposable;

	constructor(private _instantiationService: IInstantiationService,
		private _descriptor: AsyncDescriptor0<Action>,
		id: string, label = '', cssClass = '', enabled = true) {

		super(id, label, cssClass, enabled);
	}

	public get cachedAction(): IAction {
		return this._cachedAction;
	}

	public set cachedAction(action: IAction) {
		this._cachedAction = action;
	}

	public get id(): string {
		if (this._cachedAction instanceof Action) {
			return this._cachedAction.id;
		}

		return this._id;
	}

	public get label(): string {
		if (this._cachedAction instanceof Action) {
			return this._cachedAction.label;
		}

		return this._label;
	}

	public set label(value: string) {
		if (this._cachedAction instanceof Action) {
			this._cachedAction.label = value;
		} else {
			this._setLabel(value);
		}
	}

	public get class(): string {
		if (this._cachedAction instanceof Action) {
			return this._cachedAction.class;
		}

		return this._cssClass;
	}

	public set class(value: string) {
		if (this._cachedAction instanceof Action) {
			this._cachedAction.class = value;
		} else {
			this._setClass(value);
		}
	}

	public get enabled(): boolean {
		if (this._cachedAction instanceof Action) {
			return this._cachedAction.enabled;
		}
		return this._enabled;
	}

	public set enabled(value: boolean) {
		if (this._cachedAction instanceof Action) {
			this._cachedAction.enabled = value;
		} else {
			this._setEnabled(value);
		}
	}

	public get order(): number {
		if (this._cachedAction instanceof Action) {
			return (<Action>this._cachedAction).order;
		}
		return this._order;
	}

	public set order(order: number) {
		if (this._cachedAction instanceof Action) {
			(<Action>this._cachedAction).order = order;
		} else {
			this._order = order;
		}
	}

	public run(event?: any): Promise {
		if (this._cachedAction) {
			return this._cachedAction.run(event);
		}
		return this._createAction().then((action: IAction) => {
			return action.run(event);
		});
	}

	private _createAction(): TPromise<IAction> {
		let promise = TPromise.as(undefined);
		return promise.then(() => {
			return this._instantiationService.createInstance(this._descriptor);
		}).then(action => {
			if (action instanceof Action) {
				this._cachedAction = action;
				// Pipe events from the instantated action through this deferred action
				this._emitterUnbind = action.onDidChange(e => this._onDidChange.fire(e));

			} else {
				throw new Error('Action must be an instanceof Base Action');
			}

			return action;
		});
	}

	public dispose(): void {
		if (this._emitterUnbind) {
			this._emitterUnbind.dispose();
		}
		if (this._cachedAction) {
			this._cachedAction.dispose();
		}
		super.dispose();
	}
}
