/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxCoder contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { knoxGuiIconClass } from '../knoxGuiIcons.js';
import { IKnoxGuiBridge } from '../../common/knoxGuiProtocol.js';
import {
	IKnoxExploreResult,
	IKnoxGraphEntity,
	IKnoxMemoryGraphStats,
	KNOX_GRAPH_TYPE_COLORS,
	KNOX_MEMORY_PROTOCOL,
	knoxParseExploreResult,
	knoxParseGraphEntities,
	knoxParseGraphStats,
} from '../../common/knoxMemory.js';

export class KnoxMemoryGraph extends Disposable {

	readonly element: HTMLElement;
	private readonly _search: HTMLInputElement;
	private readonly _typeFilter: HTMLSelectElement;
	private readonly _stats: HTMLElement;
	private readonly _explorePanel: HTMLElement;
	private readonly _list: HTMLElement;
	private readonly _viewStore = this._register(new DisposableStore());
	private readonly _listStore = this._register(new DisposableStore());
	private _entities: IKnoxGraphEntity[] = [];
	private _graphStats: IKnoxMemoryGraphStats | undefined;
	private _exploreResult: IKnoxExploreResult | undefined;
	private _filterType = 'all';
	private _query = '';
	private _searchTimer: ReturnType<typeof setTimeout> | undefined;
	private _exploringId: number | undefined;

	constructor(
		parent: HTMLElement,
		@IKnoxGuiBridge private readonly _bridge: IKnoxGuiBridge,
	) {
		super();
		this.element = append(parent, $('.knox-memory-tab'));
		this._stats = append(this.element, $('.knox-memory-graph-stats'));
		const searchRow = append(this.element, $('.knox-memory-filters'));
		const searchWrap = append(searchRow, $('.knox-history-search'));
		append(searchWrap, $('span')).className = knoxGuiIconClass('lucide-search');
		this._search = append(searchWrap, $<HTMLInputElement>('input.knox-history-search-input'));
		this._search.type = 'search';
		this._search.placeholder = localize('knox.memorySearchEntities', "Search entities");
		this._typeFilter = append(searchRow, $<HTMLSelectElement>('select.knox-memory-select'));
		this._explorePanel = append(this.element, $('.knox-checkpoint-card.hidden'));
		this._list = append(this.element, $('.knox-memory-list'));
		this._register(addDisposableListener(this._search, 'input', () => {
			this._query = this._search.value;
			if (this._searchTimer) {
				clearTimeout(this._searchTimer);
			}
			this._searchTimer = setTimeout(() => void this._loadEntities(), 300);
		}));
		this._register(addDisposableListener(this._typeFilter, 'change', () => {
			this._filterType = this._typeFilter.value;
			this._renderList();
		}));
		void this.refresh();
	}

	override dispose(): void {
		if (this._searchTimer) {
			clearTimeout(this._searchTimer);
		}
		super.dispose();
	}

	async refresh(): Promise<void> {
		try {
			this._graphStats = knoxParseGraphStats(await this._bridge.request(KNOX_MEMORY_PROTOCOL.graphStats));
		} catch {
			this._graphStats = undefined;
		}
		await this._loadEntities();
	}

	private async _loadEntities(): Promise<void> {
		try {
			this._entities = knoxParseGraphEntities(await this._bridge.request(KNOX_MEMORY_PROTOCOL.searchEntities, {
				query: this._query || '*',
				limit: 50,
			}));
		} catch {
			this._entities = [];
		}
		this._render();
	}

	private _filtered(): IKnoxGraphEntity[] {
		return this._filterType === 'all' ? this._entities : this._entities.filter(item => item.entity_type === this._filterType);
	}

	private _render(): void {
		this._renderStats();
		this._renderFilter();
		this._renderExplore();
		this._renderList();
	}

	private _renderStats(): void {
		clearNode(this._stats);
		if (!this._graphStats) {
			return;
		}
		const grid = append(this._stats, $('.knox-memory-stats'));
		stat(grid, localize('knox.memoryEntities', "Entities"), this._graphStats.max_entities
			? `${this._graphStats.total_entities}/${this._graphStats.max_entities}`
			: this._graphStats.total_entities);
		stat(grid, localize('knox.memoryEdges', "Edges"), this._graphStats.total_edges);
		stat(grid, localize('knox.memoryEntityTypesCount', "Types"), Object.keys(this._graphStats.entity_types).length || [...new Set(this._entities.map(item => item.entity_type))].length);
		if (this._graphStats.max_entities) {
			const wrap = append(this._stats, $('.knox-memory-bar-wrap'));
			const header = append(wrap, $('.knox-memory-kv'));
			append(header, $('span')).textContent = localize('knox.memoryGraphCapUtilization', "Cap utilization");
			append(header, $('span.knox-muted')).textContent = `${((this._graphStats.cap_utilization ?? 0) * 100).toFixed(1)}%`;
			const track = append(wrap, $('.knox-memory-bar'));
			const fill = append(track, $('.knox-memory-bar-fill'));
			fill.style.width = `${Math.min(100, (this._graphStats.cap_utilization ?? 0) * 100)}%`;
			if (this._graphStats.at_cap) {
				fill.style.background = '#f59e0b';
			}
			append(this._stats, $('p.knox-muted')).textContent = localize(
				'knox.memoryGraphSpreadingHint',
				"Spreading activation depth {0}, γ={1}.",
				this._graphStats.max_depth ?? 3,
				this._graphStats.depth_decay_gamma ?? 0.7,
			);
		}
	}

