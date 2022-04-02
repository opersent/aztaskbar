const { Clutter, GLib, GObject, Shell, St } = imports.gi;

const { AppMenu } = imports.ui.appMenu;
const AppFavorites = imports.ui.appFavorites;
const DND = imports.ui.dnd;
const ExtensionUtils = imports.misc.extensionUtils;
const IconGrid = imports.ui.iconGrid;
const Main = imports.ui.main;
const Me = ExtensionUtils.getCurrentExtension();
const PopupMenu = imports.ui.popupMenu;
const { WindowPreviewMenu } = Me.imports.windowPreview;

let settings, appDisplayBar;

const EnableLog = false;

var AppDisplayBar = GObject.registerClass(
class azTaskbar_AppDisplayBar extends St.BoxLayout {
    _init(settings) {
        super._init();

        this._settings = settings;
        this.clip_to_allocation = true,
        this._workId = Main.initializeDeferredWork(this, this._redisplay.bind(this));
        this._menuManager = new PopupMenu.PopupMenuManager(this);

        this._appSystem = Shell.AppSystem.get_default();

        this.oldAppIcons = new Map();

        this._connections = new Map();

        this._connections.set(this._settings.connect('changed::isolate-workspaces', () => this._redisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::isolate-monitors', () => this._redisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::favorites', () => this._redisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::icon-size', () => this._redisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-running', () => this._redisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-focused', () => this._redisplay()), this._settings);

        this._connections.set(AppFavorites.getAppFavorites().connect('changed', () => this._redisplay()), AppFavorites.getAppFavorites());
        this._connections.set(this._appSystem.connect('app-state-changed', () => this._redisplay()), this._appSystem);

        this._connections.set(global.window_manager.connect('switch-workspace', this._redisplay.bind(this)), global.window_manager);

        this._connections.set(global.display.connect('window-entered-monitor', this._redisplay.bind(this)), global.display);
        this._connections.set(global.display.connect('restacked', this._redisplay.bind(this)), global.display);
        this._connections.set(global.display.connect('window-marked-urgent', this._redisplay.bind(this)), global.display);
        this._connections.set(global.display.connect('window-demands-attention', this._redisplay.bind(this)), global.display);

        this._redisplay();
        this.connect("destroy", () => this._destroy());
    }

    _createAppItem(appIcon, monitorIndex, positionIndex){
        const isFavorite = appIcon.isFavorite;
        const app = appIcon.app;
        const appID = app.get_id() + ", " + monitorIndex;

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

        let button = new AppIcon(this._settings, app, this._menuManager, monitorIndex, positionIndex, isFavorite);
        button.isSet = true;
        this.oldAppIcons.set(appID, button);
        return button;
    }

    _redisplay() {
        this.oldApps = [];

        this.get_children().forEach(actor => {
            if(actor instanceof AppIcon){
                actor.isSet = false;
                this.oldApps.push({
                    monitorIndex: actor.monitorIndex,
                    app: actor.app,
                });
            }
            else{
                this.remove_child(actor);
                actor.destroy();
            }
        });

        let isolateMonitors = this._settings.get_boolean('isolate-monitors');
        let boxesCount = isolateMonitors ? Main.layoutManager.monitors.length : 1;
        let positionIndex = 0;
        for(let i = 0; i < boxesCount; i++){
            let monitorIndex = i;

            let oldApps = this.oldApps.filter(oldApp => {
                if(oldApp.monitorIndex === monitorIndex)
                    return oldApp;
            })
            let newApps = [];

            let appFavorites = AppFavorites.getAppFavorites();
            let favorites = appFavorites.getFavoriteMap();

            let showFavorites = monitorIndex === Main.layoutManager.primaryIndex && this._settings.get_boolean('favorites');

            let running = this._appSystem.get_running();

            running = running.filter(app => getInterestingWindows(this._settings, app.get_windows(), monitorIndex).length);

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
                const index = running.indexOf(oldApp.app);
                if (index > -1) {
                    const [app] = running.splice(index, 1);
                    if (!showFavorites || !(app.get_id() in favorites)) {
                        newApps.push({
                            app,
                            isFavorite: false
                        });
                    }
                }
            });

            // Second: add the new apps
            running.forEach(app => {
                if (!showFavorites || !(app.get_id() in favorites)) {
                    newApps.push({
                        app,
                        isFavorite: false
                    });
                }
            });

            if(newApps.length > 0){
                newApps.forEach(app => {
                    let item = this._createAppItem(app, monitorIndex, positionIndex);

                    debugLog("LIST - " + item.app.get_name() + " - pos " + positionIndex + ", on " + monitorIndex);

                    if(item.get_parent() && item.positionIndex === positionIndex){
                        //debugLog("DON'T MOVE - " + item.app.get_name() + " - pos " + positionIndex + ", on " + monitorIndex);
                    }
                    else if(item.get_parent() && item.positionIndex !== positionIndex){
                        debugLog("MOVE - " + item.app.get_name() + " from " + item.positionIndex + " to " + positionIndex);
                        item.positionIndex = positionIndex;
                        this.remove_child(item);
                        this.insert_child_at_index(item, positionIndex);
                    }
                    else {
                        debugLog("ADD - " + item.app.get_name() + " at index " + positionIndex);
                        this.insert_child_at_index(item, positionIndex);
                    }

                    if(this.mapped){
                        item.setActiveState();
                        item.setIconSize(this._settings.get_int('icon-size'));
                    }

                    positionIndex++;
                });
            }
        }

        //destroy old AppIcons that are no longer needed
        this.oldAppIcons.forEach((value,key,map) => {
            if(!value.isSet){
                debugLog("destroy " + value.app.get_name())
                value.destroy();
                this.oldAppIcons.delete(key);
            }
        });

        let children = this.get_children();
        for(let i = 0; i < children.length; i++){
            const appicon = children[i];
            const previusAppicon = children[i - 1];
            //if the previous AppIcon has different monitorIndex, add a separator.
            if(previusAppicon && appicon.monitorIndex !== previusAppicon.monitorIndex){
                let separator = new St.Widget({
                    style_class: "azTaskbar-Separator",
                    x_align: Clutter.ActorAlign.FILL,
                    y_align: Clutter.ActorAlign.CENTER,
                    width: 1,
                    height: 15,
                });
                this.insert_child_at_index(separator, i);
            }
        }

        this.queue_relayout();
    }

    _destroy() {
        this.oldAppIcons.forEach((value, key, map) => {
            value.destroy();
            this.oldAppIcons.delete(key);
        });
        this.oldAppIcons = null;

        this._connections.forEach((object, id) => {
            object.disconnect(id);
            id = null;
        });

        this._connections = null;
    }
});

