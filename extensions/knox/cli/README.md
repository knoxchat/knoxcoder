# `@knoxchat/cli`

Headless Knox for CI and scripts. Same agent loop as the editor.

```
npm i -g @knoxchat/cli
knox --version
knox doctor
knox login
knox run "fix the failing test" --json
```

Until the package is on the public registry, install from this repo:

```
cd extensions/knox
npm run build:cli
npm i -g ./cli
```

Auth: `knox login` or `KNOX_API_KEY`. Never pass keys on the command line.

Docs: [../docs/cli.md](../docs/cli.md).
