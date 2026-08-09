# Workout Logger for Obsidian

A mobile-friendly workout logger that stores sessions and exercise history as ordinary Markdown notes.

This repository is a clean starter vault. It includes the `Workout Logger` plugin, an exercise library, templates, Bases views, and mobile toolbar defaults. It contains no personal workout history.

## Important: make your personal copy private

Do not commit your workout logs to this public repository. For Git-based syncing, create a private repository for your own copy first.

### Git setup

1. Create an empty private GitHub repository for your personal workout vault.
2. Clone this starter vault on your computer:

   ```sh
   git clone https://github.com/big-ponderer/obsidian-workout-logger.git MyWorkoutVault
   cd MyWorkoutVault
   ```

3. Point the clone at your private repository and push it:

   ```sh
   git remote set-url origin https://github.com/YOUR-USERNAME/YOUR-PRIVATE-REPO.git
   git push -u origin main
   ```

4. In Obsidian, choose **Open folder as vault** and select `MyWorkoutVault`.
5. Open **Settings → Community plugins**, turn on community plugins if prompted, and enable **Workout Logger**.

You can also download the repository as a ZIP and open the extracted folder as a vault. If you plan to keep records, initialize or connect that copy to a private repository before logging.

## First workout

1. Run **Workout Logger: Today** from the command palette, or tap its mobile toolbar button.
2. Choose a location or leave it blank.
3. Tap **Log exercise** and search the exercise library.
4. Enter sets, reps, weight, and optional notes.
5. Use **Save + next** to continue through the workout.

Each session and exercise log is a Markdown file. The plugin automatically maintains links, totals, locations, machine profiles, and comparable history.

## Git sync to mobile

This starter vault is designed for the workflow where the vault is configured on desktop and synced to a phone with Git:

1. Use your normal Git sync method, such as the Obsidian Git community plugin, on your private repository.
2. Make sure hidden files and the entire `.obsidian` folder are included.
3. Pull the private vault on the phone before a workout and push after logging.
4. Enable **Workout Logger** on the phone once if Obsidian does not activate it automatically.

The included configuration preassigns **Workout Logger: Today** as the mobile pull-down Quick Action and adds **Today** and **Log exercise** to the mobile toolbar.

## Adding exercises

Copy `Workout Tracker/Templates/New Exercise.md` into `Workout Tracker/Exercises`, set the exercise title, and keep `record_type: "exercise"`. Optional `equipment`, `muscle_groups`, and `machine_policy` properties improve the library and machine-history behavior.

## Updating the plugin

The plugin is embedded in `.obsidian/plugins/workout-logger`. To bring updates from this public starter repository into a private vault, add it as an upstream remote and copy the plugin files deliberately:

```sh
git remote add template https://github.com/big-ponderer/obsidian-workout-logger.git
git fetch template
git checkout template/main -- .obsidian/plugins/workout-logger
git commit -m "Update Workout Logger"
```

Reload or restart Obsidian after pulling a plugin update.

## Requirements

- Obsidian desktop and mobile.
- A recent Obsidian version is recommended for the included Bases views.
- Git is optional for desktop-only use, but required for the desktop-to-mobile workflow described above.

## Privacy and design

The plugin does not require an external service or database. It uses Obsidian's Vault, Metadata Cache, and File Manager APIs and writes Markdown inside the vault. Keep your personal Git repository private because workout notes, settings, and attachments are ordinary files.

## Repository layout

```text
.obsidian/
  plugins/workout-logger/   # bundled plugin
  snippets/                  # optional workout styling
Workout Tracker/
  Exercises/                 # starter exercise library
  Views/                     # Bases views
  Templates/                 # optional note templates
  Workout Dashboard.md
```