	private _renderFilter(): void {
		const types = [...new Set(this._entities.map(item => item.entity_type).filter(Boolean))];
		clearNode(this._typeFilter);
		const all = append(this._typeFilter, $<HTMLOptionElement>('option'));
		all.value = 'all';
		all.textContent = localize('knox.memoryAllTypes', "All types");
		for (const type of types) {
			const option = append(this._typeFilter, $<HTMLOptionElement>('option'));
			option.value = type;
			option.textContent = type;
		}
		this._typeFilter.value = this._filterType;
	}

	private _renderExplore(): void {
		this._viewStore.clear();
		clearNode(this._explorePanel);
		this._explorePanel.classList.toggle('hidden', !this._exploreResult);
		if (!this._exploreResult) {
			return;
		}
		const header = append(this._explorePanel, $('.knox-history-title-row'));
		append(header, $('h3')).textContent = localize('knox.memoryExploring', "Exploring: {0}", this._exploreResult.center.name);
		append(header, $('span.knox-muted')).textContent = localize('knox.memoryGraphDepth', "Depth {0}", this._exploreResult.depth_reached);
		const close = append(header, $<HTMLButtonElement>('button.knox-history-tool'));
		close.type = 'button';
		close.textContent = localize('knox.memoryClose', "Close");
		this._viewStore.add(addDisposableListener(close, 'click', () => {
			this._exploreResult = undefined;
			this._renderExplore();
		}));
		const map = append(this._explorePanel, $('.knox-memory-chips'));
		nodeChip(map, this._exploreResult.center, true);
		for (const edge of this._exploreResult.edges) {
			const connected = this._exploreResult.entities.find(item =>
				item.id === (edge.source_entity_id === this._exploreResult!.center.id ? edge.target_entity_id : edge.source_entity_id));
			if (!connected) {
				continue;
			}
			const rel = append(map, $('span.knox-muted'));
			rel.textContent = edge.relationship;
			const chip = nodeChip(map, connected, false);
			this._viewStore.add(addDisposableListener(chip, 'click', () => void this._exploreEntity(connected.id)));
		}
		if (this._exploreResult.center.description) {
			append(this._explorePanel, $('p.knox-muted')).textContent = this._exploreResult.center.description;
		}
		append(this._explorePanel, $('p.knox-muted')).textContent = `${this._exploreResult.entities.length} ${localize('knox.memoryConnectedEntities', "connected")} · ${this._exploreResult.edges.length} ${localize('knox.memoryRelationships', "relationships")}`;
	}

	private _renderList(): void {
		this._listStore.clear();
		clearNode(this._list);
		const filtered = this._filtered();
		if (!filtered.length) {
			append(this._list, $('p.knox-muted')).textContent = this._query
				? localize('knox.memoryNoEntitiesFound', "No entities found.")
				: localize('knox.memoryNoEntitiesYet', "No entities yet.");
			return;
		}
		for (const entity of filtered) {
			const row = append(this._list, $('.knox-history-row'));
			const avatar = append(row, $('span.knox-memory-avatar'));
			const color = KNOX_GRAPH_TYPE_COLORS[entity.entity_type] ?? KNOX_GRAPH_TYPE_COLORS.default;
			avatar.style.background = `${color}22`;
			avatar.style.color = color;
			avatar.textContent = (entity.entity_type[0] || '?').toUpperCase();
			const body = append(row, $('.knox-history-row-body'));
			const title = append(body, $('.knox-history-row-title'));
			append(title, $('span')).textContent = entity.name;
			const type = append(title, $('span.knox-memory-chip'));
			type.textContent = entity.entity_type;
			type.style.color = color;
			if (entity.description) {
				append(body, $('div.knox-muted')).textContent = entity.description;
			}
			append(body, $('div.knox-muted')).textContent = localize('knox.memoryEntityMentions', "Mentions: {0}", entity.mention_count);
			const explore = append(row, $<HTMLButtonElement>('button.knox-history-tool'));
			explore.type = 'button';
			explore.disabled = this._exploringId === entity.id;
			append(explore, $('span')).className = knoxGuiIconClass('lucide-search');
			append(explore, $('span')).textContent = localize('knox.memoryExplore', "Explore");
			this._listStore.add(addDisposableListener(explore, 'click', e => {
				e.stopPropagation();
				void this._exploreEntity(entity.id);
			}));
		}
	}

	private async _exploreEntity(id: number): Promise<void> {
		this._exploringId = id;
		this._renderList();
		try {
			this._exploreResult = knoxParseExploreResult(await this._bridge.request(KNOX_MEMORY_PROTOCOL.exploreGraph, {
				entity_id: id,
				depth: this._graphStats?.max_depth ?? 3,
			}));
		} finally {
			this._exploringId = undefined;
			this._renderExplore();
			this._renderList();
		}
	}
}

function stat(parent: HTMLElement, label: string, value: string | number): void {
	const card = append(parent, $('.knox-memory-stat'));
	append(card, $('div.knox-memory-stat-value')).textContent = typeof value === 'number' ? value.toLocaleString() : value;
	append(card, $('div.knox-muted')).textContent = label;
}

function nodeChip(parent: HTMLElement, entity: IKnoxGraphEntity, center: boolean): HTMLElement {
	const chip = append(parent, $('span.knox-memory-chip'));
	const color = KNOX_GRAPH_TYPE_COLORS[entity.entity_type] ?? KNOX_GRAPH_TYPE_COLORS.default;
	chip.textContent = entity.name;
	if (center) {
		chip.style.background = color;
		chip.style.color = '#fff';
	} else {
		chip.style.color = color;
		chip.style.cursor = 'pointer';
	}
	return chip;
}
