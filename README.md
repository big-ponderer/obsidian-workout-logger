# Workout Logger for Obsidian

A mobile-friendly workout logger that stores sessions and exercise history as ordinary Markdown notes.

This repository is a clean starter vault. It includes the `Workout Logger` plugin, an exercise library, templates, Bases views, and mobile toolbar defaults. It contains no personal workout history.

## Recommended setup: GitHub + Obsync on iOS

This is the simplest workflow for getting the starter vault onto an iPhone without putting personal workout data in this public repository.

1. Create a GitHub account if you do not already have one.
2. Open this repository on GitHub and select **Use this template**.
3. Create a new repository for yourself, choose a name, and set **Visibility** to **Private**. This private repository is your personal copy.
4. Download and install the **Obsidian** app and **Obsync** on your iPhone.
5. Open Obsync and link the GitHub account that owns your private copy. Select the private repository and sync it to your phone.
6. Open Obsidian and choose **Open folder as vault**. Select the folder that Obsync created for the private repository.
7. In Obsidian, open **Settings → Community plugins**, turn on community plugins if prompted, and enable **Workout Logger**.
8. Pull down from the top edge of the Obsidian screen. The configured **Workout Logger: Today** action should open the workout screen. If it does not, restart Obsidian after enabling the plugin and try again.

Never use this public repository as the live sync destination for workout data. Always sync your private copy.

## Alternative: desktop Git setup

If you prefer to configure the vault on a computer first, create the private copy on GitHub as described above, then clone it locally. You can also clone this starter vault directly and change its remote before recording anything:

```sh
git clone https://github.com/big-ponderer/obsidian-workout-logger.git MyWorkoutVault
cd MyWorkoutVault
```

Point the clone at your private repository and push it:

```sh
git remote set-url origin https://github.com/YOUR-USERNAME/YOUR-PRIVATE-REPO.git
git push -u origin main
```

Then open `MyWorkoutVault` in Obsidian, enable **Workout Logger**, and use your normal Git sync method for the phone.

You can also download the repository as a ZIP and open the extracted folder as a vault. If you plan to keep records, initialize or connect that copy to a private repository before logging.

## First workout

1. Run **Workout Logger: Today** from the command palette, or tap its mobile toolbar button.
2. Choose a location or leave it blank.
3. Tap **Log exercise** and search the exercise library.
4. Enter sets, reps, weight, and optional notes.
5. Use **Save + next** to continue through the workout.

Each session and exercise log is a Markdown file. The plugin automatically maintains links, totals, locations, machine profiles, and comparable history.

## Sync and use on mobile

For Obsync, pull the private repository before a workout and push it afterward. Make sure hidden files and the entire `.obsidian` folder are included. The included configuration preassigns **Workout Logger: Today** as the mobile pull-down Quick Action and adds **Today** and **Log exercise** to the mobile toolbar.

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
