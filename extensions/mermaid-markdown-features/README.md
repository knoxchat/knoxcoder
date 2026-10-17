# Mermaid Markdown Features

**Notice:** This extension is bundled with Visual Studio Code. It can be disabled but not uninstalled.

Adds [Mermaid.js](https://mermaid.js.org) diagram rendering to Markdown previews and notebooks.

## Building the webviews

Run `npm run build-webview` from this directory to build the webview bundles.
The Markdown preview and notebook renderer use minified ES modules with code splitting so Mermaid's diagram implementations and add-ons can load on demand.
When copying or packaging the extension, include all emitted files in `webview-out`: the markdown preview, notebook renderer, and diagram editor share one code-split bundle so Mermaid chunks load once.
