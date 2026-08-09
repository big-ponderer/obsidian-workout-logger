const {
  FuzzySuggestModal,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  parseYaml,
} = require("obsidian");

const VIEW_TYPE = "workout-logger-today";
const ROOT = "Workout Tracker";
const FOLDERS = {
  sessions: `${ROOT}/Sessions`,
  logs: `${ROOT}/Exercise Logs`,
  exercises: `${ROOT}/Exercises`,
  locations: `${ROOT}/Locations`,
  machines: `${ROOT}/Machines`,
};
const AGNOSTIC = "Machine agnostic";
const DEFAULT_SETTINGS = {
  defaultSessionName: "Workout",
  lastLocation: "",
  defaultSets: 3,
};

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeName(value, fallback = "Workout") {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|#^\[\]]+/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^[ .-]+|[ .-]+$/g, "");
  return cleaned || fallback;
}

function linkTarget(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return null;
  value = value.trim();
  if (!value.startsWith("[[") || !value.endsWith("]]")) return null;
  return value.slice(2, -2).split("|", 1)[0].split("#", 1)[0];
}

function linkLabel(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return "";
  if (value.startsWith("[[") && value.endsWith("]]")) {
    const inner = value.slice(2, -2);
    const pipe = inner.indexOf("|");
    if (pipe >= 0) return inner.slice(pipe + 1);
    return inner.split("/").pop();
  }
  return value;
}

function noteLink(path, label) {
  const target = path.endsWith(".md") ? path.slice(0, -3) : path;
  return `[[${target}${label ? `|${label}` : ""}]]`;
}

