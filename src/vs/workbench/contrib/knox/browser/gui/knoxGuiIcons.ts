/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Knox. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTrustedTypesPolicy } from '../../../../../base/browser/trustedTypes.js';

/** Knox cyan, matching BlockSettingsTopToolbar KNOX_PRIMARY. */
export const KNOX_GUI_CYAN = '#159994';

/** Policy name must stay in workbench.html / workbench-dev.html `trusted-types`. */
const ttPolicy = createTrustedTypesPolicy('knoxGui', { createHTML: value => value });

/** Workbench requires TrustedHTML for innerHTML; the old webview did not. */
export function setKnoxGuiInnerHtml(el: Element, html: string): void {
	el.innerHTML = (ttPolicy?.createHTML(html) ?? html) as string;
}

export type KnoxGuiSvgIcon =
	| 'save'
	| 'git-commit'
	| 'git-merge'
	| 'eye'
	| 'activity'
	| 'trending-up'
	| 'circle-x'
	| 'monitor'
	| 'circle-check'
	| 'square-plus'
	| 'cpu'
	| 'square-pen'
	| 'scroll-text'
	| 'wrench'
	| 'history'
	| 'settings'
	| 'chevrons-down'
	| 'chevrons-up-down'
	| 'chevron-down'
	| 'chevron-up'
	| 'arrow-right'
	| 'search'
	| 'square-terminal'
	| 'file-text'
	| 'folder-tree'
	| 'brain'
	| 'globe'
	| 'check'
	| 'plus'
	| 'trash'
	| 'gear'
	| 'attach-image'
	| 'add-context'
	| 'send'
	| 'cancel'
	| 'arrow-up'
	| 'arrow-down'
	| 'arrow-left'
	| 'chevron-right'
	| 'x'
	| 'file'
	| 'folder'
	| 'bookmark'
	| 'list-plus'
	| 'file-input'
	| 'copy'
	| 'terminal'
	| 'sparkles'
	| 'file-pen-line'
	| 'test-tube'
	| 'git-branch'
	| 'bot'
	| 'message-circle-question'
	| 'message-square'
	| 'check-square'
	| 'square'
	| 'minus'
	| 'pin'
	| 'pin-off'
	| 'target'
	| 'thumbs-down'
	| 'list-checks'
	| 'maximize-2'
	| 'share-2'
	| 'info'
	| 'download'
	| 'package'
	| 'alert-circle'
	| 'alert-triangle'
	| 'flag'
	| 'rotate-cw'
	| 'external-link'
	| 'link'
	| 'layers'
	| 'zap'
	| 'bar-chart-3'
	| 'clipboard-list'
	| 'hard-drive'
	| 'folder-open'
	| 'tag'
	| 'lightbulb'
	| 'star'
	| 'ruler'
	| 'compass'
	| 'minimize-2'
	| 'database'
	| 'graph-nodes'
	| 'heart-pulse'
	| 'rotate-ccw'
	| 'calendar'
	| 'hash'
	| 'user'
	| 'timer'
	| 'sliders-horizontal'
	| 'panel-left-close'
	| 'panel-left-open'
	| 'columns-2'
	| 'wrap-text'
	| 'git-compare'
	| 'clock'
	| 'loader-2'
	| 'type'
	| 'file-warning'
	| 'archive'
	| 'shield'
	| 'shield-check'
	| 'shield-alert'
	| 'file-json'
	| 'trash-2'
	| 'square-check-big'
	| 'circle-check-big'
	| 'split'
	| 'refresh-cw'
	| 'crosshair'
	| 'file-down'
	| 'upload';

