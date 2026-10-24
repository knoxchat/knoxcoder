/*---------------------------------------------------------------------------------------------
 *  Copyright (c) KnoxStudio. All rights reserved.
 *  Licensed under the GNU GPL-3.0 License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Terminal palettes, contrast, ANSI span parse, and tree theme tokens. */

export interface IKnoxGuiAnsiSpan {
	text: string;
	color?: string;
	bold?: boolean;
	dim?: boolean;
}

export interface IKnoxGuiAnsiPalette {
	foreground: string;
	black: string;
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	white: string;
	brightBlack: string;
	brightRed: string;
	brightGreen: string;
	brightYellow: string;
	brightBlue: string;
	brightMagenta: string;
	brightCyan: string;
	brightWhite: string;
}

export interface IKnoxGuiTreeTheme {
	background: string;
	backgroundGradientStart: string;
	backgroundGradientEnd: string;
	border: string;
	foreground: string;
	foregroundMuted: string;
	accent: string;
}

export const DARK_TERMINAL_PALETTE: IKnoxGuiAnsiPalette = {
	foreground: '#abb2bf',
	black: '#282c34',
	red: '#e06c75',
	green: '#98c379',
	yellow: '#e5c07b',
	blue: '#61afef',
	magenta: '#c678dd',
	cyan: '#56b6c2',
	white: '#abb2bf',
	brightBlack: '#5c6370',
	brightRed: '#e06c75',
	brightGreen: '#98c379',
	brightYellow: '#e5c07b',
	brightBlue: '#61afef',
	brightMagenta: '#c678dd',
	brightCyan: '#56b6c2',
	brightWhite: '#ffffff',
};

export const LIGHT_TERMINAL_PALETTE: IKnoxGuiAnsiPalette = {
	foreground: '#383a42',
	black: '#383a42',
	red: '#e45649',
	green: '#50a14f',
	yellow: '#c18401',
	blue: '#4078f2',
	magenta: '#a626a4',
	cyan: '#0184bc',
	white: '#a0a1a7',
	brightBlack: '#696c77',
	brightRed: '#e45649',
	brightGreen: '#50a14f',
	brightYellow: '#c18401',
	brightBlue: '#4078f2',
	brightMagenta: '#a626a4',
	brightCyan: '#0184bc',
	brightWhite: '#383a42',
};

/** Drop CSI / OSC / C1 color codes so search hits never render as tofu or icon-font leftovers. */
export function stripAnsi(text: string): string {
	return text
		.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
		.replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
		.replace(/\x1B[@-Z\\-_]/g, '')
		.replace(/\x9B[0-9;]*[ -/]*[@-~]/g, '');
}

function parseCssRgb(backgroundColor: string): { r: number; g: number; b: number } | undefined {
	if (!backgroundColor) {
		return undefined;
	}
	if (backgroundColor.startsWith('#')) {
		const hex = backgroundColor.slice(1);
		if (hex.length === 3 || hex.length === 4) {
			return {
				r: parseInt(hex[0] + hex[0], 16),
				g: parseInt(hex[1] + hex[1], 16),
				b: parseInt(hex[2] + hex[2], 16),
			};
		}
		if (hex.length >= 6) {
			return {
				r: parseInt(hex.substring(0, 2), 16),
				g: parseInt(hex.substring(2, 4), 16),
				b: parseInt(hex.substring(4, 6), 16),
			};
		}
		return undefined;
	}
	if (backgroundColor.startsWith('rgb')) {
		const match = backgroundColor.match(/\d+/g);
		if (match && match.length >= 3) {
			return { r: parseInt(match[0]), g: parseInt(match[1]), b: parseInt(match[2]) };
		}
	}
	return undefined;
}

function srgbChannel(value: number): number {
	const s = value / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
	const rgb = parseCssRgb(color);
	if (!rgb) {
		return 0;
	}
	return 0.2126 * srgbChannel(rgb.r) + 0.7152 * srgbChannel(rgb.g) + 0.0722 * srgbChannel(rgb.b);
}

export function luminanceIsLight(backgroundColor: string): boolean {
	const rgb = parseCssRgb(backgroundColor);
	if (!rgb) {
		return false;
	}
	return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b > 128;
}

/** WCAG 2 contrast ratio of two CSS hex/rgb colors. 4.5:1 is AA for normal text. */
export function contrastRatio(foreground: string, background: string): number {
	const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
	const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
	return (lighter + 0.05) / (darker + 0.05);
}

export function treeThemeColors(isLight: boolean): IKnoxGuiTreeTheme {
	return {
		background: isLight ? '#ffffff' : '#282c34',
		backgroundGradientStart: isLight ? '#f8f9fa' : '#2c313a',
		backgroundGradientEnd: isLight ? '#ffffff' : '#282c34',
		border: isLight ? '#e1e4e8' : '#3e4451',
		foreground: isLight ? '#383a42' : '#abb2bf',
		foregroundMuted: isLight ? '#6a737d' : '#5c6370',
		accent: isLight ? '#4078f2' : '#61afef',
	};
}

export function parseAnsiSpans(text: string, palette: IKnoxGuiAnsiPalette): IKnoxGuiAnsiSpan[] {
	if (!text) {
		return [];
	}
	if (!text.includes('\x1b[')) {
		return [{ text }];
	}
	const ansiRegex = /\x1b\[([0-9;]*)m/g;
	const parts: IKnoxGuiAnsiSpan[] = [];
	let lastIndex = 0;
	let currentColor: string | undefined;
	let bold = false;
	let dim = false;
	const colorMap: Record<number, string> = {
		30: palette.black, 31: palette.red, 32: palette.green, 33: palette.yellow,
		34: palette.blue, 35: palette.magenta, 36: palette.cyan, 37: palette.white,
		90: palette.brightBlack, 91: palette.brightRed, 92: palette.brightGreen, 93: palette.brightYellow,
		94: palette.brightBlue, 95: palette.brightMagenta, 96: palette.brightCyan, 97: palette.brightWhite,
	};
	let match: RegExpExecArray | null;
	while ((match = ansiRegex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			const segment = text.slice(lastIndex, match.index);
			if (segment) {
				parts.push({ text: segment, color: currentColor, bold: bold || undefined, dim: dim || undefined });
			}
		}
		const codes = match[1].split(';').map(Number);
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i];
			if (code === 0) {
				currentColor = undefined;
				bold = false;
				dim = false;
			} else if (code === 1) {
				bold = true;
			} else if (code === 2) {
				dim = true;
			} else if (code === 22) {
				bold = false;
				dim = false;
			} else if (code === 39) {
				currentColor = undefined;
			} else if (colorMap[code]) {
				currentColor = colorMap[code];
			} else if (code === 38 && codes[i + 1] === 2 && i + 4 < codes.length) {
				currentColor = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
				i += 4;
			}
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) {
		parts.push({ text: text.slice(lastIndex), color: currentColor, bold: bold || undefined, dim: dim || undefined });
	}
	return parts.length ? parts : [{ text }];
}
