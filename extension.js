const { Clutter, GLib, GObject, Shell, St } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const AppFavorites = imports.ui.appFavorites;
const { AppIconIndicator } = Me.imports.appIconIndicator;
const { AppIcon, ShowAppsIcon } = Me.imports.appIcon;
const BoxPointer = imports.ui.boxpointer;
const DND = imports.ui.dnd;
const Enums = Me.imports.enums;
const Main = imports.ui.main;
const { Panel } = Me.imports.panel;
const PopupMenu = imports.ui.popupMenu;
const Signals = imports.signals;
const Theming = Me.imports.theming;
const Utils = Me.imports.utils;

let settings, appDisplayBox, extensionConnections, panelBoxes;
let tracker = Shell.WindowTracker.get_default();

function getDropTarget(box, x){
    const visibleItems = box.get_children();
    for (const item of visibleItems) {
        const childBox = item.allocation.copy();
        childBox.set_origin(childBox.x1 % box.width, childBox.y1);
        if (x < childBox.x1 || x > childBox.x2)
            continue;

        return { item: item, index: visibleItems.indexOf(item) };
    }

    return { item: null, index: -1 };
}

var AppDisplayBox = GObject.registerClass(
class azTaskbar_AppDisplayBox extends St.ScrollView {
    _init(settings, monitor) {
        super._init({
            style_class: 'hfade'
        });
        this.set_policy(St.PolicyType.EXTERNAL, St.PolicyType.NEVER);
        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        this._monitor = monitor;
        this._settings = settings;
        this.showAppsIcon = new ShowAppsIcon(this._settings);
        this.mainBox = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this.mainBox._delegate = this;
        this.mainBox.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);
        this.clip_to_allocation = true;
        this.add_actor(this.mainBox);
        this._workId = Main.initializeDeferredWork(this, this._redisplay.bind(this));
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this._appSystem = Shell.AppSystem.get_default();
        this.oldAppIcons = new Map();
        this.peekInitialWorkspaceIndex = -1;

        this._connections = new Map();
        this._connections.set(this._settings.connect('changed::panel-on-all-monitors', () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::isolate-workspaces', () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::isolate-monitors', () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::favorites', () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::show-apps-button', () => this._queueRedisplay()), this._settings);
        this._connections.set(AppFavorites.getAppFavorites().connect('changed', () => this._queueRedisplay()), AppFavorites.getAppFavorites());
        this._connections.set(this._appSystem.connect('app-state-changed', () => this._queueRedisplay()), this._appSystem);
        this._connections.set(this._appSystem.connect('installed-changed', () => {
            AppFavorites.getAppFavorites().reload();
            this._queueRedisplay();
        }), this._appSystem);
        this._connections.set(global.window_manager.connect('switch-workspace', () => this._queueRedisplay()), global.window_manager);
        this._connections.set(global.display.connect('window-entered-monitor', this._queueRedisplay.bind(this)), global.display);
        this._connections.set(global.display.connect('window-left-monitor', this._queueRedisplay.bind(this)), global.display);
        this._connections.set(global.display.connect('restacked', this._queueRedisplay.bind(this)), global.display);
        this._connections.set(global.display.connect('window-marked-urgent', this._queueRedisplay.bind(this)), global.display);
        this._connections.set(global.display.connect('window-demands-attention', this._queueRedisplay.bind(this)), global.display);
        this._connections.set(Main.layoutManager.connect('startup-complete', this._queueRedisplay.bind(this)), Main.layoutManager);

        //If appDisplayBox position is moved in the main panel, updateIconGeometry
        this.connect("notify::position", () => this._updateIconGeometry());
        this.connect("destroy", () => this._destroy());
    }

    _createAppItem(newApp, monitorIndex, positionIndex){
        const isFavorite = newApp.isFavorite;
        const app = newApp.app;
        const appID = `${app.get_id()} - ${monitorIndex}`;

        let item = this.oldAppIcons.get(appID);

        //If a favorited app is running when extension starts,
        //the corresponding AppIcon may initially be created with isFavorite = false.
        //Check if isFavorite changed, and create new AppIcon if true.
        const favoriteChanged = item && item.isFavorite !== isFavorite;

        if(item && !favoriteChanged){
            item.isSet = true;
            return item;
        }
        else if(item && favoriteChanged){
            this.oldAppIcons.delete(appID);
            item.destroy();
        }

        let appIcon = new AppIcon(this, this.mainBox, app, monitorIndex, positionIndex, isFavorite);
        appIcon.isSet = true;
        this.oldAppIcons.set(appID, appIcon);
        return appIcon;
    }

    handleDragOver(source, actor, x, _y, _time){
        let dropTarget = getDropTarget(this.mainBox, x);
        let dropTargetItem = dropTarget.item;
        let index = dropTarget.index;

        if(!dropTargetItem)
            return DND.DragMotionResult.NO_DROP;

        source.dragMonitorIndex = dropTargetItem.monitorIndex ?? -1;
        source.dragPos = index;
        let inFavoriteRange = source.dragPos >= (source.firstFavIndex - 1) && source.dragPos <= source.lastFavIndex;

        let id = source.app.get_id();
        let favorites = AppFavorites.getAppFavorites().getFavoriteMap();
        let noDrop = id in favorites;

        if (source.app.is_window_backed() || !global.settings.is_writable('favorite-apps'))
            noDrop = true;

        if(dropTargetItem instanceof AppIcon && dropTargetItem !== source){
            if(inFavoriteRange && noDrop && !source.isFavorite)
                return DND.DragMotionResult.NO_DROP;
                
            //Drop target location not on same monitor as source, but in fav range
            if(!source.isFavorite && inFavoriteRange){
                if(!source.lastPositionIndex)
                    source.lastPositionIndex = this.mainBox.get_children().indexOf(source);
                this.mainBox.remove_child(source);
                this.mainBox.insert_child_at_index(source, index);
            }
            //source has been moved to favorite range from different monitor, return to last location.
            else if(dropTargetItem.monitorIndex !== source.monitorIndex && !inFavoriteRange && source.lastPositionIndex){
                this.mainBox.remove_child(source);
                this.mainBox.insert_child_at_index(source, source.lastPositionIndex);
                source.lastPositionIndex = null;
            }
            else if(dropTargetItem.monitorIndex === source.monitorIndex){
                this.mainBox.remove_child(source);
                this.mainBox.insert_child_at_index(source, index);
            }
        }

        if(inFavoriteRange)
            source.add_style_class_name('azTaskbar-favorite');
        else
            source.remove_style_class_name('azTaskbar-favorite');

        if(source.isFavorite || !inFavoriteRange)
            return DND.DragMotionResult.NO_DROP;

        return DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, x, _y, _time){
        let dropTarget = getDropTarget(this.mainBox, x);
        let dropTargetItem = dropTarget.item;

        let id = source.app.get_id();
        let favorites = AppFavorites.getAppFavorites().getFavoriteMap();
        let srcIsFavorite = id in favorites;
        let favPos = source.dragPos - source.firstFavIndex;
        let inFavoriteRange = source.dragPos >= (source.firstFavIndex - 1) && source.dragPos <= source.lastFavIndex;

        if(!srcIsFavorite && dropTargetItem.monitorIndex !== source.monitorIndex && !inFavoriteRange)
            return false;

        source.positionIndex = source.dragPos;

        if(source.isFavorite){
            if(source.dragPos > source.lastFavIndex || source.dragPos < source.firstFavIndex - 1)
                AppFavorites.getAppFavorites().removeFavorite(id);
            else
                AppFavorites.getAppFavorites().moveFavoriteToPos(id, favPos);
        }
        else if(inFavoriteRange){
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
        let tracker = Shell.WindowTracker.get_default();
        let windows = global.get_window_actors();
        let apps = [];

        for (let i = 0, l = windows.length; i < l; ++i) {
            let app = tracker.get_window_app(windows[i].metaWindow);

            if (app && apps.indexOf(app) < 0) {
                apps.push(app);
            }
        }

        return apps;
    }

    _queueRedisplay() {
        Main.queueDeferredWork(this._workId);
    }

    _sortMonitors(){
        let sortedMonitors = [...Main.layoutManager.monitors];
        sortedMonitors.sort((a, b) => {
            return a.x > b.x;
        });
        return sortedMonitors;
    }

    _redisplay() {
        this.oldApps = [];

        this.mainBox.get_children().forEach(actor => {
            if(actor instanceof AppIcon){
                actor.isSet = false;
                this.oldApps.push({
                    monitorIndex: actor.monitorIndex,
                    app: actor.app,
                });
            }
            else if(actor instanceof ShowAppsIcon){
                this.mainBox.remove_child(actor);
            }
            else{
                this.mainBox.remove_child(actor);
                actor.destroy();
            }
        });

        let isolateMonitors = this._settings.get_boolean('isolate-monitors');
        let panelsOnAllMonitors = this._settings.get_boolean('panel-on-all-monitors');

        let monitorsCount = (isolateMonitors && !panelsOnAllMonitors) ? Main.layoutManager.monitors.length : 1;

        let sortedMonitors = this._sortMonitors();
        let positionIndex = 0;

        for(let i = 0; i < monitorsCount; i++){
            let monitorIndex = panelsOnAllMonitors ? this._monitor.index : sortedMonitors[i].index;

            let oldApps = this.oldApps.filter(oldApp => {
                if(oldApp.monitorIndex === monitorIndex)
                    return oldApp;
            })
            let newApps = [];

            let appFavorites = AppFavorites.getAppFavorites();
            let favorites = appFavorites.getFavoriteMap();

            let showFavorites;
            if(!this._settings.get_boolean('favorites'))
                showFavorites = false;
            else{
                if(panelsOnAllMonitors)
                    showFavorites = monitorIndex === Main.layoutManager.primaryIndex;
                else
                    showFavorites = (isolateMonitors ? i === 0 : true);
            }

            let running = this._getRunningApps();

            running = running.filter(app => Utils.getInterestingWindows(this._settings, app.get_windows(), monitorIndex).length);

            if(showFavorites){
                let favsArray = appFavorites.getFavorites();
                for (let i = 0; i < favsArray.length; i++) {
                    newApps.push({
                        app: favsArray[i],
                        isFavorite: true,
                    });
                }
            }

            //Search old apps, if running contains an old app, remove from running
            oldApps.forEach(oldApp => {
                const app = oldApp.app;
                const index = running.indexOf(app);
                if (index > -1) {
                    const [app] = running.splice(index, 1);
                    if (!showFavorites || !(app.get_id() in favorites)) {
                        newApps.push({
                            app,
                            isFavorite: false
                        });
                    }
                }
                //if oldApp not found in running apps list,
                //check if entry exists in this.oldAppIcons
                //if it does, it's no longer needed - destroy it
                else if(!showFavorites || !(app.get_id() in favorites)){
                    const appID = `${app.get_id()} - ${monitorIndex}`;
                    let item = this.oldAppIcons.get(appID);
                    if(item){
                        this.oldAppIcons.delete(appID);
                        item.destroy();
                    }
                }
            });

            //add the new apps
            running.forEach(app => {
                if (!showFavorites || !(app.get_id() in favorites)) {
                    newApps.push({
                        app,
                        isFavorite: false
                    });
                }
            });

            if(newApps.length > 0){
                newApps.forEach(newApp => {
                    let item = this._createAppItem(newApp, monitorIndex, positionIndex);
                    const parent = item.get_parent();

                    if(parent && item.positionIndex !== positionIndex){
                        item.positionIndex = positionIndex;
                        item.stopAllAnimations();
                        this.mainBox.remove_child(item);
                        this.mainBox.insert_child_at_index(item, positionIndex);
                    }
                    else if(!parent) {
                        item.opacity = 0;
                        this.mainBox.insert_child_at_index(item, positionIndex);
                        item.animateIn();
                    }

                    positionIndex++;
                });
            }
        }

        this.oldAppIcons.forEach((appIcon, appID) => {
            if(appIcon.isSet){
                appIcon.updateAppIcon();
            }
            else{
                this.oldAppIcons.delete(appID);
                appIcon.destroy();
            }
        });

        let children = this.mainBox.get_children();
        for(let i = 0; i < children.length; i++){
            const appIcon = children[i];
            const previousAppIcon = children[i - 1];
            //if the previous AppIcon has different monitorIndex, add a separator.
            if(previousAppIcon && appIcon.monitorIndex !== previousAppIcon.monitorIndex){
                let separator = new St.Widget({
                    style_class: "azTaskbar-Separator",
                    x_align: Clutter.ActorAlign.FILL,
                    y_align: Clutter.ActorAlign.CENTER,
                    width: 1,
                    height: 15,
                });
                this.mainBox.insert_child_at_index(separator, i);
            }
        }

        let [showAppsButton, showAppsButtonPosition] = this._settings.get_value('show-apps-button').deep_unpack();
        if(showAppsButton){
            if(showAppsButtonPosition === Enums.ShowAppsButtonPosition.LEFT)
                this.mainBox.insert_child_at_index(this.showAppsIcon, 0);
            else
                this.mainBox.add_child(this.showAppsIcon);
            this.showAppsIcon.updateIcon();
        }

        this.mainBox.queue_relayout();
    }

    updateIcon(){
        this.oldAppIcons.forEach((appIcon, appID) => {
            if(appIcon.isSet){
                appIcon.updateIcon();
            }
        });
    }

    _updateIconGeometry(){
        this.oldAppIcons.forEach((appIcon, appID) => {
            if(appIcon.isSet){
                appIcon.updateIconGeometry();
            }
        });
    }

    removeWindowPreviewCloseTimeout(){
        if (this._windowPreviewCloseTimeoutId > 0) {
            GLib.source_remove(this._windowPreviewCloseTimeoutId);
            this._windowPreviewCloseTimeoutId = 0;
        }
    }

    setWindowPreviewCloseTimeout(){
        if(this._windowPreviewCloseTimeoutId > 0)
            return;

        this._windowPreviewCloseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._settings.get_int('window-previews-hide-timeout'), () => {
            let activePreview = this.menuManager.activeMenu;
            if(activePreview)
                activePreview.close(BoxPointer.PopupAnimation.FULL);

            this._windowPreviewCloseTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _destroy() {
        this.removeWindowPreviewCloseTimeout();

        this._connections.forEach((object, id) => {
            object.disconnect(id);
            id = null;
        });

        this._connections = null;
        this.showAppsIcon.destroy();
        this.oldAppIcons.forEach((appIcon, appID) => {
            appIcon.stopAllAnimations();
            appIcon.destroy();
            this.oldAppIcons.delete(appID);
        });
        this.oldAppIcons = null;
    }
});

var PanelBox = GObject.registerClass(
class azTaskbar_PanelBox extends St.BoxLayout {
    _init(monitor) {
        super._init({
            name: 'panelBox',
            vertical: true,
        });

        this.monitor = monitor;
        this.panel = new Panel(monitor, this);
        this.add_child(this.panel);
        this.appDisplayBox = new AppDisplayBox(settings, monitor);
    
        Main.layoutManager.addChrome(this, {
            affectsStruts: true,
            trackFullscreen: true,
        });
        this.connect('notify::allocation',
            this._panelBoxChanged.bind(this));
    }

    _panelBoxChanged() {
        this.set_position(this.monitor.x, this.monitor.y);
        this.set_size(this.monitor.width, -1);
    }

    get index() {
        return this.monitor.index;
    }
})

function enable() {
    settings = ExtensionUtils.getSettings();

    global.azTaskbar = {};
    Signals.addSignalMethods(global.azTaskbar);

    Me.customStylesheet = Theming.getStylesheetFile();
    Theming.updateStylesheet(settings);

    extensionConnections = new Map();
    extensionConnections.set(settings.connect('changed::position-in-panel', () => addAppDisplayBoxToPanel()), settings);
    extensionConnections.set(settings.connect('changed::position-offset', () => addAppDisplayBoxToPanel()), settings);
    extensionConnections.set(settings.connect('changed::panel-on-all-monitors', () => resetPanels()), settings);
    extensionConnections.set(settings.connect('changed::main-panel-height', () => Theming.updateStylesheet(settings)), settings);
    extensionConnections.set(Main.layoutManager.connect('monitors-changed', () => resetPanels()), Main.layoutManager);

    appDisplayBox = new AppDisplayBox(settings, Main.layoutManager.primaryMonitor);

    Main.panel.statusArea.appMenu.container.hide();
    Main.panel.add_style_class_name("azTaskbar-panel");

    createPanels();
}

function disable() {
    if (!Main.overview.visible && !Main.sessionMode.isLocked)
        Main.panel.statusArea.appMenu.container.show();

    Main.panel.remove_style_class_name("azTaskbar-panel");

    Theming.unloadStylesheet();
    delete Me.customStylesheet;

    extensionConnections.forEach((object, id) => {
        object.disconnect(id);
        id = null;
    });
    extensionConnections = null;

    delete global.azTaskbar;
    deletePanels();

    appDisplayBox.destroy();
    appDisplayBox = null;
    settings.run_dispose();
    settings = null;
}

function init() {
    ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
    Me.persistentStorage = {};
}

function resetPanels(){
    deletePanels();
    createPanels();
}

function createPanels(){
    panelBoxes = [];

    if(settings.get_boolean('panel-on-all-monitors')){
        Main.layoutManager.monitors.forEach(monitor => {
            if (monitor !== Main.layoutManager.primaryMonitor){
                panelBoxes.push(new PanelBox(monitor));
            }
        });
        global.azTaskbar.panels = panelBoxes;
        global.azTaskbar.emit('panels-created');
    }

    addAppDisplayBoxToPanel();
}

function deletePanels(){
    panelBoxes.forEach(panelBox => {
        panelBox.panel.disable();
        panelBox.destroy();
    });
    panelBoxes = null;
}

function addAppDisplayBoxToPanel(){
    panelBoxes.forEach(panelBox => {
        const panel = panelBox.panel;
        const appDisplayBox = panelBox.appDisplayBox;
        setAppDisplayBoxPosition(panel, appDisplayBox);
    });

    setAppDisplayBoxPosition(Main.panel, appDisplayBox);
}

function setAppDisplayBoxPosition(panel, appDisplayBox){
    const offset = settings.get_int('position-offset');
    let parent = appDisplayBox.get_parent();
    if(parent)
        parent.remove_actor(appDisplayBox);

    if(settings.get_enum('position-in-panel') === Enums.PanelPosition.LEFT)
        panel._leftBox.insert_child_at_index(appDisplayBox, offset);
    else if(settings.get_enum('position-in-panel') === Enums.PanelPosition.CENTER)
        panel._centerBox.insert_child_at_index(appDisplayBox, offset);
    else if(settings.get_enum('position-in-panel') === Enums.PanelPosition.RIGHT){
        let nChildren = panel._rightBox.get_n_children();
        const order = Math.clamp(nChildren - offset, 0, nChildren);
        panel._rightBox.insert_child_at_index(appDisplayBox, order);
    }
}