const STROKE = `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
const HAIRLINE = `fill="none" stroke="${KNOX_GUI_CYAN}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"`;

const ICONS: Record<KnoxGuiSvgIcon, string> = {
	'square-plus': `<rect x="3" y="3" width="18" height="18" rx="2" ${STROKE}/><path d="M8 12h8" ${STROKE}/><path d="M12 8v8" ${STROKE}/>`,
	cpu: `<rect x="4" y="4" width="16" height="16" rx="2" ${STROKE}/><rect x="9" y="9" width="6" height="6" ${STROKE}/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" ${STROKE}/>`,
	'square-pen': `<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" ${STROKE}/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" ${STROKE}/>`,
	'scroll-text': `<path d="M15 12h-5M15 8h-5M19 17V5a2 2 0 0 0-2-2H4" ${STROKE}/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" ${STROKE}/>`,
	wrench: `<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" ${STROKE}/>`,
	history: `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" ${STROKE}/><path d="M3 3v5h5" ${STROKE}/><path d="M12 7v5l4 2" ${STROKE}/>`,
	settings: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" ${STROKE}/><circle cx="12" cy="12" r="3" ${STROKE}/>`,
	'chevrons-down': `<path d="m7 6 5 5 5-5" ${STROKE}/><path d="m7 13 5 5 5-5" ${STROKE}/>`,
	'chevrons-up-down': `<path d="m7 15 5 5 5-5" ${STROKE}/><path d="m7 9 5-5 5 5" ${STROKE}/>`,
	'chevron-down': `<path d="m6 9 6 6 6-6" ${STROKE}/>`,
	'chevron-up': `<path d="m18 15-6-6-6 6" ${STROKE}/>`,
	'arrow-right': `<path d="M5 12h14" ${STROKE}/><path d="m12 5 7 7-7 7" ${STROKE}/>`,
	search: `<circle cx="11" cy="11" r="8" ${STROKE}/><path d="m21 21-4.3-4.3" ${STROKE}/>`,
	'square-terminal': `<rect x="3" y="3" width="18" height="18" rx="2" ${STROKE}/><path d="m7 11 2-2-2-2" ${STROKE}/><path d="M11 13h4" ${STROKE}/>`,
	'file-text': `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" ${STROKE}/><path d="M14 2v4a2 2 0 0 0 2 2h4" ${STROKE}/><path d="M10 9H8" ${STROKE}/><path d="M16 13H8" ${STROKE}/><path d="M16 17H8" ${STROKE}/>`,
	'folder-tree': `<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-.8.4l-.9 1.2a1 1 0 0 1-.8.4H9a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1Z" ${STROKE}/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.88-.55H9a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" ${STROKE}/><path d="M3 5.1A1 1 0 0 0 3 5v15a1 1 0 0 0 1 1h2.9a1 1 0 0 0 .88-.55l.42-.85a1 1 0 0 1 .88-.55H11" ${STROKE}/>`,
	brain: `<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" ${STROKE}/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" ${STROKE}/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" ${STROKE}/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375" ${STROKE}/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" ${STROKE}/><path d="M3.077 10.96a4 4 0 0 1 .217-.24" ${STROKE}/><path d="M20.706 10.72a4 4 0 0 1 .217.24" ${STROKE}/>`,
	globe: `<circle cx="12" cy="12" r="10" ${STROKE}/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" ${STROKE}/><path d="M2 12h20" ${STROKE}/>`,
	check: `<path d="M20 6 9 17l-5-5" ${STROKE}/>`,
	plus: `<path d="M5 12h14" ${STROKE}/><path d="M12 5v14" ${STROKE}/>`,
	trash: `<path d="M3 6h18" ${STROKE}/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" ${STROKE}/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" ${STROKE}/>`,
	gear: `<circle cx="12" cy="12" r="3" ${STROKE}/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" ${STROKE}/>`,
	'attach-image': `<g ${HAIRLINE}><path d="M15 8h.01M10 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5"/><path d="m3 16l5-5c.928-.893 2.072-.893 3 0l1 1m2 9v-4a2 2 0 1 1 4 0v4m-4-2h4m3-4v6"/></g>`,
	'add-context': `<g ${HAIRLINE}><rect width="20" height="20" x="2" y="2" rx="2"/><path d="M14 17.7a6 6 0 1 1 4-5.7a2 2 0 0 1-4 0"/><circle cx="12" cy="12" r="2"/></g>`,
	send: `<path d="M15.43 8.56949L10.744 15.1395C10.6422 15.282 10.5804 15.4492 10.5651 15.6236C10.5498 15.7981 10.5815 15.9734 10.657 16.1315L13.194 21.4425C13.2737 21.6097 13.3991 21.751 13.5557 21.8499C13.7123 21.9488 13.8938 22.0014 14.079 22.0015H14.117C14.3087 21.9941 14.4941 21.9307 14.6502 21.8191C14.8062 21.7075 14.9261 21.5526 14.995 21.3735L21.933 3.33649C22.0011 3.15918 22.0164 2.96594 21.977 2.78013C21.9376 2.59432 21.8452 2.4239 21.711 2.28949L15.43 8.56949Z" fill="currentColor"/><path opacity="0.5" d="M20.664 2.06648L2.62602 9.00148C2.44768 9.07085 2.29348 9.19082 2.1824 9.34663C2.07131 9.50244 2.00818 9.68731 2.00074 9.87853C1.99331 10.0697 2.04189 10.259 2.14054 10.4229C2.23919 10.5869 2.38359 10.7185 2.55601 10.8015L7.86601 13.3365C8.02383 13.4126 8.19925 13.4448 8.37382 13.4297C8.54839 13.4145 8.71565 13.3526 8.85801 13.2505L15.43 8.56548L21.711 2.28448C21.5762 2.15096 21.4055 2.05932 21.2198 2.02064C21.034 1.98196 20.8409 1.99788 20.664 2.06648Z" fill="currentColor"/>`,
	cancel: `<path d="M6 6L18 18M6 18L18 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
	'arrow-up': `<path d="m5 12 7-7 7 7" ${STROKE}/><path d="M12 19V5" ${STROKE}/>`,
	'arrow-down': `<path d="M12 5v14" ${STROKE}/><path d="m19 12-7 7-7-7" ${STROKE}/>`,
	'arrow-left': `<path d="m12 19-7-7 7-7" ${STROKE}/><path d="M19 12H5" ${STROKE}/>`,
	'chevron-right': `<path d="m9 18 6-6-6-6" ${STROKE}/>`,
	x: `<path d="M18 6 6 18" ${STROKE}/><path d="m6 6 12 12" ${STROKE}/>`,
	file: `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" ${STROKE}/><path d="M14 2v4a2 2 0 0 0 2 2h4" ${STROKE}/>`,
	folder: `<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" ${STROKE}/>`,
	bookmark: `<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" ${STROKE}/>`,
	'list-plus': `<path d="M16 5H3" ${STROKE}/><path d="M16 12H3" ${STROKE}/><path d="M11 19H3" ${STROKE}/><path d="M21 16v6" ${STROKE}/><path d="M18 19h6" ${STROKE}/>`,
	'file-input': `<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" ${STROKE}/><path d="M14 2v4a2 2 0 0 0 2 2h4" ${STROKE}/><path d="m3 15 3 3 3-3" ${STROKE}/><path d="M6 18v-7" ${STROKE}/>`,
	copy: `<rect x="9" y="9" width="13" height="13" rx="2" ${STROKE}/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" ${STROKE}/>`,
	terminal: `<path d="m4 17 6-6-6-6" ${STROKE}/><path d="M12 19h8" ${STROKE}/>`,
	sparkles: `<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" ${STROKE}/><path d="M20 3v4" ${STROKE}/><path d="M22 5h-4" ${STROKE}/><path d="M4 17v2" ${STROKE}/><path d="M5 18H3" ${STROKE}/>`,
	'file-pen-line': `<path d="m18 5-2.414-2.414A2 2 0 0 0 14.172 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2" ${STROKE}/><path d="M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" ${STROKE}/><path d="M8 18h1" ${STROKE}/>`,
	'test-tube': `<path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5h0c-1.4 0-2.5-1.1-2.5-2.5V2" ${STROKE}/><path d="M8.5 2h7" ${STROKE}/><path d="M14.5 16h-5" ${STROKE}/>`,
	'git-branch': `<line x1="6" x2="6" y1="3" y2="15" ${STROKE}/><circle cx="18" cy="6" r="3" ${STROKE}/><circle cx="6" cy="18" r="3" ${STROKE}/><path d="M18 9a9 9 0 0 1-9 9" ${STROKE}/>`,
	bot: `<path d="M12 8V4H8" ${STROKE}/><rect width="16" height="12" x="4" y="8" rx="2" ${STROKE}/><path d="M2 14h2" ${STROKE}/><path d="M20 14h2" ${STROKE}/><path d="M15 13v2" ${STROKE}/><path d="M9 13v2" ${STROKE}/>`,
	'message-circle-question': `<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" ${STROKE}/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" ${STROKE}/><path d="M12 17h.01" ${STROKE}/>`,
	'message-square': `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" ${STROKE}/>`,
	'check-square': `<rect width="18" height="18" x="3" y="3" rx="2" ${STROKE}/><path d="m9 12 2 2 4-4" ${STROKE}/>`,
	square: `<rect width="18" height="18" x="3" y="3" rx="2" ${STROKE}/>`,
	minus: `<path d="M5 12h14" ${STROKE}/>`,
	pin: `<path d="M12 17v5" ${STROKE}/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" ${STROKE}/>`,
	'pin-off': `<path d="M12 17v5" ${STROKE}/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" ${STROKE}/><path d="m2 2 20 20" ${STROKE}/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12" ${STROKE}/>`,
	target: `<circle cx="12" cy="12" r="10" ${STROKE}/><circle cx="12" cy="12" r="6" ${STROKE}/><circle cx="12" cy="12" r="2" ${STROKE}/>`,
	'thumbs-down': `<path d="M17 14V2" ${STROKE}/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" ${STROKE}/>`,
	'list-checks': `<path d="m3 17 2 2 4-4" ${STROKE}/><path d="m3 7 2 2 4-4" ${STROKE}/><path d="M13 6h8" ${STROKE}/><path d="M13 12h8" ${STROKE}/><path d="M13 18h8" ${STROKE}/>`,
	'maximize-2': `<polyline points="15 3 21 3 21 9" ${STROKE}/><polyline points="9 21 3 21 3 15" ${STROKE}/><line x1="21" x2="14" y1="3" y2="10" ${STROKE}/><line x1="3" x2="10" y1="21" y2="14" ${STROKE}/>`,
	'share-2': `<circle cx="18" cy="5" r="3" ${STROKE}/><circle cx="6" cy="12" r="3" ${STROKE}/><circle cx="18" cy="19" r="3" ${STROKE}/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" ${STROKE}/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" ${STROKE}/>`,
	info: `<circle cx="12" cy="12" r="10" ${STROKE}/><path d="M12 16v-4" ${STROKE}/><path d="M12 8h.01" ${STROKE}/>`,
	download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" ${STROKE}/><polyline points="7 10 12 15 17 10" ${STROKE}/><line x1="12" x2="12" y1="15" y2="3" ${STROKE}/>`,
	package: `<path d="M16.5 9.4 7.55 4.24" ${STROKE}/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" ${STROKE}/><polyline points="3.29 7 12 12 20.71 7" ${STROKE}/><line x1="12" x2="12" y1="22" y2="12" ${STROKE}/>`,
	'alert-circle': `<circle cx="12" cy="12" r="10" ${STROKE}/><line x1="12" x2="12" y1="8" y2="12" ${STROKE}/><line x1="12" x2="12.01" y1="16" y2="16" ${STROKE}/>`,
	'alert-triangle': `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" ${STROKE}/><path d="M12 9v4" ${STROKE}/><path d="M12 17h.01" ${STROKE}/>`,
	flag: `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" ${STROKE}/><line x1="4" x2="4" y1="22" y2="15" ${STROKE}/>`,
	'rotate-cw': `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" ${STROKE}/><path d="M21 3v5h-5" ${STROKE}/>`,
	'external-link': `<path d="M15 3h6v6" ${STROKE}/><path d="M10 14 21 3" ${STROKE}/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" ${STROKE}/>`,
	link: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" ${STROKE}/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" ${STROKE}/>`,
	layers: `<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" ${STROKE}/><path d="m22 12.11-8.59 3.91a2 2 0 0 1-1.66 0L3.16 12.11" ${STROKE}/><path d="m22 17.11-8.59 3.91a2 2 0 0 1-1.66 0L3.16 17.11" ${STROKE}/>`,
	monitor: `<rect width="20" height="14" x="2" y="3" rx="2" ${STROKE}/><line x1="8" x2="16" y1="21" y2="21" ${STROKE}/><line x1="12" x2="12" y1="17" y2="21" ${STROKE}/>`,
	activity: `<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" ${STROKE}/>`,
	'trending-up': `<polyline points="22 7 13.5 15.5 8.5 10.5 2 17" ${STROKE}/><polyline points="16 7 22 7 22 13" ${STROKE}/>`,
	'circle-x': `<circle cx="12" cy="12" r="10" ${STROKE}/><path d="m15 9-6 6" ${STROKE}/><path d="m9 9 6 6" ${STROKE}/>`,
	'git-commit': `<circle cx="12" cy="12" r="3" ${STROKE}/><line x1="3" x2="9" y1="12" y2="12" ${STROKE}/><line x1="15" x2="21" y1="12" y2="12" ${STROKE}/>`,
	'git-merge': `<circle cx="18" cy="18" r="3" ${STROKE}/><circle cx="6" cy="6" r="3" ${STROKE}/><path d="M6 21V9a9 9 0 0 0 9 9" ${STROKE}/>`,
	eye: `<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" ${STROKE}/><circle cx="12" cy="12" r="3" ${STROKE}/>`,
	save: `<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" ${STROKE}/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" ${STROKE}/><path d="M7 3v4a1 1 0 0 0 1 1h7" ${STROKE}/>`,
	'circle-check': `<circle cx="12" cy="12" r="10" ${STROKE}/><path d="m9 12 2 2 4-4" ${STROKE}/>`,
	zap: `<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" ${STROKE}/>`,
	'bar-chart-3': `<path d="M3 3v16a2 2 0 0 0 2 2h16" ${STROKE}/><path d="M18 17V9" ${STROKE}/><path d="M13 17V5" ${STROKE}/><path d="M8 17v-3" ${STROKE}/>`,
	'clipboard-list': `<rect width="8" height="4" x="8" y="2" rx="1" ry="1" ${STROKE}/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" ${STROKE}/><path d="M12 11h4" ${STROKE}/><path d="M12 16h4" ${STROKE}/><path d="M8 11h.01" ${STROKE}/><path d="M8 16h.01" ${STROKE}/>`,
	'hard-drive': `<line x1="22" x2="2" y1="12" y2="12" ${STROKE}/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" ${STROKE}/><line x1="6" x2="6.01" y1="16" y2="16" ${STROKE}/><line x1="10" x2="10.01" y1="16" y2="16" ${STROKE}/>`,
	'folder-open': `<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" ${STROKE}/>`,
	tag: `<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" ${STROKE}/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>`,
	lightbulb: `<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" ${STROKE}/><path d="M9 18h6" ${STROKE}/><path d="M10 22h4" ${STROKE}/>`,
	star: `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" ${STROKE}/>`,
	ruler: `<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" ${STROKE}/><path d="m14.5 12.5 2-2" ${STROKE}/><path d="m11.5 9.5 2-2" ${STROKE}/><path d="m8.5 6.5 2-2" ${STROKE}/><path d="m17.5 15.5 2-2" ${STROKE}/>`,
	compass: `<circle cx="12" cy="12" r="10" ${STROKE}/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" ${STROKE}/>`,
	'minimize-2': `<polyline points="4 14 10 14 10 20" ${STROKE}/><polyline points="20 10 14 10 14 4" ${STROKE}/><line x1="14" x2="21" y1="10" y2="3" ${STROKE}/><line x1="3" x2="10" y1="21" y2="14" ${STROKE}/>`,
	database: `<ellipse cx="12" cy="5" rx="9" ry="3" ${STROKE}/><path d="M3 5V19A9 3 0 0 0 21 19V5" ${STROKE}/><path d="M3 12A9 3 0 0 0 21 12" ${STROKE}/>`,
	'graph-nodes': `<circle cx="5" cy="6" r="3" ${STROKE}/><circle cx="19" cy="6" r="3" ${STROKE}/><circle cx="12" cy="18" r="3" ${STROKE}/><path d="M7.5 8l4 7.5M16.5 8l-4 7.5" ${STROKE}/>`,
	'heart-pulse': `<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" ${STROKE}/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" ${STROKE}/>`,
	'rotate-ccw': `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" ${STROKE}/><path d="M3 3v5h5" ${STROKE}/>`,
	calendar: `<path d="M8 2v4" ${STROKE}/><path d="M16 2v4" ${STROKE}/><rect width="18" height="18" x="3" y="4" rx="2" ${STROKE}/><path d="M3 10h18" ${STROKE}/>`,
	hash: `<line x1="4" x2="20" y1="9" y2="9" ${STROKE}/><line x1="4" x2="20" y1="15" y2="15" ${STROKE}/><line x1="10" x2="8" y1="3" y2="21" ${STROKE}/><line x1="16" x2="14" y1="3" y2="21" ${STROKE}/>`,
	user: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" ${STROKE}/><circle cx="12" cy="7" r="4" ${STROKE}/>`,
	timer: `<line x1="10" x2="14" y1="2" y2="2" ${STROKE}/><line x1="12" x2="15" y1="14" y2="11" ${STROKE}/><circle cx="12" cy="14" r="8" ${STROKE}/>`,
	'sliders-horizontal': `<line x1="21" x2="14" y1="4" y2="4" ${STROKE}/><line x1="10" x2="3" y1="4" y2="4" ${STROKE}/><line x1="21" x2="12" y1="12" y2="12" ${STROKE}/><line x1="8" x2="3" y1="12" y2="12" ${STROKE}/><line x1="21" x2="16" y1="20" y2="20" ${STROKE}/><line x1="12" x2="3" y1="20" y2="20" ${STROKE}/><line x1="14" x2="14" y1="2" y2="6" ${STROKE}/><line x1="8" x2="8" y1="10" y2="14" ${STROKE}/><line x1="16" x2="16" y1="18" y2="22" ${STROKE}/>`,
	'panel-left-close': `<rect width="18" height="18" x="3" y="3" rx="2" ${STROKE}/><path d="M9 3v18" ${STROKE}/><path d="m16 15-3-3 3-3" ${STROKE}/>`,
	'panel-left-open': `<rect width="18" height="18" x="3" y="3" rx="2" ${STROKE}/><path d="M9 3v18" ${STROKE}/><path d="m14 9 3 3-3 3" ${STROKE}/>`,
	'columns-2': `<rect width="18" height="18" x="3" y="3" rx="2" ${STROKE}/><path d="M12 3v18" ${STROKE}/>`,
	'git-compare': `<circle cx="18" cy="18" r="3" ${STROKE}/><circle cx="6" cy="6" r="3" ${STROKE}/><path d="M13 6h3a2 2 0 0 1 2 2v7" ${STROKE}/><path d="M11 18H8a2 2 0 0 1-2-2V9" ${STROKE}/>`,
	clock: `<circle cx="12" cy="12" r="10" ${STROKE}/><polyline points="12 6 12 12 16 14" ${STROKE}/>`,
	'loader-2': `<path d="M21 12a9 9 0 1 1-6.219-8.56" ${STROKE}/>`,
	type: `<polyline points="4 7 4 4 20 4 20 7" ${STROKE}/><line x1="9" x2="15" y1="20" y2="20" ${STROKE}/><line x1="12" x2="12" y1="4" y2="20" ${STROKE}/>`,
	'file-warning': `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" ${STROKE}/><path d="M12 9v4" ${STROKE}/><path d="M12 17h.01" ${STROKE}/>`,
	shield: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" ${STROKE}/>`,
	'shield-check': `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" ${STROKE}/><path d="m9 12 2 2 4-4" ${STROKE}/>`,
	'shield-alert': `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" ${STROKE}/><path d="M12 8v4" ${STROKE}/><path d="M12 16h.01" ${STROKE}/>`,
	'file-json': `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" ${STROKE}/><path d="M14 2v4a2 2 0 0 0 2 2h4" ${STROKE}/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" ${STROKE}/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" ${STROKE}/>`,
	archive: `<rect width="20" height="5" x="2" y="3" rx="1" ${STROKE}/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" ${STROKE}/><path d="M10 12h4" ${STROKE}/>`,
	'wrap-text': `<path d="M3 6h18" ${STROKE}/><path d="M3 12h15a3 3 0 1 1 0 6h-4" ${STROKE}/><path d="m16 16-2 2 2 2" ${STROKE}/><path d="M3 18h7" ${STROKE}/>`,
	'trash-2': `<path d="M10 11v6" ${STROKE}/><path d="M14 11v6" ${STROKE}/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" ${STROKE}/><path d="M3 6h18" ${STROKE}/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" ${STROKE}/>`,
	'square-check-big': `<path d="M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344" ${STROKE}/><path d="m9 11 3 3L22 4" ${STROKE}/>`,
	'circle-check-big': `<path d="M21.801 10A10 10 0 1 1 17 3.335" ${STROKE}/><path d="m9 11 3 3L22 4" ${STROKE}/>`,
	split: `<path d="M16 3h5v5" ${STROKE}/><path d="M8 3H3v5" ${STROKE}/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" ${STROKE}/><path d="m15 9 6-6" ${STROKE}/>`,
	'refresh-cw': `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" ${STROKE}/><path d="M21 3v5h-5" ${STROKE}/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" ${STROKE}/><path d="M8 16H3v5" ${STROKE}/>`,
	crosshair: `<circle cx="12" cy="12" r="10" ${STROKE}/><line x1="22" x2="18" y1="12" y2="12" ${STROKE}/><line x1="6" x2="2" y1="12" y2="12" ${STROKE}/><line x1="12" x2="12" y1="6" y2="2" ${STROKE}/><line x1="12" x2="12" y1="22" y2="18" ${STROKE}/>`,
	'file-down': `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" ${STROKE}/><path d="M14 2v4a2 2 0 0 0 2 2h4" ${STROKE}/><path d="M12 18v-6" ${STROKE}/><path d="m9 15 3 3 3-3" ${STROKE}/>`,
	upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" ${STROKE}/><polyline points="17 8 12 3 7 8" ${STROKE}/><line x1="12" x2="12" y1="3" y2="15" ${STROKE}/>`,
};

