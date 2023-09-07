import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppIcon, ShowAppsIcon} from './appIcon.js';
import * as Enums from './enums.js';
import {NotificationsMonitor} from './notificationsMonitor.js';
import {Panel} from './panel.js';
import * as Utils from './utils.js';
import {TaskbarManager} from './taskbarManager.js';
import * as Theming from './theming.js';
import * as UnityLauncherAPI from './unityLauncherAPI.js';
import {WindowPreviewMenuManager} from './windowPreview.js';

const Signals = imports.signals;

function getDropTarget(box, x) {
    const visibleItems = box.get_children();
    for (const item of visibleItems) {
        const childBox = item.allocation.copy();
        childBox.set_origin(childBox.x1 % box.width, childBox.y1);
        if (x < childBox.x1 || x > childBox.x2)
            continue;

        return {item, index: visibleItems.indexOf(item)};
    }

    return {item: null, index: -1};
}

var AppDisplayBox = GObject.registerClass(
class azTaskbarAppDisplayBox extends St.ScrollView {
    _init(monitor) {
        super._init({
            style_class: 'hfade',
            enable_mouse_scrolling: false,
        });
        this.set_policy(St.PolicyType.EXTERNAL, St.PolicyType.NEVER);
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        this.clip_to_allocation = true;

        this._settings = TaskbarManager.settings;

        this._monitor = monitor;
        this.showAppsIcon = new ShowAppsIcon(this._settings);
        this._workId = Main.initializeDeferredWork(this, this._redisplay.bind(this));

        this.menuManager = new WindowPreviewMenuManager(this);

        this._appSystem = Shell.AppSystem.get_default();
        this.appIconsCache = new Map();
        this.peekInitialWorkspaceIndex = -1;

        this.mainBox = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this.mainBox._delegate = this;
        this.mainBox.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        this.add_actor(this.mainBox);

        this._setConnections();
        // If appDisplayBox position is moved in the main panel, updateIconGeometry
        this.connect('notify::position', () => this._updateIconGeometry());
        this.connect('destroy', () => this._destroy());
        this._connectWorkspaceSignals();
    }

    _setConnections() {
        this._disconnectWorkspaceSignals();
        this._clearConnections();
        this._connections = new Map();

        this._connections.set(this._settings.connect('changed::isolate-workspaces',
            () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::show-running-apps',
            () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::favorites',
            () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::show-apps-button',
            () => this._queueRedisplay()), this._settings);
        this._connections.set(AppFavorites.getAppFavorites().connect('changed',
            () => this._queueRedisplay()), AppFavorites.getAppFavorites());
        this._connections.set(this._appSystem.connect('app-state-changed',
            () => this._queueRedisplay()), this._appSystem);
        this._connections.set(this._appSystem.connect('installed-changed', () => {
            AppFavorites.getAppFavorites().reload();
            this._queueRedisplay();
        }), this._appSystem);
        this._connections.set(global.window_manager.connect('switch-workspace', () => {
            this._connectWorkspaceSignals();
            this._queueRedisplay();
        }), global.window_manager);
        this._connections.set(global.display.connect('window-entered-monitor',
            this._queueRedisplay.bind(this)), global.display);
        this._connections.set(global.display.connect('window-left-monitor',
            this._queueRedisplay.bind(this)), global.display);
        this._connections.set(global.display.connect('restacked',
            this._queueRedisplay.bind(this)), global.display);
        this._connections.set(Main.layoutManager.connect('startup-complete',
            this._queueRedisplay.bind(this)), Main.layoutManager);
    }

    _clearConnections() {
        if (!this._connections)
            return;

        this._connections.forEach((object, id) => {
            object.disconnect(id);
            id = null;
        });

        this._connections = null;
    }

    _createAppItem(newApp, monitorIndex, positionIndex) {
        const {isFavorite} = newApp;
        const {app} = newApp;
        const appID = `${app.get_id()} - ${monitorIndex}`;

        const item = this.appIconsCache.get(appID);

        // If a favorited app is running when extension starts,
        // the corresponding AppIcon may initially be created with isFavorite = false.
        // Check if isFavorite changed, and create new AppIcon if true.
        const favoriteChanged = item && item.isFavorite !== isFavorite;

        if (item && !favoriteChanged) {
            item.isSet = true;
            return item;
        } else if (item && favoriteChanged) {
            this.appIconsCache.delete(appID);
            item.destroy();
        }

        const appIcon = new AppIcon(this, app, monitorIndex, positionIndex, isFavorite);
        appIcon.isSet = true;
        this.appIconsCache.set(appID, appIcon);
        return appIcon;
    }

    handleDragOver(source, actor, x, _y, _time) {
        const dropTarget = getDropTarget(this.mainBox, x);
        const dropTargetItem = dropTarget.item;
        const {index} = dropTarget;

        if (!dropTargetItem)
            return DND.DragMotionResult.NO_DROP;

        source.dragMonitorIndex = dropTargetItem.monitorIndex ?? -1;
        source.dragPos = index;
        const inFavoriteRange = source.dragPos >= (source.firstFavIndex - 1) &&
                                source.dragPos <= source.lastFavIndex;

        const id = source.app.get_id();
        const favorites = AppFavorites.getAppFavorites().getFavoriteMap();
        let noDrop = id in favorites;

        if (source.app.is_window_backed() || !global.settings.is_writable('favorite-apps'))
            noDrop = true;

        if (dropTargetItem instanceof AppIcon && dropTargetItem !== source) {
            if (inFavoriteRange && noDrop && !source.isFavorite)
                return DND.DragMotionResult.NO_DROP;

            // 1. If drop target location not on same monitor as source, but in fav range.
            // 2. else if source has been moved to favorite range from different monitor,
            // return to last location.
            if (!source.isFavorite && inFavoriteRange) {
                if (!source.lastPositionIndex)
                    source.lastPositionIndex = this.mainBox.get_children().indexOf(source);
                this.mainBox.remove_child(source);
                this.mainBox.insert_child_at_index(source, index);
            } else if (dropTargetItem.monitorIndex !== source.monitorIndex &&
                    !inFavoriteRange && source.lastPositionIndex) {
                this.mainBox.remove_child(source);
                this.mainBox.insert_child_at_index(source, source.lastPositionIndex);
                source.lastPositionIndex = null;
            } else if (dropTargetItem.monitorIndex === source.monitorIndex) {
                this.mainBox.remove_child(source);
                this.mainBox.insert_child_at_index(source, index);
            }
        }

        if (inFavoriteRange)
            source.add_style_class_name('azTaskbar-favorite');
        else
            source.remove_style_class_name('azTaskbar-favorite');

        if (source.isFavorite || !inFavoriteRange)
            return DND.DragMotionResult.NO_DROP;

        return DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, x, _y, _time) {
        const dropTarget = getDropTarget(this.mainBox, x);
        const dropTargetItem = dropTarget.item;

        const id = source.app.get_id();
        const favorites = AppFavorites.getAppFavorites().getFavoriteMap();
        const srcIsFavorite = id in favorites;
        const favPos = source.dragPos - source.firstFavIndex;
        const inFavoriteRange = source.dragPos >= (source.firstFavIndex - 1) &&
                                source.dragPos <= source.lastFavIndex;

        if (!srcIsFavorite && dropTargetItem.monitorIndex !== source.monitorIndex && !inFavoriteRange)
            return false;

        source.positionIndex = source.dragPos;

        if (source.isFavorite) {
            if (source.dragPos > source.lastFavIndex || source.dragPos < source.firstFavIndex - 1)
                AppFavorites.getAppFavorites().removeFavorite(id);
            else
                AppFavorites.getAppFavorites().moveFavoriteToPos(id, favPos);
        } else if (inFavoriteRange) {
            if (srcIsFavorite)
                AppFavorites.getAppFavorites().moveFavoriteToPos(id, favPos);
            else
                AppFavorites.getAppFavorites().addFavoriteAtPos(id, favPos);
        }

        return true;
    }

    /**
     * this._appSystem.get_running() is slow to update
     * use this function from Dash to Panel instead,
     */
    _getRunningApps() {
        const tracker = Shell.WindowTracker.get_default();
        const windows = global.get_window_actors();
        const apps = [];

        for (let i = 0, l = windows.length; i < l; ++i) {
            const app = tracker.get_window_app(windows[i].metaWindow);

            if (app && apps.indexOf(app) < 0)
                apps.push(app);
        }

        return apps;
    }

    _queueRedisplay() {
        Main.queueDeferredWork(this._workId);
    }

    _sortMonitors() {
        const sortedMonitors = [...Main.layoutManager.monitors];
        sortedMonitors.sort((a, b) => {
            return a.x > b.x;
        });
        return sortedMonitors;
    }

    _redisplay() {
        let appIconsOnTaskbar = [];

        this.mainBox.get_children().forEach(actor => {
            if (actor instanceof AppIcon) {
                actor.isSet = false;
                appIconsOnTaskbar.push({
                    monitorIndex: actor.monitorIndex,
                    app: actor.app,
                });
            } else if (actor instanceof ShowAppsIcon) {
                this.mainBox.remove_child(actor);
            } else {
                this.mainBox.remove_child(actor);
                actor.destroy();
            }
        });

        const isolateMonitors = this._settings.get_boolean('isolate-monitors');
        const panelsOnAllMonitors = this._settings.get_boolean('panel-on-all-monitors');
        const monitorsCount = isolateMonitors &&
                              !panelsOnAllMonitors ? Main.layoutManager.monitors.length : 1;
        const sortedMonitors = this._sortMonitors();
        const showRunningApps = this._settings.get_boolean('show-running-apps');

        let positionIndex = 0;

        for (let i = 0; i < monitorsCount; i++) {
            const monitorIndex = panelsOnAllMonitors ? this._monitor.index : sortedMonitors[i].index;

            // Filter out any AppIcons that have moved to a different monitor
            appIconsOnTaskbar = appIconsOnTaskbar.filter(appIcon => {
                return appIcon.monitorIndex === monitorIndex;
            });

            const appFavorites = AppFavorites.getAppFavorites();
            const favorites = appFavorites.getFavoriteMap();

            let showFavorites;
            if (!this._settings.get_boolean('favorites'))
                showFavorites = false;
            else if (panelsOnAllMonitors)
                showFavorites = monitorIndex === Main.layoutManager.primaryIndex;
            else
                showFavorites = isolateMonitors ? i === 0 : true;

            const runningApps = showRunningApps ? this._getRunningApps() : [];
            const filteredRunningApps = runningApps.filter(app =>
                Utils.getInterestingWindows(this._settings, app.get_windows(), monitorIndex).length);

            // The list of AppIcons to be shown on the taskbar.
            const appIconsList = [];

            if (showFavorites) {
                const favsArray = appFavorites.getFavorites();
                for (let j = 0; j < favsArray.length; j++) {
                    appIconsList.push({
                        app: favsArray[j],
                        isFavorite: true,
                    });
                }
            }

            // To preserve the order of AppIcons already on the taskbar,
            // remove any AppIcons already on the taskbar from filteredRunningApps list,
            // and then push to appIconsList.
            appIconsOnTaskbar.forEach(appIcon => {
                const {app} = appIcon;
                const index = filteredRunningApps.indexOf(app);

                // if AppIcon not found in filteredRunningApps apps list,
                // check if entry exists in this.appIconsCache
                // if it does, it's no longer needed - destroy it
                if (index > -1) {
                    const [runningApp] = filteredRunningApps.splice(index, 1);
                    if (!showFavorites || !(runningApp.get_id() in favorites)) {
                        appIconsList.push({
                            app: runningApp,
                            isFavorite: false,
                        });
                    }
                } else if (!showFavorites || !(app.get_id() in favorites)) {
                    const appID = `${app.get_id()} - ${monitorIndex}`;
                    const item = this.appIconsCache.get(appID);
                    if (item) {
                        this.appIconsCache.delete(appID);
                        item.destroy();
                    }
                }
            });

            // Add any remaining running apps to appIconsList
            filteredRunningApps.forEach(app => {
                if (!showFavorites || !(app.get_id() in favorites)) {
                    appIconsList.push({
                        app,
                        isFavorite: false,
                    });
                }
            });

            for (let j = 0; j < appIconsList.length; j++) {
                const appIcon = appIconsList[j];
                const item = this._createAppItem(appIcon, monitorIndex, positionIndex);
                const parent = item.get_parent();

                if (parent && item.positionIndex !== positionIndex) {
                    item.positionIndex = positionIndex;
                    item.stopAllAnimations();
                    this.mainBox.remove_child(item);
                    this.mainBox.insert_child_at_index(item, positionIndex);
                    item.undoDragFade();
                    if (item.opacity !== 255)
                        item.animateIn();
                } else if (!parent) {
                    item.opacity = 0;
                    this.mainBox.insert_child_at_index(item, positionIndex);
                    item.animateIn();
                }

                positionIndex++;
            }
        }

        this.appIconsCache.forEach((appIcon, appID) => {
            if (appIcon.isSet) {
                appIcon.updateAppIcon();
            } else {
                this.appIconsCache.delete(appID);
                appIcon.destroy();
            }
        });

        const children = this.mainBox.get_children();
        let insertedSeparators = 0;
        for (let i = 1; i < children.length; i++) {
            const appIcon = children[i];
            const previousAppIcon = children[i - 1];
            // if the previous AppIcon has different monitorIndex, add a separator.
            if (previousAppIcon && appIcon.monitorIndex !== previousAppIcon.monitorIndex) {
                const separator = new St.Widget({
                    style_class: 'azTaskbar-Separator',
                    x_align: Clutter.ActorAlign.FILL,
                    y_align: Clutter.ActorAlign.CENTER,
                    width: 1,
                    height: 15,
                });
                this.mainBox.insert_child_at_index(separator, i + insertedSeparators);
                insertedSeparators += 1;
            }
        }

        const [showAppsButton, showAppsButtonPosition] =
            this._settings.get_value('show-apps-button').deep_unpack();

        if (showAppsButton) {
            if (showAppsButtonPosition === Enums.ShowAppsButtonPosition.LEFT)
                this.mainBox.insert_child_at_index(this.showAppsIcon, 0);
            else
                this.mainBox.add_child(this.showAppsIcon);
            this.showAppsIcon.updateIcon();
        }

        this.mainBox.queue_relayout();
    }

    _connectWorkspaceSignals() {
        const currentWorkspace = global.workspace_manager.get_active_workspace();

        if (this._lastWorkspace === currentWorkspace)
            return;

        this._disconnectWorkspaceSignals();

        this._lastWorkspace = currentWorkspace;

        this._workspaceWindowAddedId = this._lastWorkspace.connect('window-added',
            () => this._queueRedisplay());
        this._workspaceWindowRemovedId = this._lastWorkspace.connect('window-removed',
            () => this._queueRedisplay());
    }

    _disconnectWorkspaceSignals() {
        if (this._lastWorkspace) {
            this._lastWorkspace.disconnect(this._workspaceWindowAddedId);
            this._lastWorkspace.disconnect(this._workspaceWindowRemovedId);

            this._lastWorkspace = null;
        }
    }

    updateIcon() {
        this.appIconsCache.forEach((appIcon, _appID) => {
            if (appIcon.isSet)
                appIcon.updateIcon();
        });
    }

    _updateIconGeometry() {
        this.appIconsCache.forEach((appIcon, _appID) => {
            if (appIcon.isSet)
                appIcon.updateIconGeometry();
        });
    }

    removeWindowPreviewCloseTimeout() {
        if (this._windowPreviewCloseTimeoutId > 0) {
            GLib.source_remove(this._windowPreviewCloseTimeoutId);
            this._windowPreviewCloseTimeoutId = 0;
        }
    }

    setWindowPreviewCloseTimeout() {
        if (this._windowPreviewCloseTimeoutId > 0)
            return;

        this._windowPreviewCloseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            this._settings.get_int('window-previews-hide-timeout'), () => {
                const activePreview = this.menuManager.activeMenu;
                if (activePreview)
                    activePreview.close(PopupAnimation.FULL);

                this._windowPreviewCloseTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            });
    }

    _destroy() {
        this._disconnectWorkspaceSignals();
        this.removeWindowPreviewCloseTimeout();

        this._clearConnections();
        this.showAppsIcon.destroy();
        this.appIconsCache.forEach((appIcon, appID) => {
            appIcon.stopAllAnimations();
            appIcon.destroy();
            this.appIconsCache.delete(appID);
        });
        this.appIconsCache = null;
    }
});

