import {
  App,
  FuzzySuggestModal,
  ItemView,
  Menu,
  Modal,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath,
  setIcon,
} from "obsidian";

const DASHBOARD_VIEW_TYPE = "dashboard-view";
const SNIPPET_ID = "dash-note-custom";
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|avif|bmp)$/i;

const DEFAULT_CSS = `/* ─── CSS customizado do Dashboard ───────────────────
   Edite aqui para personalizar a aparência.
   As alterações são aplicadas em tempo real.

   Classes disponíveis:
   .dashboard-container   → área principal
   .dashboard-header      → banner/capa
   .dashboard-title       → título "Dashboard"
   .dashboard-grid        → grade de cards
   .dashboard-card        → card individual
   .dashboard-card--folder → card de pasta
   .dashboard-card-icon   → ícone do card
   .dashboard-card-name   → nome do atalho
   .dashboard-card-path   → caminho abaixo do nome
──────────────────────────────────────────────────── */

`;

// Internal Obsidian APIs not exposed in public type definitions
interface ObsidianCustomCss {
  themes: string[];
  theme: string;
  setTheme: (theme: string) => void;
  setSnippetEnabled: (id: string, enable: boolean) => void;
  requestLoadSnippets?: () => Promise<void>;
}

interface ObsidianVaultInternal {
  setConfig: (key: string, value: string) => void;
}

interface ObsidianFileExplorerView {
  revealInFolder?: (file: TAbstractFile) => Promise<void>;
  fileItems?: Record<string, { setCollapsed: (collapsed: boolean) => void }>;
}

interface Shortcut {
  path: string;
  name: string;
  type: "file" | "folder";
  parentFolderPath?: string;
  cardSize?: "small" | "medium" | "large";
  cardOrientation?: "vertical" | "horizontal";
  customIcon?: string;
  customImage?: string;
  imageFill?: boolean;
}

interface DashboardSettings {
  shortcuts: Shortcut[];
  openOnStartup: boolean;
  headerImage: string;
  headerHeight: number;
  customCss: string;
  dashboardTitle: string;
  showTitle: boolean;
  showHeader: boolean;
  backgroundImage: string;
}

const DEFAULT_SETTINGS: DashboardSettings = {
  shortcuts: [],
  openOnStartup: true,
  headerImage: "",
  headerHeight: 220,
  customCss: DEFAULT_CSS,
  dashboardTitle: "Dashboard",
  showTitle: true,
  showHeader: true,
  backgroundImage: "",
};

// ─── Plugin ────────────────────────────────────────────────────────────────────

export default class DashboardPlugin extends Plugin {
  settings: DashboardSettings;