function yamlValue(key, value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  if (key === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  return JSON.stringify(String(value));
}

function makeFrontmatter(properties) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    lines.push(`${key}: ${yamlValue(key, value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function makeExerciseLogBody(properties) {
  return `${makeFrontmatter(properties)}# ${properties.title}\n\n> [!workout] Logged set group\n> **Exercise:** ${properties.exercise}  \n> **Session:** ${properties.session}  \n> **Location:** ${properties.location || "—"} · **Machine:** ${properties.machine}  \n> **Sets:** ${properties.sets} · **Reps:** ${properties.reps || "—"} · **Weight:** ${properties.weight || "—"}\n${properties.notes ? `\n## Notes\n\n${properties.notes}\n` : ""}`;
}

function parseReps(raw, sets) {
  const text = String(raw || "").trim();
  const values = text
    .split(",")
    .map((part) => part.match(/\d+/))
    .filter(Boolean)
    .map((match) => Number(match[0]));
  let total = null;
  if (/^\d+$/.test(text) && Number.isFinite(sets)) total = Number(text) * sets;
  else if (/^\d+(?:,\s*\d+)*,?$/.test(text)) total = values.reduce((sum, value) => sum + value, 0);
  return { values, total };
}

function parseWeight(raw, totalReps) {
  const text = String(raw || "").trim();
  const exact = text.match(/^(\d+(?:\.\d+)?)\s*(lbs?|kgs?)$/i);
  if (exact) {
    const value = Number(exact[1]);
    const unit = exact[2].toLowerCase().startsWith("lb") ? "lb" : "kg";
    return { value, unit, volume: totalReps == null ? null : value * totalReps };
  }
  const machine = text.match(/^(\d+(?:\.\d+)?)\s+(?:on\s+)?(?:.*\s+)?machine\s*$/i);
  if (machine) return { value: Number(machine[1]), unit: "machine", volume: null };
  if (/^body\s*weight$/i.test(text)) return { value: null, unit: "bodyweight", volume: null };
  return { value: null, unit: null, volume: null };
}

class WorkoutLoggerPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.transientFrontmatter = new Map();

    this.registerView(VIEW_TYPE, (leaf) => new TodayWorkoutView(leaf, this));
    this.addRibbonIcon("dumbbell", "Workout Logger: Today", () => this.openToday());
    this.addCommand({
      id: "open-todays-workout",
      name: "Today",
      callback: () => this.openToday(),
    });
    this.addCommand({
      id: "log-exercise",
      name: "Log exercise",
      callback: async () => {
        const session = await this.ensureTodaySession();
        new ExercisePicker(this, session).open();
      },
    });
    this.addSettingTab(new WorkoutLoggerSettingTab(this.app, this));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.transientFrontmatter.delete(file.path);
        this.refreshViews();
      }),
    );
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  frontmatterFor(file) {
    const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return this.transientFrontmatter.get(file.path) || cached || {};
  }

  async readFrontmatter(file) {
    const cached = this.frontmatterFor(file);
    if (cached && Object.keys(cached).length) return cached;
    const text = await this.app.vault.cachedRead(file);
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return match ? parseYaml(match[1]) || {} : {};
  }

  filesByType(recordType) {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.frontmatterFor(file).record_type === recordType);
  }

  async ensureFolder(path) {
    const parts = normalizePath(path).split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  async uniquePath(folder, stem) {
    await this.ensureFolder(folder);
    let path = normalizePath(`${folder}/${safeName(stem)}.md`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${safeName(stem)} ${suffix}.md`);
      suffix += 1;
    }
    return path;
  }

  getKnownLocations() {
    return this.filesByType("workout-location")
      .map((file) => this.frontmatterFor(file).title || file.basename)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  getKnownMachines() {
    return this.filesByType("workout-machine")
      .map((file) => this.frontmatterFor(file).title || file.basename)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  getExercises() {
    return this.filesByType("exercise")
      .map((file) => ({ file, frontmatter: this.frontmatterFor(file) }))
      .sort((a, b) => String(a.frontmatter.title || a.file.basename).localeCompare(String(b.frontmatter.title || b.file.basename)));
  }

  getTodaySession() {
    const today = localDate();
    return this.filesByType("workout-session").find(
      (file) => String(this.frontmatterFor(file).date || "") === today,
    );
  }

  async latestLocation() {
    const sessions = this.filesByType("workout-session")
      .map((file) => this.frontmatterFor(file))
      .filter((frontmatter) => frontmatter.location)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    return linkLabel(sessions[0]?.location) || "";
  }

  async ensureReference(folder, label, recordType, extra = {}) {
    if (!label) return null;
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/${safeName(label, "Reference")}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    const properties = {
      title: label,
      record_type: recordType,
      ...extra,
      tags: [recordType === "workout-location" ? "workout/location" : "workout/machine"],
    };
    const body = `${makeFrontmatter(properties)}# ${label}\n\nWorkout Logger reference profile.\n`;
    const file = await this.app.vault.create(path, body);
    this.transientFrontmatter.set(file.path, properties);
    return file;
  }

  locationLink(label) {
    return label ? noteLink(`${FOLDERS.locations}/${safeName(label)}.md`, label) : "";
  }

  machineLink(label) {
    return noteLink(`${FOLDERS.machines}/${safeName(label, "Machine")}.md`, label);
  }

  async ensureTodaySession() {
    const existing = this.getTodaySession();
    if (existing) return existing;
    const date = localDate();
    const title = this.settings.defaultSessionName || "Workout";
    const location = this.settings.lastLocation || (await this.latestLocation());
    if (location) await this.ensureReference(FOLDERS.locations, location, "workout-location");
    const path = await this.uniquePath(FOLDERS.sessions, `${date} - ${title}`);
    const properties = {
      title,
      type: "single",
      record_type: "workout-session",
      date,
      allDay: true,
      location: this.locationLink(location),
      exercise_count: 0,
      set_count: 0,
      tracked_reps: 0,
      exercises: [],
      exercise_logs: [],
      tags: ["workout/session"],
      cssclasses: ["workout-session"],
    };
    const body = `${makeFrontmatter(properties)}# ${title}\n\n> [!workout] ${date}\n> **Location:** ${properties.location || "—"}\n\n## Exercises\n\nUse **Log exercise** in Workout Logger.\n`;
    const file = await this.app.vault.create(path, body);
    this.transientFrontmatter.set(file.path, properties);
    if (location && location !== this.settings.lastLocation) {
      this.settings.lastLocation = location;
      await this.saveSettings();
    }
    new Notice(`Started ${title} for ${date}`);
    return file;
  }

  async openToday() {
    await this.ensureTodaySession();
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof TodayWorkoutView) leaf.view.render();
    }
  }

  fileFromLink(value) {
    const target = linkTarget(value);
    if (!target) return null;
    const path = target.endsWith(".md") ? target : `${target}.md`;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file : null;
  }

  getLogsForSession(session, excludePath = "") {
    const target = session.path.slice(0, -3);
    return this.filesByType("exercise-log")
      .filter((file) => file.path !== excludePath && linkTarget(this.frontmatterFor(file).session) === target)
      .map((file) => ({ file, frontmatter: this.frontmatterFor(file) }))
      .sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
  }

  getLogsForExercise(exercise, excludePath = "") {
    const target = exercise.path.slice(0, -3);
    return this.filesByType("exercise-log")
      .filter((file) => file.path !== excludePath && linkTarget(this.frontmatterFor(file).exercise) === target)
      .map((file) => ({ file, frontmatter: this.frontmatterFor(file) }))
      .sort((a, b) => {
        const byDate = String(b.frontmatter.date || "").localeCompare(String(a.frontmatter.date || ""));
        return byDate || b.file.stat.mtime - a.file.stat.mtime;
      });
  }

  async refreshSessionStats(session, excludePath = "") {
    const logs = this.getLogsForSession(session, excludePath);
    const exercises = [];
    const seenExercises = new Set();
    let setCount = 0;
    let trackedReps = 0;
    for (const { frontmatter } of logs) {
      const target = linkTarget(frontmatter.exercise);
      if (target && !seenExercises.has(target)) {
        seenExercises.add(target);
        exercises.push(frontmatter.exercise);
      }
      setCount += Number(frontmatter.sets || frontmatter.sets_raw || 0) || 0;
      trackedReps += Number(frontmatter.total_reps || 0) || 0;
    }
    await this.app.fileManager.processFrontMatter(session, (frontmatter) => {
      delete frontmatter.completed;
      frontmatter.exercises = exercises;
      frontmatter.exercise_logs = logs.map(({ file }) => noteLink(file.path, "log"));
      frontmatter.exercise_count = exercises.length;
      frontmatter.set_count = setCount;
      frontmatter.tracked_reps = trackedReps;
    });
  }

  async refreshExerciseStats(exercise, excludePath = "") {
    const history = this.getLogsForExercise(exercise, excludePath);
    const dates = history
      .map(({ frontmatter }) => String(frontmatter.date || ""))
      .filter(Boolean)
      .sort();
    await this.app.fileManager.processFrontMatter(exercise, (frontmatter) => {
      frontmatter.log_count = history.length;
      if (dates.length) {
        frontmatter.first_performed = dates[0];
        frontmatter.last_performed = dates[dates.length - 1];
      } else {
        delete frontmatter.first_performed;
        delete frontmatter.last_performed;
      }
      if (!frontmatter.default_machine) frontmatter.default_machine = this.machineLink(AGNOSTIC);
    });

    const current = await this.app.vault.cachedRead(exercise);
    const fm = await this.readFrontmatter(exercise);
    const summary = `> [!workout] Exercise summary\n> **Machine policy:** ${fm.machine_policy || "agnostic"} · **Logs:** ${history.length}  \n> **Last performed:** ${dates.length ? dates[dates.length - 1] : "Never"}`;
    const updated = current.replace(
      /> \[!workout\] Exercise summary\r?\n(?:>[^\n]*(?:\r?\n|$))+/,
      `${summary}\n`,
    );
    if (updated !== current) await this.app.vault.modify(exercise, updated);
  }

  async openFile(file) {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }

  machineFor(exerciseFrontmatter, exerciseTitle, location, history) {
    const sameLocation = history.find(
      ({ frontmatter }) => linkLabel(frontmatter.location) === location && frontmatter.machine,
    );
    if (sameLocation) return linkLabel(sameLocation.frontmatter.machine);
    const policy = exerciseFrontmatter.machine_policy || "agnostic";
    if (policy === "location-specific") return `${location || "Unspecified"} · Cable stack`;
    if (policy === "machine-specific") return `${location || "Unspecified"} · ${exerciseTitle}`;
    return linkLabel(exerciseFrontmatter.default_machine) || AGNOSTIC;
  }

  async createExerciseLog(session, exercise, form) {
    const sessionFm = await this.readFrontmatter(session);
    const exerciseFm = await this.readFrontmatter(exercise);
    const date = String(sessionFm.date || localDate());
    const exerciseTitle = String(exerciseFm.title || exercise.basename);
    const sessionTitle = String(sessionFm.title || session.basename);
    const location = form.location || linkLabel(sessionFm.location);
    const machine = form.machine || AGNOSTIC;
    if (location) await this.ensureReference(FOLDERS.locations, location, "workout-location");
    await this.ensureReference(FOLDERS.machines, machine, "workout-machine", {
      machine_kind: exerciseFm.machine_policy || "agnostic",
      location: this.locationLink(location),
    });

    const sets = Number(form.sets) || this.settings.defaultSets || 3;
    const reps = parseReps(form.reps, sets);
    const weight = parseWeight(form.weight, reps.total);
    const id = Date.now().toString(36).slice(-8);
    const path = await this.uniquePath(FOLDERS.logs, `${date} - ${exerciseTitle} [${id}]`);
    const exerciseLink = noteLink(exercise.path, exerciseTitle);
    const sessionLink = noteLink(session.path, sessionTitle);
    const properties = {
      title: `${exerciseTitle} — ${date}`,
      record_type: "exercise-log",
      date,
      logged_at: new Date().toISOString(),
      exercise: exerciseLink,
      session: sessionLink,
      location: this.locationLink(location),
      machine: this.machineLink(machine),
      muscle_groups: exerciseFm.muscle_groups || [],
      sets,
      sets_raw: String(sets),
      reps: form.reps.trim(),
      rep_values: reps.values,
      total_reps: reps.total,
      weight: form.weight.trim(),
      weight_value: weight.value,
      weight_unit: weight.unit,
      volume: weight.volume,
      notes: form.notes.trim(),
      data_quality: [],
      tags: ["workout/log"],
      cssclasses: ["exercise-log"],
    };
    const body = makeExerciseLogBody(properties);
    const file = await this.app.vault.create(path, body);
    this.transientFrontmatter.set(file.path, properties);

    await this.app.fileManager.processFrontMatter(session, (frontmatter) => {
      delete frontmatter.completed;
      if (location) frontmatter.location = this.locationLink(location);
    });
    await this.refreshSessionStats(session);
    await this.refreshExerciseStats(exercise);

    if (location && location !== this.settings.lastLocation) {
      this.settings.lastLocation = location;
      await this.saveSettings();
    }
    new Notice(`Logged ${exerciseTitle}`);
    this.refreshViews();
    return file;
  }

  async updateExerciseLog(file, session, exercise, form) {
    const previous = await this.readFrontmatter(file);
    const previousExercise = this.fileFromLink(previous.exercise);
    const sessionFm = await this.readFrontmatter(session);
    const exerciseFm = await this.readFrontmatter(exercise);
    const exerciseTitle = String(exerciseFm.title || exercise.basename);
    const location = form.location || linkLabel(sessionFm.location);
    const machine = form.machine || AGNOSTIC;
    if (location) await this.ensureReference(FOLDERS.locations, location, "workout-location");
    await this.ensureReference(FOLDERS.machines, machine, "workout-machine", {
      machine_kind: exerciseFm.machine_policy || "agnostic",
      location: this.locationLink(location),
    });

    const sets = Number(form.sets) || this.settings.defaultSets || 3;
    const reps = parseReps(form.reps, sets);
    const weight = parseWeight(form.weight, reps.total);
    const properties = {
      ...previous,
      title: `${exerciseTitle} — ${previous.date || localDate()}`,
      record_type: "exercise-log",
      exercise: noteLink(exercise.path, exerciseTitle),
      session: previous.session || noteLink(session.path, sessionFm.title || session.basename),
      location: this.locationLink(location),
      machine: this.machineLink(machine),
      muscle_groups: exerciseFm.muscle_groups || previous.muscle_groups || [],
      sets,
      sets_raw: String(sets),
      reps: String(form.reps || "").trim(),
      rep_values: reps.values,
      total_reps: reps.total,
      weight: String(form.weight || "").trim(),
      weight_value: weight.value,
      weight_unit: weight.unit,
      volume: weight.volume,
      notes: String(form.notes || "").trim(),
      edited_at: new Date().toISOString(),
    };
    await this.app.vault.modify(file, makeExerciseLogBody(properties));
    this.transientFrontmatter.set(file.path, properties);

    await this.refreshSessionStats(session);
    await this.refreshExerciseStats(exercise);
    if (previousExercise && previousExercise.path !== exercise.path) {
      await this.refreshExerciseStats(previousExercise);
    }

    if (location && location !== this.settings.lastLocation) {
      this.settings.lastLocation = location;
      await this.saveSettings();
    }
    new Notice(`Updated ${exerciseTitle}`);
    this.refreshViews();
    return file;
  }

  async deleteExerciseLog(file, session, exercise) {
    const frontmatter = await this.readFrontmatter(file);
    const linkedExercise = this.fileFromLink(frontmatter.exercise) || exercise;
    await this.app.fileManager.trashFile(file);
    this.transientFrontmatter.delete(file.path);
    await this.refreshSessionStats(session, file.path);
    await this.refreshExerciseStats(linkedExercise, file.path);
    new Notice(`Deleted ${linkedExercise.basename} log`);
    this.refreshViews();
  }
}