var PanelBox = GObject.registerClass(
class azTaskbarPanelBox extends St.BoxLayout {
    _init(monitor) {
        super._init({
            name: 'panelBox',
            vertical: true,
        });

        this._settings = TaskbarManager.settings;

        this.monitor = monitor;
        this.panel = new Panel(monitor);
        this.add_child(this.panel);
        this.appDisplayBox = new AppDisplayBox(monitor);

        Main.layoutManager.addChrome(this, {
            affectsStruts: true,
            trackFullscreen: true,
        });
        this.connect('notify::allocation',
            this.setSizeAndPosition.bind(this));
    }

    setSizeAndPosition() {
        const panelLocation = this._settings.get_enum('panel-location');
        if (panelLocation === Enums.PanelLocation.TOP) {
            this.set_position(this.monitor.x, this.monitor.y);
            this.set_size(this.monitor.width, -1);
            return;
        }

        const bottomX = this.monitor.x;
        const bottomY = this.monitor.y + this.monitor.height - this.height;
        this.set_position(bottomX, bottomY);
        this.set_size(this.monitor.width, -1);
    }

    get index() {
        return this.monitor.index;
    }
});

export default class AzTaskbar extends Extension {
    constructor(metaData) {
        super(metaData);
        this.persistentStorage = {};
    }

