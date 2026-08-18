# Dashsidian

A customizable home dashboard for Obsidian — pin your favorite notes and folders as visual shortcut cards and open them with a single click.

## Screenshots

<img width="1846" height="1012" alt="image" src="https://github.com/user-attachments/assets/f43c3631-e5f4-43cd-bfea-ac37bbb695d7" />


## Features

- **Home dashboard** — opens automatically on Obsidian startup
- **Shortcut cards** — one-click access to notes and folders via pinnable cards
- **Real-time search** — type to filter shortcuts by name instantly
- **Custom title** — rename the Dashboard heading to anything in Settings
- **Header image** — set a banner image with configurable height
- **Card customization** — choose size (small/medium/large), orientation (vertical/horizontal), custom Lucide icons, and images
- **Image fill** — use a vault image as the card background
- **Drag-and-drop reordering** — arrange cards by dragging
- **Folder nesting** — drag a note card onto a folder card to group them; the folder card is collapsible
- **Custom CSS** — inline editor with live preview and file import support
- **Theme switcher** — toggle light/dark mode and select installed Obsidian themes

## Installation

### Community Plugin Directory

Once the plugin is listed in the Obsidian community directory (coming soon):

1. Open **Settings** then **Community plugins**
2. Disable **Restricted mode** if needed
3. Click **Browse** and search for "Dashsidian"
4. Install and enable the plugin

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/felipeverissimo/Dashsidian/releases/latest)
2. In your vault, create the folder `.obsidian/plugins/dashsidian/` if it does not exist — the folder name `dashsidian` must match exactly; it comes from the `manifest.json` id field
3. Copy the three downloaded files into that folder
4. Open **Settings** then **Community plugins**, find **Dashsidian** in the list, and enable it. After enabling, the home icon appears in the left ribbon.

## Usage

### Pinning shortcuts

Right-click any file or folder in the **File Explorer** and select **Pin to Dashboard**. To pin multiple items at once, Ctrl-click to select them before right-clicking.

### Opening the Dashboard

Click the **home icon** in the left ribbon, or open the command palette and run **Dashsidian: Open Dashboard**.

### Customizing cards

Right-click any card to change its size, switch orientation, set a custom Lucide icon, or use a vault image as the card icon or background. Drag cards to reorder them. Drag a note card onto a folder card to nest it inside; the folder card becomes collapsible.

### Settings

Open **Settings** then **Dashsidian** to change the Dashboard title, set or remove the header banner image, adjust header height, write or import custom CSS, and toggle whether the Dashboard opens automatically on Obsidian startup.

## License

MIT