const NAMED_ICONS: Record<string, KnoxGuiSvgIcon> = {
	file: 'file',
	code: 'square-terminal',
	terminal: 'terminal',
	diff: 'git-branch',
	search: 'search',
	url: 'globe',
	open: 'folder-open',
	problems: 'alert-circle',
	folder: 'folder',
	docs: 'file-text',
	web: 'globe',
	clipboard: 'clipboard-list',
	database: 'database',
	postgres: 'database',
	debugger: 'alert-triangle',
	os: 'cpu',
	tree: 'folder-tree',
	'prompt-files': 'scroll-text',
	'repo-map': 'folder',
	memory: 'brain',
	trash: 'trash',
	at: 'hash',
	autonomous: 'bot',
	issue: 'alert-circle',
	share: 'share-2',
	cmd: 'terminal',
	http: 'globe',
	commit: 'git-branch',
	review: 'search',
	pr: 'git-branch',
	changelog: 'file-text',
	skills: 'sparkles',
	plan: 'list-checks',
	compact: 'minimize-2',
	clear: 'trash',
};

/** Slash-command or context-provider icon by id, with or without a leading `/` (`icons.tsx` `getNamedIcon`). */
export function knoxGuiNamedIcon(id: string | undefined): KnoxGuiSvgIcon | undefined {
	if (!id) {
		return undefined;
	}
	return NAMED_ICONS[id.replace(/^\//, '')];
}

export function appendKnoxGuiSvg(parent: HTMLElement, icon: KnoxGuiSvgIcon, size = 14): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', String(size));
	svg.setAttribute('height', String(size));
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('knox-gui-svg');
	setKnoxGuiInnerHtml(svg, ICONS[icon]);
	parent.appendChild(svg);
	return svg;
}