    enable() {
        this._taskbarManager = new TaskbarManager(this);
        this.settings = this.getSettings();

        this.remoteModel = new UnityLauncherAPI.LauncherEntryRemoteModel();
        this.notificationsMonitor = new NotificationsMonitor();

        global.azTaskbar = {};
        Signals.addSignalMethods(global.azTaskbar);

        Theming.createStylesheet();

        this.settings.connectObject('changed::position-in-panel', () => this._addAppDisplayBoxToPanel(), this);
        this.settings.connectObject('changed::position-offset', () => this._addAppDisplayBoxToPanel(), this);
        this.settings.connectObject('changed::panel-on-all-monitors', () => this._resetPanels(), this);
        this.settings.connectObject('changed::panel-location', () => {
            this._setPanelsLocation();
            Theming.updateStylesheet();
        }, this);
        this.settings.connectObject('changed::isolate-monitors', () => this._resetPanels(), this);
        this.settings.connectObject('changed::show-panel-activities-button', () => this._setActivitiesVisibility(), this);
        this.settings.connectObject('changed::main-panel-height', () => Theming.updateStylesheet(), this);

        Main.layoutManager.connectObject('monitors-changed', () => this._resetPanels(), this);
        Main.layoutManager.panelBox.connectObject('notify::allocation', () => this._setPanelsLocation(true), this);

        Main.panel.add_style_class_name('azTaskbar-panel');

        this._createPanels();
        this._setPanelsLocation();
        this._setActivitiesVisibility();
    }

