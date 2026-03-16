# Monaco editor files

This project loads Monaco from the local filesystem for predictable, offline-friendly behavior.

Place the following files inside this directory:

```
static/vendor/monaco/loader.js
static/vendor/monaco/vs/**   (entire `vs` directory)
```

You can obtain them from the `monaco-editor` npm package:

```
npm install monaco-editor
cp node_modules/monaco-editor/min/vs/loader.js static/vendor/monaco/loader.js
cp -R node_modules/monaco-editor/min/vs static/vendor/monaco/vs
```

Once copied, the Edit tab will load Monaco via:

- `/static/vendor/monaco/loader.js`
- `/static/vendor/monaco/vs/editor/editor.main`

If you prefer to skip Monaco entirely, leave this directory empty and the application
will use the stub loader (no editor functionality). To enable the editor, you must copy
the actual `vs/` folder described above.