  async onload() {
    await this.loadSettings();
    await this.applyCustomCss();

    this.registerView(
      DASHBOARD_VIEW_TYPE,
      (leaf) => new DashboardView(leaf, this)
    );

    this.addRibbonIcon("home", "Abrir Dashboard", () => {
      void this.activateDashboard();
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Abrir Dashboard",
      callback: () => void this.activateDashboard(),
    });

    // Single file/folder context menu
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const alreadyAdded = this.settings.shortcuts.some(
          (s) => s.path === file.path
        );
        if (!alreadyAdded) {
          menu.addItem((item) => {
            item
              .setTitle("Fixar no Dashboard")
              .setIcon("pin")
              .onClick(() => void this.addShortcut(file));
          });
        } else {
          menu.addItem((item) => {
            item
              .setTitle("Remover do Dashboard")
              .setIcon("pin-off")
              .onClick(() => void this.removeShortcut(file.path));
          });
        }
      })
    );

    // Multi-file context menu (Ctrl+click several items, then right-click)
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu, files) => {
        const toAdd = files.filter(
          (f) => !this.settings.shortcuts.some((s) => s.path === f.path)
        );
        if (toAdd.length === 0) return;

        menu.addItem((item) => {
          item
            .setTitle(`Fixar ${toAdd.length} ${toAdd.length === 1 ? "item" : "itens"} no Dashboard`)
            .setIcon("pin")
            .onClick(() => {
              void (async () => {
                for (const file of toAdd) {
                  await this.addShortcut(file);
                }
              })();
            });
        });
      })
    );

    this.addSettingTab(new DashboardSettingTab(this.app, this));

    if (this.settings.openOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        void this.activateDashboard();
      });
    }
  }

  onunload() {
    void this.disableCustomCssSnippet();
  }

  async applyCustomCss() {
    const snippetsDir = normalizePath(`${this.app.vault.configDir}/snippets`);
    const snippetPath = normalizePath(`${snippetsDir}/${SNIPPET_ID}.css`);
    try {
      if (!await this.app.vault.adapter.exists(snippetsDir)) {
        await this.app.vault.adapter.mkdir(snippetsDir);
      }
      await this.app.vault.adapter.write(snippetPath, this.settings.customCss ?? "");
      const internalCss = (this.app as unknown as { customCss: ObsidianCustomCss }).customCss;
      if (internalCss) {
        internalCss.setSnippetEnabled(SNIPPET_ID, true);
        await internalCss.requestLoadSnippets?.();
      }
    } catch (e) {
      console.error("Dashboard plugin: failed to apply CSS snippet", e);
    }
  }

  private async disableCustomCssSnippet() {
    try {
      const internalCss = (this.app as unknown as { customCss: ObsidianCustomCss }).customCss;
      if (internalCss) {
        internalCss.setSnippetEnabled(SNIPPET_ID, false);
      }
    } catch {
      // ignore
    }
  }

  async activateDashboard() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(false);
      await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async addShortcut(file: TAbstractFile) {
    if (this.settings.shortcuts.some((s) => s.path === file.path)) return;
    this.settings.shortcuts.push({
      path: file.path,
      name: file.name.replace(/\.md$/, ""),
      type: file instanceof TFolder ? "folder" : "file",
    });
    await this.saveSettings();
    this.refreshDashboard();
  }

  async removeShortcut(path: string) {
    this.settings.shortcuts = this.settings.shortcuts.filter(
      (s) => s.path !== path
    );
    await this.saveSettings();
    this.refreshDashboard();
  }

  async updateShortcut(index: number, updates: Partial<Shortcut>) {
    const s = this.settings.shortcuts[index];
    Object.assign(s, updates);
    (Object.keys(updates) as Array<keyof Shortcut>).forEach((key) => {
      if (updates[key] === undefined) delete (s as unknown as Record<string, unknown>)[key];
    });
    await this.saveSettings();
    this.refreshDashboard();
  }

  async moveShortcut(fromIndex: number, toIndex: number) {
    const [moved] = this.settings.shortcuts.splice(fromIndex, 1);
    this.settings.shortcuts.splice(toIndex, 0, moved);
    await this.saveSettings();
    this.refreshDashboard();
  }

  async nestShortcut(fileIndex: number, folderPath: string) {
    this.settings.shortcuts[fileIndex].parentFolderPath = folderPath;
    await this.saveSettings();
    this.refreshDashboard();
  }

  async unnestShortcut(fileIndex: number) {
    this.settings.shortcuts[fileIndex].parentFolderPath = undefined;
    await this.saveSettings();
    this.refreshDashboard();
  }

  refreshDashboard() {
    this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof DashboardView) leaf.view.render();
    });
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData() as Partial<DashboardSettings>
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ─── Image Picker Modal ────────────────────────────────────────────────────────

class ImagePickerModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Buscar imagem no vault...");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => IMAGE_EXTENSIONS.test(f.name));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}

// ─── Icon Picker Modal ─────────────────────────────────────────────────────────

