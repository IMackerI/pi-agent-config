---
name: jupyter-notebooks
description: Work with local Jupyter .ipynb notebooks as structured cells in Pi. Use for notebook overview, cell reading/editing/insertion/deletion, clearing outputs, and executing cells with a Pi-owned local kernel.
---

# Jupyter Notebooks

Use this skill for local `.ipynb` files, especially notebooks opened in VS Code.

Do not use browser, CDP, JupyterLab, or web tools for this workflow unless the user explicitly asks for live web/JupyterLab debugging.

## Tool guidance

Available notebook tools:

- `notebook_create`: create a new notebook from a lightweight `experiment`, `tutorial`, or `blank` template.
- `notebook_overview`: compact cell map with indexes, ids, hashes, types, previews, and output counts.
- `notebook_read_cell`: read one cell source cleanly, optionally with saved outputs.
- `notebook_edit_cell`: exact small replacement in one cell's visible source.
- `notebook_replace_cell`: replace the whole visible source of one cell.
- `notebook_insert_cell`: insert a new code/markdown/raw cell.
- `notebook_delete_cells`: delete selected cells.
- `notebook_clear_outputs`: clear saved outputs/execution counts.
- `notebook_check_syntax`: parse selected code cells with Python `ast.parse` without executing them.
- `notebook_execute_cells`: execute selected cells using a Pi-owned persistent local kernel.
- `notebook_restart_kernel`: restart or shut down the Pi-owned persistent kernel.

## Prefer normal tools for simple inspection

Use ordinary `bash`, Python one-liners, `grep`, `rg`, `jq`, or raw JSON inspection for simple tasks such as:

- searching all notebook cells,
- counting cells,
- checking metadata,
- bulk grepping text,
- quick ad hoc JSON queries.

Use notebook tools when cell structure matters or raw JSON would be noisy/risky.

For coordinated multi-cell refactors or whole-notebook cleanup, a short Python JSON script may be faster and clearer than many individual cell tool calls.

## Notebook creation suggestions

When creating a new notebook, lightly classify the intent:

- exploratory, analytical, or hypothesis-driven work -> `kind="experiment"`
- instructional, step-by-step, or audience-specific work -> `kind="tutorial"`
- minimal scratch notebook -> `kind="blank"`

For existing notebooks, treat changes as a refactor: preserve the user's intent and improve structure only where useful.

## Safe editing workflow

1. Run `notebook_overview` before editing to identify the right cell.
2. Run `notebook_read_cell` before editing/replacing/deleting a specific cell.
3. Prefer `notebook_edit_cell` for small exact changes.
4. Prefer `notebook_replace_cell` for full cell rewrites.
5. Use the returned `hash` as `expected_hash` when editing important cells to avoid stale edits.
6. Unless the user asks otherwise, avoid adding a trailing newline at the end of cell source.
7. After editing Python code cells, consider `notebook_check_syntax` instead of writing an ad hoc `ast.parse` script.
8. Do not casually reorganize notebooks; there is intentionally no move-cell tool.

## Quality suggestions

Before handing off a notebook, consider a final pass:

- Run it top-to-bottom when the environment allows.
- Prefer early cells that define required state; avoid relying on hidden state.
- Keep outputs tidy and avoid giant outputs when short summaries work.
- Keep markdown skimmable with headings, short bullets, and concise explanations.
- If execution is not possible, say so and mention how the user can validate locally.

## Syntax checking

`notebook_check_syntax` uses Python `ast.parse` with the selected interpreter when possible.

- It does not execute code.
- It may flag IPython magics and shell escapes as syntax errors because they are not normal Python syntax.
- Pass `python_path`, commonly `.venv/bin/python`, when version-specific syntax matters.

## Execution model

`notebook_execute_cells` uses a Pi-owned persistent kernel keyed by notebook path, interpreter/kernel, and cwd.

Important limitations:

- It is not the VS Code live kernel.
- It can use the same interpreter, e.g. `.venv/bin/python`, but it does not share variables with VS Code's running notebook.
- Variables/imports persist across Pi tool calls until `notebook_restart_kernel`, Pi reload/exit, or helper crash.
- Use `notebook_restart_kernel` when hidden state might confuse results.
- When done executing notebook cells, shut down the Pi-owned kernel with `notebook_restart_kernel(..., shutdown_only=true)` unless you expect to continue using it soon.

When environment matters, pass `python_path`, commonly `.venv/bin/python`.

If `python_path` is omitted, the tool auto-detects a local `.venv/bin/python`, then notebook metadata kernelspec, then `python3`.

Execution requires `ipykernel` in the selected Python environment. If missing, install it in that environment.