class TodayWorkoutView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Workout Today";
  }

  getIcon() {
    return "dumbbell";
  }

  async onOpen() {
    await this.render();
  }

  async render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("workout-logger-view");
    const session = await this.plugin.ensureTodaySession();
    const frontmatter = await this.plugin.readFrontmatter(session);
    const location = linkLabel(frontmatter.location);

    const header = root.createDiv({ cls: "workout-logger-header" });
    header.createDiv({ cls: "workout-logger-kicker", text: localDate() });
    const titleInput = header.createEl("input", {
      cls: "workout-logger-title",
      attr: { type: "text", "aria-label": "Session name" },
    });
    titleInput.value = String(frontmatter.title || "Workout");
    titleInput.addEventListener("change", async () => {
      const title = titleInput.value.trim() || "Workout";
      await this.app.fileManager.processFrontMatter(session, (fm) => (fm.title = title));
    });

    const controls = root.createDiv({ cls: "workout-logger-controls" });
    const locationSelect = controls.createEl("select", { attr: { "aria-label": "Workout location" } });
    locationSelect.createEl("option", { text: "No location", attr: { value: "" } });
    const locations = Array.from(new Set([...this.plugin.getKnownLocations(), location])).filter(Boolean);
    for (const item of locations) locationSelect.createEl("option", { text: item, attr: { value: item } });
    locationSelect.value = location;
    locationSelect.addEventListener("change", async () => {
      const next = locationSelect.value;
      if (next) await this.plugin.ensureReference(FOLDERS.locations, next, "workout-location");
      await this.app.fileManager.processFrontMatter(session, (fm) => {
        if (next) fm.location = this.plugin.locationLink(next);
        else delete fm.location;
      });
      this.plugin.settings.lastLocation = next;
      await this.plugin.saveSettings();
      this.render();
    });

    const addLocation = controls.createEl("button", { cls: "clickable-icon", text: "+ Location" });
    addLocation.addEventListener("click", () => new NewLocationModal(this.plugin, session, this).open());

    const primary = root.createEl("button", { cls: "mod-cta workout-logger-primary", text: "+ Log exercise" });
    primary.addEventListener("click", () => new ExercisePicker(this.plugin, session).open());

    const secondary = root.createDiv({ cls: "workout-logger-secondary" });
    const openNote = secondary.createEl("button", { text: "Open session note" });
    openNote.addEventListener("click", () => this.plugin.openFile(session));

    const logs = this.plugin.getLogsForSession(session);
    const summary = root.createDiv({ cls: "workout-logger-summary" });
    summary.createSpan({ text: `${logs.length} exercise${logs.length === 1 ? "" : "s"}` });
    summary.createSpan({ text: location || "No location" });

    const list = root.createDiv({ cls: "workout-log-list" });
    if (!logs.length) {
      list.createDiv({ cls: "workout-logger-empty", text: "No exercises yet. Your first log is one tap away." });
      return;
    }
    for (const item of logs) {
      const fm = item.frontmatter;
      const card = list.createDiv({ cls: "workout-log-card" });
      const top = card.createDiv({ cls: "workout-log-card-top" });
      const exerciseButton = top.createEl("button", {
        cls: "workout-log-exercise",
        text: linkLabel(fm.exercise) || "Unknown exercise",
      });
      const exerciseFile = this.plugin.fileFromLink(fm.exercise);
      exerciseButton.addEventListener("click", () => {
        if (exerciseFile) new LogExerciseModal(this.plugin, session, exerciseFile, item.file).open();
      });
      top.createSpan({ cls: "workout-log-machine", text: linkLabel(fm.machine) || AGNOSTIC });
      card.createDiv({
        cls: "workout-log-performance",
        text: `${fm.sets_raw || fm.sets || "—"} sets · ${fm.reps || "—"} reps · ${fm.weight || "—"}`,
      });
      const actions = card.createDiv({ cls: "workout-log-card-actions" });
      const edit = actions.createEl("button", { cls: "workout-log-open", text: "Edit" });
      edit.addEventListener("click", () => {
        if (exerciseFile) new LogExerciseModal(this.plugin, session, exerciseFile, item.file).open();
      });
      const history = actions.createEl("button", { cls: "workout-log-open", text: "History" });
      history.addEventListener("click", () => {
        if (exerciseFile) new ExerciseHistoryModal(this.plugin, exerciseFile, location).open();
      });
    }
  }
}