    disable() {
        if (this._workareasChangedId) {
            global.display.disconnect(this._workareasChangedId);
            this._workareasChangedId = null;
        }
        const mainMonitor = Main.layoutManager.primaryMonitor;
        Main.layoutManager.panelBox.set_position(mainMonitor.x, mainMonitor.y);
        Main.layoutManager.uiGroup.remove_style_class_name('azTaskbar-bottom-panel');

        if (!Main.sessionMode.isLocked)
            Main.panel.statusArea.activities.container.show();

        Main.panel.remove_style_class_name('azTaskbar-panel');

        Theming.deleteStylesheet();

        this.remoteModel.destroy();
        delete this.remoteModel;

        this.notificationsMonitor.destroy();
        delete this.notificationsMonitor;

        this._deletePanels();
        delete global.azTaskbar;

        this._taskbarManager.destroy();
        this._taskbarManager = null;

        Main.layoutManager.disconnectObject(this);
        Main.layoutManager.panelBox.disconnectObject(this);
        this.settings.disconnectObject(this);
        this.settings = null;
    }

    _setActivitiesVisibility() {
        const showActivitiesButton = this.settings.get_boolean('show-panel-activities-button');

        Main.panel.statusArea.activities.container.visible = showActivitiesButton;

        this._panelBoxes.forEach(panelBox => {
            if (panelBox.panel.statusArea.activities)
                panelBox.panel.statusArea.activities.container.visible = showActivitiesButton;
        });
    }

