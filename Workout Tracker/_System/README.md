---
title: "Workout Logger setup"
record_type: "workout-system-guide"
tags: ["workout/system"]
---

# Workout Logger setup

This starter vault combines a mobile-safe Obsidian plugin with ordinary Markdown notes. Your sessions and exercise logs remain local files in the vault.

## Folder map

- `Sessions`: one note per workout session.
- `Exercise Logs`: one note per exercise performed in a session.
- `Exercises`: the searchable exercise library.
- `Muscle Groups` and `Equipment`: optional reference notes.
- `Locations` and `Machines`: created as you use them.
- `Views`: Obsidian Bases table/card definitions.
- `Templates`: optional manual note templates.

## First workout

1. Run **Workout Logger: Today**.
2. Set a location if useful.
3. Tap **Log exercise**.
4. Choose an exercise, enter sets/reps/weight, then use **Save + next**.

The plugin creates missing session, log, location, and machine folders automatically.

## Adding an exercise

Copy `Workout Tracker/Templates/New Exercise.md` into `Workout Tracker/Exercises`, then set its `title`. The note must retain `record_type: "exercise"` so it appears in the picker.

## Mobile

The vault includes a pull-down Quick Action and mobile toolbar commands for **Today** and **Log exercise**. Sync the whole vault, including `.obsidian`, with your private Git repository before opening it on your phone.

## Bases

The `.base` views require a recent Obsidian version with the Bases core plugin enabled. The logger itself writes ordinary Markdown and does not require a database.