class ExercisePicker extends FuzzySuggestModal {
  constructor(plugin, session, onChoose = null) {
    super(plugin.app);
    this.plugin = plugin;
    this.session = session;
    this.onChoose = onChoose;
    this.setPlaceholder("Search exercises…");
  }

  getItems() {
    return this.plugin.getExercises();
  }

  getItemText(item) {
    return String(item.frontmatter.title || item.file.basename);
  }

  onChooseItem(item) {
    if (this.onChoose) this.onChoose(item);
    else new LogExerciseModal(this.plugin, this.session, item.file).open();
  }
}

class LogExerciseModal extends Modal {
  constructor(plugin, session, exercise, existingLog = null) {
    super(plugin.app);
    this.plugin = plugin;
    this.session = session;
    this.exercise = exercise;
    this.existingLog = existingLog;
    this.saving = false;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("workout-log-modal");
    const sessionFm = await this.plugin.readFrontmatter(this.session);
    const exerciseFm = await this.plugin.readFrontmatter(this.exercise);
    const existingFm = this.existingLog ? await this.plugin.readFrontmatter(this.existingLog) : null;
    const title = String(exerciseFm.title || this.exercise.basename);
    const location = linkLabel(sessionFm.location);
    const history = this.plugin
      .getLogsForExercise(this.exercise)
      .filter(({ file }) => file.path !== this.existingLog?.path);
    const isSameExercise = linkTarget(existingFm?.exercise) === this.exercise.path.slice(0, -3);
    const machine = (isSameExercise ? linkLabel(existingFm?.machine) : "")
      || this.plugin.machineFor(exerciseFm, title, location, history);
    contentEl.createEl("h2", { text: this.existingLog ? `Edit ${title}` : title });
    contentEl.createDiv({
      cls: "workout-log-context",
      text: `${existingFm?.date || sessionFm.date || localDate()} · ${location || "No location"} · ${machine}`,
    });

    renderHistory(contentEl, history, machine, location, 5);

    if (this.existingLog) {
      new Setting(contentEl)
        .setName("Exercise")
        .setDesc(title)
        .addButton((button) =>
          button.setButtonText("Change exercise").onClick(() => {
            new ExercisePicker(this.plugin, this.session, (item) => {
              this.close();
              new LogExerciseModal(this.plugin, this.session, item.file, this.existingLog).open();
            }).open();
          }),
        );
    }

    let machineValue = machine;
    let setsValue = String(existingFm?.sets_raw || existingFm?.sets || this.plugin.settings.defaultSets || 3);
    let repsValue = String(existingFm?.reps || "");
    let weightValue = String(existingFm?.weight || "");
    let notesValue = String(existingFm?.notes || "");

    new Setting(contentEl).setName("Machine profile").addText((text) => {
      text.setValue(machineValue).onChange((value) => (machineValue = value.trim()));
      const input = text.inputEl;
      const listId = `workout-machines-${Date.now()}`;
      input.setAttr("list", listId);
      const datalist = contentEl.createEl("datalist", { attr: { id: listId } });
      for (const known of this.plugin.getKnownMachines()) datalist.createEl("option", { attr: { value: known } });
    });
    new Setting(contentEl).setName("Sets").addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.inputMode = "numeric";
      text.setValue(setsValue).onChange((value) => (setsValue = value));
    });
    let repsInput;
    new Setting(contentEl).setName("Reps").setDesc("Example: 10, 9, 8").addText((text) => {
      repsInput = text.inputEl;
      repsInput.inputMode = "text";
      text.setValue(repsValue).onChange((value) => (repsValue = value));
    });
    let weightInput;
    new Setting(contentEl).setName("Weight").setDesc("Example: 155 lbs or 7 on machine").addText((text) => {
      weightInput = text.inputEl;
      text.setValue(weightValue).onChange((value) => (weightValue = value));
    });
    new Setting(contentEl).setName("Notes").addTextArea((text) => {
      text.setValue(notesValue).onChange((value) => (notesValue = value));
    });

    const actions = contentEl.createDiv({ cls: "workout-log-actions" });
    if (this.existingLog) {
      const remove = actions.createEl("button", { cls: "workout-log-delete", text: "Delete log" });
      remove.addEventListener("click", () => {
        new DeleteLogModal(
          this.plugin,
          this.existingLog,
          this.session,
          this.exercise,
          () => this.close(),
        ).open();
      });
    }
    const save = actions.createEl("button", {
      cls: "mod-cta",
      text: this.existingLog ? "Save changes" : "Save",
    });
    const saveNext = this.existingLog ? null : actions.createEl("button", { text: "Save + next" });
    const submit = async (next) => {
      if (this.saving) return;
      this.saving = true;
      save.disabled = true;
      if (saveNext) saveNext.disabled = true;
      try {
        const form = {
          location,
          machine: machineValue || AGNOSTIC,
          sets: setsValue,
          reps: repsValue,
          weight: weightValue,
          notes: notesValue,
        };
        if (this.existingLog) {
          await this.plugin.updateExerciseLog(this.existingLog, this.session, this.exercise, form);
        } else {
          await this.plugin.createExerciseLog(this.session, this.exercise, form);
        }
        this.close();
        if (next) new ExercisePicker(this.plugin, this.session).open();
      } catch (error) {
        console.error(error);
        new Notice(`Could not save workout log: ${error.message || error}`);
        this.saving = false;
        save.disabled = false;
        if (saveNext) saveNext.disabled = false;
      }
    };
    save.addEventListener("click", () => submit(false));
    saveNext?.addEventListener("click", () => submit(true));
    weightInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit(false);
    });
    window.setTimeout(() => repsInput?.focus(), 80);
  }
}