var AppIcon = GObject.registerClass(
class azTaskbar_AppIcon extends St.Button {
    _init(settings, app, menuManager, monitorIndex, positionIndex, isFavorite) {
        super._init({
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
        });

        this.app = app;
        this._menuManager = menuManager;
        this.monitorIndex = monitorIndex;
        this.positionIndex = positionIndex;
        this._settings = settings;
        this.isFavorite = isFavorite;

        this._delegate = this;

        if(!this.isFavorite){
            this._draggable = DND.makeDraggable(this, { timeoutThreshold: 200 });
            this._draggable.connect('drag-begin', this._onDragBegin.bind(this));
            this._draggable.connect('drag-cancelled', this._onDragCancelled.bind(this));
            this._draggable.connect('drag-end', this._onDragEnd.bind(this));
        }

        this._contextMenuManager = new PopupMenu.PopupMenuManager(this);

        let box = new St.BoxLayout({
            vertical: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        this.indicatorTop = new St.Widget({
            style_class: 'azTaskbar-indicator',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });
        box.add_child(this.indicatorTop);

        let iconSize = this._settings.get_int('icon-size');
        this.appIcon = new St.Bin({
            reactive: true,
            can_focus: true,
            track_hover: true,
            style_class: 'azTaskbar-AppButton',
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            child: app.create_icon_texture(iconSize)
        });
        this.bind_property('hover', this.appIcon, 'hover', GObject.BindingFlags.SYNC_CREATE);

        box.add_child(this.appIcon);

        this.indicatorBottom = new St.Widget({
            style_class: 'azTaskbar-indicator',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: false,
            y_align: Clutter.ActorAlign.END
        });
        box.add_child(this.indicatorBottom);

        this.overlayWidget = new St.Icon({
            icon_name: 'list-add-symbolic',
            icon_size: 8,
            style_class: 'azTaskbar-multi-window-indicator',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        this.overlayWidget.hide();

        let overlayGroup = new Clutter.Actor({
            layout_manager: new Clutter.BinLayout(),
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        overlayGroup.add_actor(box);
        overlayGroup.add_actor(this.overlayWidget);

        this.set_child(overlayGroup);

        this.tooltipLabel = new St.Label({
            style_class: 'dash-label azTaskbar-Tooltip',
            text: app.get_name()
        });
        this.tooltipLabel.hide();
        Main.layoutManager.addChrome(this.tooltipLabel);

        this._menu = null;

        this._previewMenu = new WindowPreviewMenu(this);
        this._menuManager.addMenu(this._previewMenu);

        this._menuTimeoutId = 0;

        this.connect('destroy', () => {
            this.indicatorTop.style = 'transition-duration: 0ms;';
            this.appIcon.style = 'transition-duration: 0ms;';
            this.indicatorTop.remove_all_transitions();
            this.appIcon.remove_all_transitions();

            this._connections.forEach((object, id) => {
                object.disconnect(id);
                id = null;
            });

            this._connections = null;

            if(this._menu?.isOpen)
                this._menu.close();

            this._previewMenu.destroy();

            if (this._dragMonitor) {
                DND.removeDragMonitor(this._dragMonitor);
                this._dragMonitor = null;
            }

            if (this._draggable) {
                if (this._dragging)
                    Main.overview.endItemDrag(this);
                this._draggable = null;
            }

            this._removeMenuTimeout();
            this._removePreviewMenuTimeout();
            this._clearCycleWindow();
            this._removeCylceWindowsTimeout();
            this.tooltipLabel.remove_all_transitions();
            this.tooltipLabel.hide();
            this.tooltipLabel.destroy();
        });

        this._connections = new Map();

        this._connections.set(this._settings.connect('changed::indicators', () => this.setActiveState()), this._settings);
        this._connections.set(global.display.connect('notify::focus-window', () => this.setActiveState()), global.display);

        this._connections.set(this._previewMenu.connect('open-state-changed', (menu, isPoppedUp) => {
            if (!isPoppedUp){
                this.setForcedHighlight(false);
                this._onMenuPoppedDown();
            }
            else{
                this.hideLabel();
                this.setForcedHighlight(true);
            }
        }), this._previewMenu);


        this.connect('notify::hover', () => {
            this._onHover();
        });

        this.connect('clicked', () => {
            this.hideLabel();
        });
    }

    getDragActor() {
        return this.app.create_icon_texture(this._settings.get_int('icon-size') * 1.5);
    }

    getDragActorSource() {
        return this;
    }

    _onDragBegin() {
        this.indicatorTop.style += 'transition-duration: 0ms;';
        this.appIcon.style = 'transition-duration: 0ms;';
        this.indicatorTop.remove_all_transitions();
        this.appIcon.remove_all_transitions();
        
        this.newIndex = -1;

        this._removePreviewMenuTimeout();
        this._removeMenuTimeout();
        this.hideLabel();
        this._dragging = true;

        this._dragMonitor = {
            dragMotion: this._onDragMotion.bind(this),
        };
        DND.addDragMonitor(this._dragMonitor);

        this.opacity = 55;
        Main.overview.beginItemDrag(this);
    }

    _onDragMotion(dragEvent) {
        this.get_allocation_box();

        let parentBox = this.get_parent();

        let [x, y] = parentBox.get_transformed_position();

        const deltaX = dragEvent.x - x;

        this.index = Math.floor((deltaX) / (this.width));
        if(this.newIndex < 0)
            this.newIndex = this.index;

        this.index = Math.min(Math.max(this.index, 0), parentBox.get_n_children() - 1);

        const itemAtIndex = parentBox.get_child_at_index(this.index);
        if(itemAtIndex instanceof AppIcon && !itemAtIndex.isFavorite && this.newIndex !== this.index){
            this.newIndex = this.index;
            parentBox.remove_child(this);
            parentBox.insert_child_at_index(this, this.index);
            this.positionIndex = this.index;
        }

        return DND.DragMotionResult.CONTINUE;
    }

    _onDragCancelled() {
        this.indicatorTop.style.replace('transition-duration: 0ms;', '');
        this.appIcon.style = null;
        this._dragging = false;
        Main.overview.cancelledItemDrag(this);
    }

    _onDragEnd() {
        this.indicatorTop.style.replace('transition-duration: 0ms;', '');
        this.appIcon.style = null;
        this._dragging = false;
        this.undoFade();

        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        Main.overview.endItemDrag(this);
    }

    undoFade() {
        this.ease({
            scale_x: 1.0,
            scale_y: 1.0,
            opacity: 255,
        });
    }

    setIconSize(size){
        this.appIcon.child = this.app.create_icon_texture(size);
    }

    setActiveState(){
        if(this._dragging || !this.mapped || !this.get_parent()?.mapped)
            return;
        this.overlayWidget.hide();
        this.appIcon.style = null;
        this.appIcon.set_style_pseudo_class(null);
        let indicatorColor = 'transparent';
        let indicatorWidth = 7;

        let windows = this.getInterestingWindows();

        if(windows.length >= 1){
            indicatorColor = this._settings.get_string('indicator-color-running');
            windows.forEach(window => {
                if(window.has_focus()){
                    if(windows.length > 1)
                        this.overlayWidget.show();
                    this.appIcon.add_style_pseudo_class('active');
                    indicatorWidth = 13;
                    indicatorColor = this._settings.get_string('indicator-color-focused');
                }
            });
        }

        if(!this._settings.get_boolean('indicators'))
            indicatorColor = 'transparent';

        this.indicatorTop.style = `background-color: ${indicatorColor};`;
        this.indicatorTop.ease({
            width: indicatorWidth,
        });
    }

    setForcedHighlight(highlighted) {
        this._forcedHighlight = highlighted;
        if (highlighted)
            this.appIcon.add_style_pseudo_class('focus');
        else
            this.appIcon.remove_style_pseudo_class('focus');
    }

    _removeMenuTimeout() {
        if (this._menuTimeoutId > 0) {
            GLib.source_remove(this._menuTimeoutId);
            this._menuTimeoutId = 0;
        }
    }

    _setPopupTimeout() {
        this._removeMenuTimeout();
        this._menuTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            this._menuTimeoutId = 0;
            this.popupMenu();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._menuTimeoutId, '[azTaskbar] this.popupMenu');
    }

    _removePreviewMenuTimeout() {
        if (this._previewMenuTimeoutId > 0) {
            GLib.source_remove(this._previewMenuTimeoutId);
            this._previewMenuTimeoutId = 0;
        }
    }

    _setPreviewPopupTimeout() {
        if(!this._settings.get_boolean('window-previews'))
            return;

        this._removePreviewMenuTimeout();

        this._previewMenuTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
            this._previewMenuTimeoutId = 0;
            this._windowPreviews();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._previewMenuTimeoutId, '[azTaskbar] this.previewPopupMenu');
    }

    vfunc_button_press_event(buttonEvent) {
        const ret = super.vfunc_button_press_event(buttonEvent);

        this._removePreviewMenuTimeout();

        if (this._previewMenu?.isOpen)
            this._previewMenu.close();

        if (buttonEvent.button === 1) 
            this._setPopupTimeout();
        else if (buttonEvent.button === 3) {
            this.hideLabel();
            this.popupMenu();
            return Clutter.EVENT_STOP;
        }

        return ret;
    }

    vfunc_clicked(button) {
        this._removePreviewMenuTimeout();
        this._removeMenuTimeout();
        this.hideLabel();

        if(this._menu?.isOpen)
            return;

        this.activate(button);
    }

    popupMenu(side = St.Side.TOP) {
        this._removeMenuTimeout();

        if (!this._menu) {
            this._menu = new AppMenu(this, side, {
                favoritesSection: true,
                showSingleWindows: true,
            });
            this._menu.blockSourceEvents = true;
            this._menu.setApp(this.app);
            this._connections.set(this._menu.connect('open-state-changed', (menu, isPoppedUp) => {
                if (!isPoppedUp){
                    this.setForcedHighlight(false);
                    this._onMenuPoppedDown();
                }
                else{
                    this.setForcedHighlight(true);
                }
            }), this._menu);

            Main.uiGroup.add_actor(this._menu.actor);
            this._contextMenuManager.addMenu(this._menu);
        }

        this._menu.open();
        this._contextMenuManager.ignoreRelease();

        return false;
    }

    _onMenuPoppedDown() {
        this._removePreviewMenuTimeout();
    }

    _removeCylceWindowsTimeout() {
        if (this._cylceWindowsTimeoutId > 0) {
            GLib.source_remove(this._cylceWindowsTimeoutId);
            this._cylceWindowsTimeoutId = 0;
        }
    }

    _clearCycleWindow(){
        let windows = this.getInterestingWindows();
        windows.forEach(window => {
            delete window.cycled;
        });
    }

    _setCylceWindowsTimeout() {
        this._removeCylceWindowsTimeout();

        this._cylceWindowsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._cylceWindowsTimeoutId = 0;
            this._clearCycleWindow();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._cylceWindowsTimeoutId, '[azTaskbar] cycleWindows');
    }

    activate(button) {
        let event = Clutter.get_current_event();
        let modifiers = event ? event.get_state() : 0;
        let windows = this.getInterestingWindows();
        let isMiddleButton = button && button === Clutter.BUTTON_MIDDLE;
        let isCtrlPressed = (modifiers & Clutter.ModifierType.CONTROL_MASK) != 0;
        let openNewWindow = this.app.can_open_new_window() &&
                            this.app.state == Shell.AppState.RUNNING &&
                            (isCtrlPressed || isMiddleButton);

        Main.overview.hide();

        if (this.app.state === Shell.AppState.STOPPED || openNewWindow)
            IconGrid.zoomOutActor(this.appIcon);

        if (openNewWindow)
            this.app.open_new_window(-1);
        else{
            if(windows.length > 1){
                //start a timer that clears cycle state after x amount of time
                this._setCylceWindowsTimeout();

                let cycled = windows.filter(window => {
                    if(window.cycled)
                        return window;
                });
                if(cycled.length === windows.length){
                    windows.forEach(window => {
                        window.minimize();
                        window.cycled = false;
                    });
                    return;
                }
                for(let i = 0; i < windows.length; i++){
                    let window = windows[i];
                    if(window.has_focus() && !window.cycled){
                        window.cycled = true;
                    }
                    if(!window.cycled){
                        window.cycled = true;
                        Main.activateWindow(window);
                        break;
                    }
                }
            }
            else if(windows.length === 1){
                const window = windows[0];
                if(window.minimized || !window.has_focus())
                    Main.activateWindow(window);
                else
                    window.minimize();
            }
            else if(this.app.state === Shell.AppState.RUNNING){
                IconGrid.zoomOutActor(this.appIcon);
                this.app.open_new_window(-1);
            }
            else
                this.app.activate();
        }
    }

    _onHover() {
        if (this.hover) {
            if(this.getInterestingWindows().length >= 1 && this.app.state == Shell.AppState.RUNNING)
                this._setPreviewPopupTimeout();
            this.showLabel();
        } else {
            this._removePreviewMenuTimeout();
            this._removeMenuTimeout();
            this.hideLabel();
        }
    }

    getWindows() {
        return this.app.get_windows();
    }

    getInterestingWindows() {
        const interestingWindows = getInterestingWindows(this._settings, this.getWindows(), this.monitorIndex);

        return interestingWindows;
    }

    _windowPreviews() {
        if (this._previewMenu.isOpen)
            return;
        else{
            this._removeMenuTimeout();

            this._previewMenu.popup();
        }
    }

    showLabel() {
        if(!this._settings.get_boolean('tool-tips'))
            return;

        if (this._previewMenu.isOpen)
            return;

        this.tooltipLabel.opacity = 0;
        this.tooltipLabel.show();

        let [stageX, stageY] = this.get_transformed_position();

        const itemWidth = this.allocation.get_width();
        const itemHeight = this.allocation.get_height();

        const labelWidth = this.tooltipLabel.get_width();
        const xOffset = Math.floor((itemWidth - labelWidth) / 2);
        const x = Math.clamp(stageX + xOffset, 0, global.stage.width - labelWidth);

        const yOffset = 6;
        const y = stageY + itemHeight + yOffset;

        this.tooltipLabel.set_position(x, y);
        this.tooltipLabel.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    hideLabel() {
        this.tooltipLabel.ease({
            opacity: 0,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.tooltipLabel.hide(),
        });
    }
});

function enable() {
    if(imports.gi.Meta.is_wayland_compositor())
        Me.metadata.isWayland = true;
    else
        Me.metadata.isWayland = false;
    settings = ExtensionUtils.getSettings();
    appDisplayBar = new AppDisplayBar(settings);
    Main.panel._leftBox.add_child(appDisplayBar);

    Main.panel.statusArea.appMenu.container.hide();
}

function disable() {
    if(Main.panel._leftBox.contains(appDisplayBar))
        Main.panel._leftBox.remove_child(appDisplayBar);

    if (!Main.overview.visible && !Main.sessionMode.isLocked) {
        Main.panel.statusArea.appMenu.container.show();
    }

    appDisplayBar.destroy();
    appDisplayBar = null;
    settings.run_dispose();
    settings = null;
}

function init() {
    ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
}

function getInterestingWindows(settings, windows, monitorIndex) {
    if(settings.get_boolean('isolate-workspaces')){
        const activeWorkspace = global.workspace_manager.get_active_workspace_index();
        windows = windows.filter(function(w) {
            const inWorkspace = w.get_workspace().index() === activeWorkspace;
            return inWorkspace;
        });
    }

    if(settings.get_boolean('isolate-monitors')){
        windows = windows.filter(function(w) {
            return w.get_monitor() === monitorIndex;
        });
    }

    return windows.filter(w => !w.skipTaskbar);
}

function debugLog(msg){
    if(EnableLog) log(msg);
}