const COMMON_ICONS = [
  "star", "heart", "bookmark", "book", "file-text", "folder-open",
  "home", "brain", "pencil", "check-circle", "lightbulb", "target",
  "zap", "coffee", "music", "camera", "code", "globe", "mail",
  "calendar", "clock", "tag", "archive", "box", "layers", "award",
  "flag", "flame", "gem", "graduation-cap", "headphones", "leaf",
];

class IconPickerModal extends Modal {
  private onChoose: (icon: string) => void;
  private initial: string;

  constructor(app: App, initial: string, onChoose: (icon: string) => void) {
    super(app);
    this.initial = initial;
    this.onChoose = onChoose;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Escolher ícone", cls: "dashboard-icon-modal-title" });

    const preview = contentEl.createDiv("dashboard-icon-preview");
    if (this.initial) setIcon(preview, this.initial);

    const input = contentEl.createEl("input", { type: "text" });
    input.placeholder = "Nome do ícone Lucide (ex: star, book, brain…)";
    input.addClass("dashboard-icon-input");
    input.value = this.initial;
    input.addEventListener("input", () => {
      preview.empty();
      if (input.value) setIcon(preview, input.value);
    });

    contentEl.createEl("p", { text: "Ícones comuns:", cls: "dashboard-icon-label" });
    const grid = contentEl.createDiv("dashboard-icon-grid");
    COMMON_ICONS.forEach((name) => {
      const btn = grid.createDiv("dashboard-icon-btn");
      setIcon(btn, name);
      btn.setAttribute("aria-label", name);
      btn.addEventListener("click", () => {
        input.value = name;
        preview.empty();
        setIcon(preview, name);
      });
    });

    const confirmBtn = contentEl.createEl("button", {
      text: "Confirmar",
      cls: "mod-cta dashboard-icon-confirm",
    });
    confirmBtn.addEventListener("click", () => {
      const value = input.value.trim();
      if (value) {
        this.onChoose(value);
        this.close();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ─── Dashboard View ────────────────────────────────────────────────────────────

class DashboardView extends ItemView {
  plugin: DashboardPlugin;
  private dragSrcIndex: number | null = null;
  private collapsedFolders = new Set<string>();
  private searchQuery: string = "";

  constructor(leaf: WorkspaceLeaf, plugin: DashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return DASHBOARD_VIEW_TYPE; }
  getDisplayText(): string { return "Dashboard"; }
  getIcon(): string { return "home"; }

  async onOpen() { this.render(); }
  async onClose() {}

  render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("dashboard-container");

    const { backgroundImage } = this.plugin.settings;
    if (backgroundImage) {
      const bgFile = this.app.vault.getAbstractFileByPath(backgroundImage);
      if (bgFile instanceof TFile) {
        container.addClass("dashboard-container--has-background");
        container.setCssStyles({ backgroundImage: `url("${this.app.vault.getResourcePath(bgFile)}")` });
      } else {
        container.setCssStyles({ backgroundImage: "" });
      }
    } else {
      container.setCssStyles({ backgroundImage: "" });
    }

    if (this.plugin.settings.showHeader) {
      this.renderHeader(container);
    }

    const body = container.createDiv("dashboard-body");

    if (this.plugin.settings.shortcuts.length === 0) {
      this.renderEmpty(body);
    } else {
      const searchInput = body.createEl("input", { cls: "dashboard-search-input" });
      searchInput.type = "text";
      searchInput.placeholder = "Filtrar atalhos…";
      searchInput.value = this.searchQuery;
      searchInput.setAttribute("aria-label", "Filtrar atalhos por nome");
      searchInput.addEventListener("input", () => {
        this.searchQuery = searchInput.value;
        this.render();
        const newInput = this.containerEl.querySelector<HTMLInputElement>(".dashboard-search-input");
        if (newInput) {
          newInput.focus();
          const len = newInput.value.length;
          newInput.setSelectionRange(len, len);
        }
      });

      const grid = body.createDiv("dashboard-grid");
      const q = this.searchQuery.toLowerCase().trim();
      this.plugin.settings.shortcuts.forEach((shortcut, index) => {
        if (shortcut.parentFolderPath) return;
        if (q && !shortcut.name.toLowerCase().includes(q)) return;
        this.renderCard(grid, shortcut, index);
      });

      if (grid.children.length === 0) {
        grid.createEl("p", { text: "Nenhum atalho encontrado.", cls: "dashboard-empty-text" });
      }
    }
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  private renderHeader(container: HTMLElement) {
    const header = container.createDiv("dashboard-header");
    const { headerImage, headerHeight } = this.plugin.settings;
    header.setCssProps({ "--header-height": `${headerHeight}px` });

    if (headerImage) {
      const file = this.app.vault.getAbstractFileByPath(headerImage);
      if (file instanceof TFile) {
        const url = this.app.vault.getResourcePath(file);
        header.addClass("dashboard-header--has-image");
        header.setCssStyles({ backgroundImage: `url("${url}")` });
      }
    }

    const content = header.createDiv("dashboard-header-content");
    if (this.plugin.settings.showTitle) {
      content.createEl("h1", { text: this.plugin.settings.dashboardTitle || "Dashboard", cls: "dashboard-title" });
    }

    const controls = header.createDiv("dashboard-header-controls");

    const changeBtn = controls.createDiv("dashboard-header-btn");
    setIcon(changeBtn, "image");
    changeBtn.setAttribute("aria-label", "Alterar imagem de capa");
    changeBtn.addEventListener("click", () => {
      new ImagePickerModal(this.app, (file) => {
        void (async () => {
          this.plugin.settings.headerImage = file.path;
          await this.plugin.saveSettings();
          this.render();
        })();
      }).open();
    });

    if (headerImage) {
      const removeBtn = controls.createDiv(
        "dashboard-header-btn dashboard-header-btn--danger"
      );
      setIcon(removeBtn, "image-off");
      removeBtn.setAttribute("aria-label", "Remover imagem de capa");
      removeBtn.addEventListener("click", () => {
        void (async () => {
          this.plugin.settings.headerImage = "";
          await this.plugin.saveSettings();
          this.render();
        })();
      });
    }
  }

  // ── Empty ──────────────────────────────────────────────────────────────────

  private renderEmpty(container: HTMLElement) {
    const empty = container.createDiv("dashboard-empty");
    setIcon(empty.createDiv("dashboard-empty-icon"), "pin");
    empty.createEl("p", {
      text: 'Clique com botão direito em arquivos ou pastas no explorador e selecione "Fixar no Dashboard". Para adicionar vários de uma vez, selecione múltiplos itens com Ctrl+clique antes de clicar com botão direito.',
      cls: "dashboard-empty-text",
    });
  }

  // ── Cards ──────────────────────────────────────────────────────────────────

  private renderCardIcon(el: HTMLElement, shortcut: Shortcut) {
    if (shortcut.imageFill) return;
    if (shortcut.customImage) {
      const imageFile = this.app.vault.getAbstractFileByPath(shortcut.customImage);
      if (imageFile instanceof TFile) {
        const img = el.createEl("img");
        img.src = this.app.vault.getResourcePath(imageFile);
        img.alt = shortcut.name;
        return;
      }
    }
    setIcon(el, shortcut.customIcon || (shortcut.type === "folder" ? "folder-open" : "file-text"));
  }

  private openCardContextMenu(e: MouseEvent, shortcut: Shortcut, index: number) {
    const menu = new Menu();

    const size = shortcut.cardSize ?? "medium";
    menu.addItem((item) => item.setTitle("Pequeno").setChecked(size === "small")
      .onClick(() => void this.plugin.updateShortcut(index, { cardSize: "small" })));
    menu.addItem((item) => item.setTitle("Médio").setChecked(size === "medium")
      .onClick(() => void this.plugin.updateShortcut(index, { cardSize: "medium" })));
    menu.addItem((item) => item.setTitle("Grande").setChecked(size === "large")
      .onClick(() => void this.plugin.updateShortcut(index, { cardSize: "large" })));

    menu.addSeparator();

    const orientation = shortcut.cardOrientation ?? "vertical";
    menu.addItem((item) => item.setTitle("Vertical").setChecked(orientation === "vertical")
      .onClick(() => void this.plugin.updateShortcut(index, { cardOrientation: "vertical" })));
    menu.addItem((item) => item.setTitle("Horizontal").setChecked(orientation === "horizontal")
      .onClick(() => void this.plugin.updateShortcut(index, { cardOrientation: "horizontal" })));

    menu.addSeparator();

    menu.addItem((item) => item
      .setTitle("Alterar ícone…")
      .setIcon("smile")
      .onClick(() => new IconPickerModal(this.app, shortcut.customIcon ?? "", (icon) => {
        void this.plugin.updateShortcut(index, { customIcon: icon, customImage: undefined });
      }).open()));
    menu.addItem((item) => item
      .setTitle("Usar imagem…")
      .setIcon("image")
      .onClick(() => new ImagePickerModal(this.app, (file) => {
        void this.plugin.updateShortcut(index, { customImage: file.path, customIcon: undefined, imageFill: true });
      }).open()));
    if (shortcut.customImage) {
      menu.addItem((item) => item
        .setTitle(shortcut.imageFill ? "Mostrar como ícone" : "Preencher card com imagem")
        .setIcon(shortcut.imageFill ? "shrink" : "expand")
        .setChecked(!!shortcut.imageFill)
        .onClick(() => void this.plugin.updateShortcut(index, { imageFill: !shortcut.imageFill })));
    }
    if (shortcut.customIcon || shortcut.customImage) {
      menu.addItem((item) => item
        .setTitle("Resetar ícone padrão")
        .setIcon("refresh-cw")
        .onClick(() => void this.plugin.updateShortcut(index, { customIcon: undefined, customImage: undefined, imageFill: undefined })));
    }

    menu.addSeparator();

    menu.addItem((item) => item
      .setTitle("Remover do Dashboard")
      .setIcon("pin-off")
      .onClick(() => void this.plugin.removeShortcut(shortcut.path)));

    menu.showAtMouseEvent(e);
  }

  private renderCard(container: HTMLElement, shortcut: Shortcut, index: number) {
    const card = container.createDiv("dashboard-card");
    if (shortcut.type === "folder") card.addClass("dashboard-card--folder");
    if (shortcut.cardSize === "small") card.addClass("dashboard-card--size-small");
    else if (shortcut.cardSize === "large") card.addClass("dashboard-card--size-large");
    if (shortcut.cardOrientation === "horizontal") card.addClass("dashboard-card--horizontal");
    card.setAttribute("draggable", "true");
    card.dataset.index = String(index);

    if (shortcut.imageFill && shortcut.customImage) {
      const imgFile = this.app.vault.getAbstractFileByPath(shortcut.customImage);
      if (imgFile instanceof TFile) {
        card.addClass("dashboard-card--image-fill");
        card.setCssStyles({ backgroundImage: `url("${this.app.vault.getResourcePath(imgFile)}")` });
      }
    }

    const iconEl = card.createDiv("dashboard-card-icon");
    this.renderCardIcon(iconEl, shortcut);

    const info = card.createDiv("dashboard-card-info");
    info.createSpan({ text: shortcut.name, cls: "dashboard-card-name" });
    info.createSpan({ text: shortcut.path, cls: "dashboard-card-path" });

    const removeBtn = card.createDiv("dashboard-card-remove");
    setIcon(removeBtn, "pin-off");
    removeBtn.setAttribute("aria-label", "Remover do Dashboard");
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.plugin.removeShortcut(shortcut.path);
    });

    card.addEventListener("click", () => void this.openShortcut(shortcut));
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openCardContextMenu(e, shortcut, index);
    });

    card.addEventListener("dragstart", (e) => {
      this.dragSrcIndex = index;
      card.addClass("dashboard-card--dragging");
      e.dataTransfer?.setData("text/plain", String(index));
    });
    card.addEventListener("dragend", () =>
      card.removeClass("dashboard-card--dragging")
    );
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.addClass("dashboard-card--dragover");
    });
    card.addEventListener("dragleave", () =>
      card.removeClass("dashboard-card--dragover")
    );
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.removeClass("dashboard-card--dragover");
      if (this.dragSrcIndex !== null && this.dragSrcIndex !== index) {
        const dragged = this.plugin.settings.shortcuts[this.dragSrcIndex];
        if (
          shortcut.type === "folder" &&
          dragged.type === "file" &&
          dragged.path.startsWith(shortcut.path + "/")
        ) {
          void this.plugin.nestShortcut(this.dragSrcIndex, shortcut.path);
        } else {
          void this.plugin.moveShortcut(this.dragSrcIndex, index);
        }
      }
      this.dragSrcIndex = null;
    });

    if (shortcut.type === "folder") {
      const nested = this.plugin.settings.shortcuts
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.parentFolderPath === shortcut.path);

      if (nested.length > 0) {
        const isCollapsed = this.collapsedFolders.has(shortcut.path);

        const nestedHeader = card.createDiv("dashboard-card-nested-header");
        const chevronEl = nestedHeader.createDiv("dashboard-card-nested-chevron");
        setIcon(chevronEl, isCollapsed ? "chevron-right" : "chevron-down");
        nestedHeader.setAttribute("aria-label", isCollapsed ? "Expandir" : "Recolher");
        nestedHeader.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.collapsedFolders.has(shortcut.path)) {
            this.collapsedFolders.delete(shortcut.path);
          } else {
            this.collapsedFolders.add(shortcut.path);
          }
          this.render();
        });

        if (!isCollapsed) {
          const nestedContainer = card.createDiv("dashboard-card-nested");
          nested.forEach(({ s, i }) => this.renderNestedItem(nestedContainer, s, i));
        }
      }
    }
  }

  private renderNestedItem(container: HTMLElement, shortcut: Shortcut, index: number) {
    const item = container.createDiv("dashboard-card-nested-item");

    const iconEl = item.createDiv("dashboard-card-nested-icon");
    setIcon(iconEl, "file-text");

    const nameEl = item.createSpan({ text: shortcut.name, cls: "dashboard-card-nested-name" });
    nameEl.title = shortcut.name;

    const detachBtn = item.createDiv("dashboard-card-nested-detach");
    setIcon(detachBtn, "x");
    detachBtn.setAttribute("aria-label", "Soltar da pasta");
    detachBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.plugin.unnestShortcut(index);
    });

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.openShortcut(shortcut);
    });
  }

  private async openShortcut(shortcut: Shortcut) {
    if (shortcut.type === "file") {
      const file = this.app.vault.getAbstractFileByPath(shortcut.path);
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(file);
      }
      return;
    }

    const explorerLeaves = this.app.workspace.getLeavesOfType("file-explorer");
    if (explorerLeaves.length === 0) return;
    const explorerLeaf = explorerLeaves[0];
    await this.app.workspace.revealLeaf(explorerLeaf);

    const folder = this.app.vault.getAbstractFileByPath(shortcut.path);
    if (!folder) return;

    const view = explorerLeaf.view as unknown as ObsidianFileExplorerView;
    if (typeof view.revealInFolder === "function") {
      await view.revealInFolder(folder);
    }
    const fileItem = view.fileItems?.[shortcut.path];
    if (fileItem && typeof fileItem.setCollapsed === "function") {
      fileItem.setCollapsed(false);
    }
  }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class DashboardSettingTab extends PluginSettingTab {
  plugin: DashboardPlugin;

  constructor(app: App, plugin: DashboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl, plugin } = this;
    const { settings } = plugin;
    containerEl.empty();

    // ── Geral ────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Geral" });

    new Setting(containerEl)
      .setName("Título do Dashboard")
      .setDesc("Texto exibido como título no painel principal.")
      .addText((text) =>
        text
          .setPlaceholder("Dashboard")
          .setValue(settings.dashboardTitle)
          .onChange(async (value) => {
            settings.dashboardTitle = value;
            await plugin.saveSettings();
            plugin.refreshDashboard();
          })
      );

    new Setting(containerEl)
      .setName("Mostrar título")
      .setDesc("Exibir o título na área do cabeçalho.")
      .addToggle((toggle) =>
        toggle.setValue(settings.showTitle).onChange(async (value) => {
          settings.showTitle = value;
          await plugin.saveSettings();
          plugin.refreshDashboard();
        })
      );

    new Setting(containerEl)
      .setName("Mostrar cabeçalho")
      .setDesc("Exibir a área de cabeçalho. Ao desativar, o título e a imagem de capa ficam ocultos.")
      .addToggle((toggle) =>
        toggle.setValue(settings.showHeader).onChange(async (value) => {
          settings.showHeader = value;
          await plugin.saveSettings();
          plugin.refreshDashboard();
        })
      );

    new Setting(containerEl)
      .setName("Abrir ao iniciar")
      .setDesc("Abrir o Dashboard automaticamente quando o app iniciar.")
      .addToggle((toggle) =>
        toggle.setValue(settings.openOnStartup).onChange(async (value) => {
          settings.openOnStartup = value;
          await plugin.saveSettings();
        })
      );

    // ── Imagem de capa ───────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Imagem de capa" });

    new Setting(containerEl)
      .setName("Imagem")
      .setDesc(settings.headerImage || "Nenhuma imagem definida.")
      .addText((text) =>
        text
          .setPlaceholder("Caminho da imagem no vault")
          .setValue(settings.headerImage)
          .onChange(async (value) => {
            settings.headerImage = value;
            await plugin.saveSettings();
            plugin.refreshDashboard();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Buscar").setIcon("search").onClick(() => {
          new ImagePickerModal(this.app, async (file) => {
            settings.headerImage = file.path;
            await plugin.saveSettings();
            plugin.refreshDashboard();
            this.display();
          }).open();
        })
      );

    new Setting(containerEl)
      .setName("Altura da capa (px)")
      .addSlider((slider) =>
        slider
          .setLimits(120, 500, 10)
          .setValue(settings.headerHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            settings.headerHeight = value;
            await plugin.saveSettings();
            plugin.refreshDashboard();
          })
      );

    // ── Imagem de fundo ──────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Imagem de fundo" });

    new Setting(containerEl)
      .setName("Imagem de fundo do dashboard")
      .setDesc(settings.backgroundImage || "Nenhuma imagem definida. A imagem cobre toda a área do dashboard.")
      .addText((text) =>
        text
          .setPlaceholder("Caminho da imagem no vault")
          .setValue(settings.backgroundImage)
          .onChange(async (value) => {
            settings.backgroundImage = value;
            await plugin.saveSettings();
            plugin.refreshDashboard();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Buscar").setIcon("search").onClick(() => {
          new ImagePickerModal(this.app, async (file) => {
            settings.backgroundImage = file.path;
            await plugin.saveSettings();
            plugin.refreshDashboard();
            this.display();
          }).open();
        })
      );

    // ── CSS customizado ──────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "CSS customizado" });

    new Setting(containerEl)
      .setName("CSS personalizado")
      .setDesc("Edite aqui as customizações de aparência. As mudanças são aplicadas em tempo real.");

    const textarea = containerEl.createEl("textarea");
    textarea.rows = 18;
    textarea.style.width = "100%";
    textarea.style.fontFamily = "monospace";
    textarea.value = settings.customCss;
    textarea.addEventListener("input", () => {
      void (async () => {
        settings.customCss = textarea.value;
        await plugin.saveSettings();
        await plugin.applyCustomCss();
      })();
    });

    new Setting(containerEl)
      .setName("Importar arquivo .css")
      .setDesc("Carrega um arquivo .css do computador e substitui o CSS atual.")
      .addButton((btn) =>
        btn.setButtonText("Carregar arquivo").setIcon("upload").onClick(() => {
          const input = createEl("input");
          input.type = "file";
          input.accept = ".css";
          input.addEventListener("change", () => {
            void (async () => {
              const file = input.files?.[0];
              if (!file) return;
              settings.customCss = await file.text();
              await plugin.saveSettings();
              await plugin.applyCustomCss();
              this.display();
            })();
          });
          input.click();
        })
      );

    new Setting(containerEl)
      .setName("Resetar CSS")
      .setDesc("Remove todas as customizações e volta ao CSS padrão.")
      .addButton((btn) =>
        btn
          .setButtonText("Resetar para o padrão")
          .setClass("mod-warning")
          .onClick(() => {
            void (async () => {
              settings.customCss = DEFAULT_CSS;
              await plugin.saveSettings();
              await plugin.applyCustomCss();
              this.display();
            })();
          })
      );

    // ── Temas ────────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Temas" });

    const isDark = document.body.classList.contains("theme-dark");
    new Setting(containerEl)
      .setName("Modo de cor")
      .setDesc("Alternar entre claro e escuro.")
      .addButton((btn) => {
        btn.setButtonText("☀️ Claro");
        if (!isDark) btn.setCta();
        btn.onClick(() => { this.setColorScheme("moonstone"); this.display(); });
      })
      .addButton((btn) => {
        btn.setButtonText("🌙 Escuro");
        if (isDark) btn.setCta();
        btn.onClick(() => { this.setColorScheme("obsidian"); this.display(); });
      });

    const obsidianCustomCss = (this.app as unknown as { customCss: ObsidianCustomCss }).customCss;
    if (obsidianCustomCss) {
      const themes: string[] = obsidianCustomCss.themes ?? [];
      const current: string = obsidianCustomCss.theme ?? "";
      const themesSetting = new Setting(containerEl).setName("Tema visual");
      if (themes.length === 0) {
        themesSetting.setDesc("Nenhum tema instalado. Vá em Configurações → Aparência → Temas.");
      } else {
        themesSetting
          .setDesc(`Ativo: ${current || "Padrão"}`)
          .addDropdown((dd) => {
            dd.addOption("", "Padrão");
            themes.forEach((t) => { dd.addOption(t, t); });
            dd.setValue(current);
            dd.onChange((v) => {
              if (typeof obsidianCustomCss.setTheme === "function") obsidianCustomCss.setTheme(v);
            });
          });
      }
    }

    // ── Atalhos fixados ──────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Atalhos fixados" });

    if (settings.shortcuts.length === 0) {
      containerEl.createEl("p", {
        text: "Nenhum atalho adicionado ainda. Use o botão direito no explorador de arquivos.",
        cls: "setting-item-description",
      });
    } else {
      settings.shortcuts.forEach((s) => {
        new Setting(containerEl)
          .setName(s.name)
          .setDesc(`${s.type === "folder" ? "📁" : "📄"} ${s.path}`)
          .addButton((btn) =>
            btn
              .setIcon("trash")
              .setClass("mod-warning")
              .onClick(() => {
                void plugin.removeShortcut(s.path).then(() => this.display());
              })
          );
      });
    }
  }

  private setColorScheme(scheme: "moonstone" | "obsidian") {
    const vault = this.app.vault as unknown as ObsidianVaultInternal;
    if (typeof vault.setConfig === "function") vault.setConfig("theme", scheme);
    document.body.removeClass("theme-dark", "theme-light");
    document.body.addClass(scheme === "obsidian" ? "theme-dark" : "theme-light");
  }
}