class DeleteLogModal extends Modal {
  constructor(plugin, file, session, exercise, onDeleted) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.session = session;
    this.exercise = exercise;
    this.onDeleted = onDeleted;
    this.deleting = false;
  }

  async onOpen() {
    const fm = await this.plugin.readFrontmatter(this.file);
    const title = linkLabel(fm.exercise) || this.exercise.basename;
    this.contentEl.addClass("workout-delete-modal");
    this.contentEl.createEl("h2", { text: `Delete ${title}?` });
    this.contentEl.createEl("p", {
      text: `This removes the ${fm.date || "selected"} log and recalculates the workout totals. The Markdown file will go to Obsidian's trash.`,
    });
    const actions = this.contentEl.createDiv({ cls: "workout-log-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    const confirm = actions.createEl("button", { cls: "mod-warning", text: "Delete log" });
    cancel.addEventListener("click", () => this.close());
    confirm.addEventListener("click", async () => {
      if (this.deleting) return;
      this.deleting = true;
      confirm.disabled = true;
      cancel.disabled = true;
      try {
        await this.plugin.deleteExerciseLog(this.file, this.session, this.exercise);
        this.close();
        this.onDeleted?.();
      } catch (error) {
        console.error(error);
        new Notice(`Could not delete workout log: ${error.message || error}`);
        this.deleting = false;
        confirm.disabled = false;
        cancel.disabled = false;
      }
    });
  }
}

function renderHistory(container, history, machine, location, limit) {
  const section = container.createDiv({ cls: "workout-history" });
  section.createEl("h3", { text: "Comparable history" });
  const same = history.filter(
    ({ frontmatter }) => linkLabel(frontmatter.machine) === machine,
  );
  const selected = same.length ? same.slice(0, limit) : history.slice(0, limit);
  if (!selected.length) {
    section.createDiv({ cls: "workout-history-empty", text: "No history for this exercise yet." });
    return;
  }
  if (!same.length) {
    section.createDiv({ cls: "workout-history-warning", text: "No exact machine match; showing recent records." });
  }
  for (const { frontmatter } of selected) {
    const row = section.createDiv({ cls: "workout-history-row" });
    row.createSpan({ cls: "workout-history-date", text: String(frontmatter.date || "—") });
    row.createSpan({
      cls: "workout-history-performance",
      text: `${frontmatter.sets_raw || frontmatter.sets || "—"} × ${frontmatter.reps || "—"} @ ${frontmatter.weight || "—"}`,
    });
    const rowLocation = linkLabel(frontmatter.location);
    if (rowLocation && rowLocation !== location) row.createSpan({ cls: "workout-history-location", text: rowLocation });
  }
}

class ExerciseHistoryModal extends Modal {
  constructor(plugin, exercise, location) {
    super(plugin.app);
    this.plugin = plugin;
    this.exercise = exercise;
    this.location = location;
  }

  async onOpen() {
    const fm = await this.plugin.readFrontmatter(this.exercise);
    const title = String(fm.title || this.exercise.basename);
    const history = this.plugin.getLogsForExercise(this.exercise);
    const machines = new Map();
    for (const item of history) {
      const machine = linkLabel(item.frontmatter.machine) || AGNOSTIC;
      if (!machines.has(machine)) machines.set(machine, []);
      machines.get(machine).push(item);
    }
    this.contentEl.addClass("workout-history-modal");
    this.contentEl.createEl("h2", { text: `${title} history` });
    this.contentEl.createDiv({
      cls: "workout-log-context",
      text: this.location ? `Current location: ${this.location}` : "Grouped by machine profile",
    });
    if (!history.length) {
      this.contentEl.createDiv({ cls: "workout-history-empty", text: "No logged history yet." });
      return;
    }
    for (const [machine, records] of machines) {
      const group = this.contentEl.createDiv({ cls: "workout-history-group" });
      group.createEl("h3", { text: machine });
      for (const { file, frontmatter } of records.slice(0, 12)) {
        const button = group.createEl("button", { cls: "workout-history-record" });
        button.createSpan({ text: String(frontmatter.date || "—") });
        button.createSpan({ text: `${frontmatter.reps || "—"} @ ${frontmatter.weight || "—"}` });
        button.createSpan({ text: linkLabel(frontmatter.location) || "" });
        button.addEventListener("click", () => {
          this.close();
          const session = this.plugin.fileFromLink(frontmatter.session);
          if (session) new LogExerciseModal(this.plugin, session, this.exercise, file).open();
          else this.plugin.openFile(file);
        });
      }
    }
  }
}

class NewLocationModal extends Modal {
  constructor(plugin, session, view) {
    super(plugin.app);
    this.plugin = plugin;
    this.session = session;
    this.view = view;
  }

  onOpen() {
    this.contentEl.createEl("h2", { text: "Add location" });
    let value = "";
    let input;
    new Setting(this.contentEl).setName("Location name").addText((text) => {
      input = text.inputEl;
      text.onChange((next) => (value = next.trim()));
    });
    const button = this.contentEl.createEl("button", { cls: "mod-cta", text: "Save location" });
    button.addEventListener("click", async () => {
      if (!value) return;
      await this.plugin.ensureReference(FOLDERS.locations, value, "workout-location");
      await this.app.fileManager.processFrontMatter(this.session, (fm) => {
        fm.location = this.plugin.locationLink(value);
      });
      this.plugin.settings.lastLocation = value;
      await this.plugin.saveSettings();
      this.close();
      this.view.render();
    });
    window.setTimeout(() => input?.focus(), 50);
  }
}

class WorkoutLoggerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Workout Logger" });
    new Setting(containerEl)
      .setName("Default session name")
      .setDesc("Used when one-tap start creates today's workout.")
      .addText((text) =>
        text.setValue(this.plugin.settings.defaultSessionName).onChange(async (value) => {
          this.plugin.settings.defaultSessionName = value.trim() || "Workout";
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("Default / last location")
      .setDesc("The Today view remembers changes automatically.")
      .addText((text) =>
        text.setValue(this.plugin.settings.lastLocation).onChange(async (value) => {
          this.plugin.settings.lastLocation = value.trim();
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("Default sets")
      .addText((text) => {
        text.inputEl.type = "number";
        text.setValue(String(this.plugin.settings.defaultSets)).onChange(async (value) => {
          this.plugin.settings.defaultSets = Math.max(1, Number(value) || 3);
          await this.plugin.saveSettings();
        });
      });
  }
}

WorkoutLoggerPlugin._test = {
  linkLabel,
  linkTarget,
  localDate,
  makeFrontmatter,
  makeExerciseLogBody,
  noteLink,
  parseReps,
  parseWeight,
  safeName,
};

module.exports = WorkoutLoggerPlugin;
