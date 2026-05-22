import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Input, getKeybindings, matchesKey, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const VAULT_DIRS = [path.join(os.homedir(), ".pi", "agent", "skill-vault")];
const PROJECT_CONFIG_DIR = ".pi";

function expandHome(value) {
  if (!value || typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isPatternEntry(value) {
  return typeof value === "string" && /^[!+-]/.test(value);
}

function resolveProjectSettingsEntry(cwd, value) {
  const expanded = expandHome(value);
  if (path.isAbsolute(expanded)) return path.resolve(expanded);
  return path.resolve(cwd, PROJECT_CONFIG_DIR, expanded);
}

function parseFrontmatter(skillFile) {
  try {
    const text = fs.readFileSync(skillFile, "utf8");
    const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return {};
    const data = {};
    for (const line of match[1].split(/\r?\n/)) {
      const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!field) continue;
      const key = field[1].trim();
      const raw = field[2].trim();
      data[key] = raw.replace(/^['"]|['"]$/g, "");
    }
    return data;
  } catch {
    return {};
  }
}

function collectSkillEntries(rootDir) {
  const entries = [];
  if (!fs.existsSync(rootDir)) return entries;

  function walk(dir) {
    let dirEntries;
    try {
      dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const skillFile = path.join(dir, "SKILL.md");
    if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
      const relativeDir = path.relative(rootDir, dir).split(path.sep).join("/");
      const meta = parseFrontmatter(skillFile);
      entries.push({
        name: meta.name || path.basename(dir),
        displayName: relativeDir || path.basename(dir),
        description: meta.description || "",
        dir,
        skillFile,
        rootDir,
      });
      return;
    }

    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (dir === rootDir && entry.isFile() && entry.name.endsWith(".md")) {
        const meta = parseFrontmatter(fullPath);
        if (!meta.name && !meta.description) continue;
        entries.push({
          name: meta.name || entry.name.replace(/\.md$/, ""),
          displayName: entry.name.replace(/\.md$/, ""),
          description: meta.description || "",
          dir: fullPath,
          skillFile: fullPath,
          rootDir,
        });
      }
    }
  }

  walk(rootDir);
  entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return entries;
}

function scanVaultSkills() {
  return VAULT_DIRS.flatMap((rootDir) => collectSkillEntries(rootDir));
}

function buildManagedPathSet(entries) {
  const managed = new Set();
  for (const entry of entries) {
    managed.add(path.resolve(entry.dir));
    managed.add(path.resolve(entry.skillFile));
  }
  return managed;
}

function getCurrentProjectSkillEntries(settingsManager) {
  const projectSettings = settingsManager.getProjectSettings();
  return Array.isArray(projectSettings.skills) ? [...projectSettings.skills] : [];
}

function buildSelectedVaultSet(cwd, entries, currentSettingsEntries) {
  const selected = new Set();
  const managed = buildManagedPathSet(entries);
  for (const rawEntry of currentSettingsEntries) {
    if (typeof rawEntry !== "string" || isPatternEntry(rawEntry)) continue;
    const resolved = resolveProjectSettingsEntry(cwd, rawEntry);
    if (managed.has(resolved)) {
      selected.add(path.basename(resolved) === "SKILL.md" ? path.dirname(resolved) : resolved);
    }
  }
  return selected;
}

function buildNextProjectSkillEntries(cwd, currentSettingsEntries, selectedVaultDirs, entries) {
  const managed = buildManagedPathSet(entries);
  const preserved = currentSettingsEntries.filter((rawEntry) => {
    if (typeof rawEntry !== "string") return false;
    if (isPatternEntry(rawEntry)) return true;
    const resolved = resolveProjectSettingsEntry(cwd, rawEntry);
    return !managed.has(resolved);
  });

  const selected = Array.from(selectedVaultDirs).sort((a, b) => a.localeCompare(b));
  return [...preserved, ...selected];
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function padToWidth(text, width) {
  const truncated = truncateToWidth(text, width, "...");
  const padding = Math.max(0, width - visibleWidth(truncated));
  return truncated + " ".repeat(padding);
}

class SkillScopeSelector {
  constructor({ items, initialSelected, initialQuery, cwd, theme, tui, done }) {
    this.items = items;
    this.filteredItems = [...items];
    this.selectedIndex = 0;
    this.selected = new Set(initialSelected);
    this.cwd = cwd;
    this.theme = theme;
    this.tui = tui;
    this.done = done;
    this.searchInput = new Input();
    this.searchInput.setValue(initialQuery || "");
    this.maxVisible = Math.max(6, (tui?.terminal?.rows || 24) - 10);
    this._focused = false;
    this.filterItems(this.searchInput.getValue());
  }

  get focused() {
    return this._focused;
  }

  set focused(value) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  closeWithSave() {
    this.done({ selectedDirs: Array.from(this.selected) });
  }

  closeWithoutSave() {
    this.done(null);
  }

  getSelectedCount() {
    return this.selected.size;
  }

  filterItems(query) {
    const needle = (query || "").trim().toLowerCase();
    if (!needle) {
      this.filteredItems = [...this.items];
    } else {
      this.filteredItems = this.items.filter((item) => {
        return (
          item.displayName.toLowerCase().includes(needle) ||
          item.name.toLowerCase().includes(needle) ||
          item.dir.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle)
        );
      });
    }
    if (this.filteredItems.length === 0) {
      this.selectedIndex = 0;
    } else if (this.selectedIndex >= this.filteredItems.length) {
      this.selectedIndex = this.filteredItems.length - 1;
    }
  }

  currentItem() {
    return this.filteredItems[this.selectedIndex] || null;
  }

  toggleCurrent() {
    const item = this.currentItem();
    if (!item) return;
    const key = path.resolve(item.dir);
    if (this.selected.has(key)) this.selected.delete(key);
    else this.selected.add(key);
  }

  move(delta) {
    if (this.filteredItems.length === 0) return;
    this.selectedIndex = Math.max(0, Math.min(this.filteredItems.length - 1, this.selectedIndex + delta));
  }

  page(delta) {
    if (this.filteredItems.length === 0) return;
    const jump = Math.max(1, this.maxVisible - 2);
    this.move(delta * jump);
  }

  invalidate() {}

  handleInput(data) {
    const kb = getKeybindings();

    if (matchesKey(data, Key.ctrl("c"))) {
      this.closeWithoutSave();
      return;
    }
    if (kb.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
      this.closeWithSave();
      return;
    }
    if (kb.matches(data, "tui.input.submit") || matchesKey(data, Key.enter) || matchesKey(data, "return")) {
      this.closeWithSave();
      return;
    }
    if (matchesKey(data, Key.space) || data === " ") {
      this.toggleCurrent();
      this.tui.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.up") || matchesKey(data, Key.up)) {
      this.move(-1);
      this.tui.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.down") || matchesKey(data, Key.down)) {
      this.move(1);
      this.tui.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.pageUp")) {
      this.page(-1);
      this.tui.requestRender();
      return;
    }
    if (kb.matches(data, "tui.select.pageDown")) {
      this.page(1);
      this.tui.requestRender();
      return;
    }

    this.searchInput.handleInput(data);
    this.filterItems(this.searchInput.getValue());
    this.tui.requestRender();
  }

  render(width) {
    const innerWidth = Math.max(10, width - 2);
    const lines = [];
    const frame = (text = "") => `│${padToWidth(text, innerWidth)}│`;
    const rule = `├${"─".repeat(innerWidth)}┤`;

    const repoName = path.basename(this.cwd);
    const title = this.theme.fg("accent", this.theme.bold("Scope Skills"));
    const titleLine = `${title} ${this.theme.fg("muted", `(${repoName})`)}`;
    const hintLine = this.theme.fg("muted", "type to search · arrows move · space toggle · enter/esc save · ctrl+c cancel");
    const summaryLine = this.theme.fg("muted", `${this.getSelectedCount()}/${this.items.length} selected from skill vault`);

    lines.push(`┌${"─".repeat(innerWidth)}┐`);
    lines.push(frame(titleLine));
    lines.push(frame(hintLine));
    lines.push(frame(summaryLine));
    lines.push(rule);

    for (const line of this.searchInput.render(innerWidth)) {
      lines.push(frame(line));
    }
    lines.push(rule);

    if (this.filteredItems.length === 0) {
      lines.push(frame(this.theme.fg("muted", "No vault skills match this search.")));
    } else {
      const startIndex = Math.max(
        0,
        Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
      );
      const endIndex = Math.min(this.filteredItems.length, startIndex + this.maxVisible);

      for (let index = startIndex; index < endIndex; index++) {
        const item = this.filteredItems[index];
        const active = index === this.selectedIndex;
        const checked = this.selected.has(path.resolve(item.dir));
        const prefix = active ? this.theme.fg("accent", ">") : " ";
        const checkbox = checked ? this.theme.fg("success", "[x]") : this.theme.fg("dim", "[ ]");
        const name = active ? this.theme.bold(item.displayName) : item.displayName;
        lines.push(frame(`${prefix} ${checkbox} ${name}`));
      }

      const current = this.currentItem();
      lines.push(rule);
      if (current) {
        const location = current.dir.replace(`${os.homedir()}/`, "~/");
        lines.push(frame(this.theme.fg("muted", location)));
        if (current.description) {
          lines.push(frame(this.theme.fg("muted", current.description)));
        }
      }
    }

    lines.push(`└${"─".repeat(innerWidth)}┘`);
    return lines;
  }
}

export default function scopeSkillExtension(pi) {
  function getSkillNames() {
    return scanVaultSkills().map((entry) => entry.displayName);
  }

  pi.registerCommand("scope-skill", {
    description: "Scope skill-vault skills into the current project",
    getArgumentCompletions: (prefix) => {
      const needle = (prefix || "").toLowerCase();
      const matches = getSkillNames()
        .filter((name) => name.toLowerCase().includes(needle))
        .slice(0, 20)
        .map((name) => ({ value: name, label: name }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/scope-skill requires interactive UI", "error");
        return;
      }

      const items = scanVaultSkills();
      if (items.length === 0) {
        ctx.ui.notify("No skills found in ~/.pi/agent/skill-vault", "info");
        return;
      }

      const settingsManager = SettingsManager.create(ctx.cwd);
      const currentSettingsEntries = getCurrentProjectSkillEntries(settingsManager);
      const initialSelected = buildSelectedVaultSet(ctx.cwd, items, currentSettingsEntries);

      const result = await ctx.ui.custom(
        (tui, theme, _keybindings, done) => {
          const selector = new SkillScopeSelector({
            items,
            initialSelected,
            initialQuery: (args || "").trim(),
            cwd: ctx.cwd,
            theme,
            tui,
            done,
          });
          selector.focused = true;
          return selector;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "70%",
            minWidth: 56,
            maxHeight: "80%",
            anchor: "center",
            margin: 1,
          },
        },
      );

      if (!result) {
        ctx.ui.notify("Skill scoping cancelled", "info");
        return;
      }

      const nextSelected = new Set((result.selectedDirs || []).map((value) => path.resolve(value)));
      const changed = !setsEqual(initialSelected, nextSelected);
      if (!changed) {
        ctx.ui.notify("Skill scope unchanged", "info");
        return;
      }

      const nextEntries = buildNextProjectSkillEntries(ctx.cwd, currentSettingsEntries, nextSelected, items);
      settingsManager.setProjectSkillPaths(nextEntries);
      ctx.ui.notify(`Saved ${nextSelected.size} scoped skill${nextSelected.size === 1 ? "" : "s"}; reloading…`, "info");
      await ctx.reload();
      return;
    },
  });
}