    _resetPanels() {
        this._deletePanels();
        this._createPanels();
        this._setPanelsLocation();
        this._setActivitiesVisibility();
    }

    _createPanels() {
        this._panelBoxes = [];

        this._primaryAppDisplayBox = new AppDisplayBox(Main.layoutManager.primaryMonitor);

        if (this.settings.get_boolean('panel-on-all-monitors')) {
            Main.layoutManager.monitors.forEach(monitor => {
                if (monitor !== Main.layoutManager.primaryMonitor)
                    this._panelBoxes.push(new PanelBox(monitor));
            });
            global.azTaskbar.panels = this._panelBoxes;
            global.azTaskbar.emit('panels-created');
        }

        this._addAppDisplayBoxToPanel();
    }

    _deletePanels() {
        this._primaryAppDisplayBox.destroy();
        this._primaryAppDisplayBox = null;
        this._panelBoxes.forEach(panelBox => {
            panelBox.panel.disable();
            panelBox.destroy();
        });
        this._panelBoxes = null;
    }

    // Based on code from Just Perfection extension
    _setPanelsLocation(mainPanelOnly = false) {
        const panelLocation = this.settings.get_enum('panel-location');

        const mainPanelBox = Main.layoutManager.panelBox;
        const mainMonitor = Main.layoutManager.primaryMonitor;

        if (!mainPanelOnly)
            this._panelBoxes.forEach(panelBox => panelBox.setSizeAndPosition());

        if (panelLocation === Enums.PanelLocation.TOP) {
            if (this._workareasChangedId) {
                global.display.disconnect(this._workareasChangedId);
                this._workareasChangedId = null;
            }
            mainPanelBox.set_position(mainMonitor.x, mainMonitor.y);
            Main.layoutManager.uiGroup.remove_style_class_name('azTaskbar-bottom-panel');
            return;
        }

        const bottomY = mainMonitor.y + mainMonitor.height - mainPanelBox.height;
        mainPanelBox.set_position(mainMonitor.x, bottomY);
        Main.layoutManager.uiGroup.add_style_class_name('azTaskbar-bottom-panel');

        if (!this._workareasChangedId) {
            this._workareasChangedId = global.display.connect('workareas-changed', () => {
                const newBottomY = mainMonitor.y + mainMonitor.height - mainPanelBox.height;
                mainPanelBox.set_position(mainMonitor.x, newBottomY);
                Main.layoutManager.uiGroup.add_style_class_name('azTaskbar-bottom-panel');
            });
        }
    }

    _addAppDisplayBoxToPanel() {
        this._panelBoxes.forEach(panelBox => {
            const {panel} = panelBox;
            const {appDisplayBox} = panelBox;
            this._setAppDisplayBoxPosition(panel, appDisplayBox);
        });

        this._setAppDisplayBoxPosition(Main.panel, this._primaryAppDisplayBox);
    }

    _setAppDisplayBoxPosition(panel, appDisplayBox) {
        const offset = this.settings.get_int('position-offset');
        const parent = appDisplayBox.get_parent();
        if (parent)
            parent.remove_actor(appDisplayBox);

        if (this.settings.get_enum('position-in-panel') === Enums.PanelPosition.LEFT) {
            panel._leftBox.insert_child_at_index(appDisplayBox, offset);
        } else if (this.settings.get_enum('position-in-panel') === Enums.PanelPosition.CENTER) {
            panel._centerBox.insert_child_at_index(appDisplayBox, offset);
        } else if (this.settings.get_enum('position-in-panel') === Enums.PanelPosition.RIGHT) {
            const nChildren = panel._rightBox.get_n_children();
            const order = Math.clamp(nChildren - offset, 0, nChildren);
            panel._rightBox.insert_child_at_index(appDisplayBox, order);
        }
    }
}
