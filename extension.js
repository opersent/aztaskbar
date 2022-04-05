const { Clutter, GLib, GObject, Meta, Shell, St } = imports.gi;

const { AppMenu } = imports.ui.appMenu;
const AppFavorites = imports.ui.appFavorites;
const BoxPointer = imports.ui.boxpointer;
const Config = imports.misc.config;
const DND = imports.ui.dnd;
const ExtensionUtils = imports.misc.extensionUtils;
const IconGrid = imports.ui.iconGrid;
const Main = imports.ui.main;
const Me = ExtensionUtils.getCurrentExtension();
const PopupMenu = imports.ui.popupMenu;
const { WindowPreviewMenu } = Me.imports.windowPreview;

let settings, appDisplayBar;

const INDICATOR_RUNNING_WIDTH = 9;
const INDICATOR_FOCUSED_WIDTH = 13;

const [major] = Config.PACKAGE_VERSION.split('.');
const shellVersion = Number.parseInt(major);

var AppDisplayBar = GObject.registerClass(
class azTaskbar_AppDisplayBar extends St.BoxLayout {
    _init(settings) {
        super._init();
        this._settings = settings;
        this.clip_to_allocation = true,
        this._workId = Main.initializeDeferredWork(this, this._redisplay.bind(this));
        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this._appSystem = Shell.AppSystem.get_default();
        this.oldAppIcons = new Map();

        this._connections = new Map();
        this._connections.set(this._settings.connect('changed::isolate-workspaces', () => this._redisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::isolate-monitors', () => this._redisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::favorites', () => this._redisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::icon-size', () => this._redisplay()), this._settings);
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

        let button = new AppIcon(this, app, monitorIndex, positionIndex, isFavorite);
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
                    const appID = app.get_id() + ", " + monitorIndex;
                    let item = this.oldAppIcons.get(appID);
                    if(item){
                        this.oldAppIcons.delete(appID);
                        item.destroy();
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
                    const parent = item.get_parent();

                    if(parent && item.positionIndex !== positionIndex){
                        item.positionIndex = positionIndex;
                        item.stopAllAnimations();
                        this.remove_child(item);
                        this.insert_child_at_index(item, positionIndex);
                    }
                    else if(!parent) {
                        this.insert_child_at_index(item, positionIndex);
                    }

                    if(item.get_stage()){
                        item.setActiveState();
                        item.setIconSize(this._settings.get_int('icon-size'));
                    }

                    positionIndex++;
                });
            }
        }

        this.oldAppIcons.forEach((value,key,map) => {
            if(value.isSet){
                value.updateIconGeometry();
            }
            else{
                this.oldAppIcons.delete(key);
                value.destroy();
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

    removeWindowPreviewCloseTimeout(){
        if (this._windowPreviewCloseTimeoutId > 0) {
            GLib.source_remove(this._windowPreviewCloseTimeoutId);
            this._windowPreviewCloseTimeoutId = 0;
        }
    }

    setWindowPreviewCloseTimeout(){
        if(this._windowPreviewCloseTimeoutId > 0)
            return;

        this._windowPreviewCloseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            this._windowPreviewCloseTimeoutId = 0;
            let activePreview = this.menuManager.activeMenu;
            if(activePreview)
                activePreview.close(BoxPointer.PopupAnimation.FULL);
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

        this.oldAppIcons.forEach((value, key, map) => {
            value.stopAllAnimations();
            value.destroy();
            this.oldAppIcons.delete(key);
        });
        this.oldAppIcons = null;
    }
});

var AppIcon = GObject.registerClass(
class azTaskbar_AppIcon extends St.Button {
    _init(appDisplayBar, app, monitorIndex, positionIndex, isFavorite) {
        super._init({
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
        });

        this.appDisplayBar = appDisplayBar;
        this.app = app;
        this.menuManager = appDisplayBar.menuManager;
        this.monitorIndex = monitorIndex;
        this.positionIndex = positionIndex;
        this._settings = appDisplayBar._settings;
        this.isFavorite = isFavorite;
        this._contextMenuManager = new PopupMenu.PopupMenuManager(this);

        this._delegate = this;

        if(!this.isFavorite){
            this._draggable = DND.makeDraggable(this, { timeoutThreshold: 200 });
            this._draggable.connect('drag-begin', this._onDragBegin.bind(this));
            this._draggable.connect('drag-cancelled', this._onDragCancelled.bind(this));
            this._draggable.connect('drag-end', this._onDragEnd.bind(this));
        }

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
        this._menuTimeoutId = 0;

        this._previewMenu = new WindowPreviewMenu(this);
        this.menuManager.addMenu(this._previewMenu);

        this._setIndicatorLocation();

        this._connections = new Map();
        this._connections.set(this._settings.connect('changed::indicators', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-location', () => this._setIndicatorLocation()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-running', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-focused', () => this.setActiveState()), this._settings);
        this._connections.set(global.display.connect('notify::focus-window', () => this.setActiveState()), global.display);
        this._connections.set(this.app.connect('windows-changed', () => this._resetCycleWindows()), this.app);
        this._connections.set(this.connect('scroll-event', this._onMouseScroll.bind(this)), this);
        this._connections.set(this._previewMenu.connect('open-state-changed', this._previewMenuOpenStateChanged.bind(this)), this._previewMenu);
        if(shellVersion >= 42)
            this._connections.set(this._previewMenu.actor.connect('captured-event', this._previewMenuCapturedEvent.bind(this)), this._previewMenu.actor);

        this.connect('notify::hover', () => this._onHover());
        this.connect('clicked', () => this.hideLabel());
        this.connect('destroy', () => this._onDestroy());
    }

    _previewMenuCapturedEvent(actor, event){
        let menu = actor._delegate;
        const targetActor = global.stage.get_event_actor(event);

        if (event.type() === Clutter.EventType.ENTER &&
                (event.get_flags() & Clutter.EventFlags.FLAG_GRAB_NOTIFY) === 0) {
            let hoveredMenu = this.menuManager._findMenuForSource(targetActor);

            if(targetActor instanceof AppIcon && hoveredMenu && targetActor.getInterestingWindows().length > 0){
                this.appDisplayBar.removeWindowPreviewCloseTimeout();
            }
        }
        else if (event.type() === Clutter.EventType.LEAVE &&
                (event.get_flags() & Clutter.EventFlags.FLAG_GRAB_NOTIFY) === 0) {
            let hoveredMenu = this.menuManager._findMenuForSource(targetActor);

            if((!hoveredMenu || !hoveredMenu.shouldOpen) && !menu.actor.hover){
                this.appDisplayBar.setWindowPreviewCloseTimeout();
            }
        }
    }

    _previewMenuOpenStateChanged(menu, isPoppedUp){
        if (!isPoppedUp){
            this.setForcedHighlight(false);
            this._onMenuPoppedDown();
        }
        else{
            this.hideLabel();
            this.setForcedHighlight(true);
        }
    }

    _onMouseScroll(actor, event) {
        let scrollAction = this._settings.get_enum('scroll-action');

        if(scrollAction === ScrollAction.CYCLE){
            if (!this._scrollTimeOutId) {
                this._scrollTimeOutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                    this._scrollTimeOutId = null;
                    return GLib.SOURCE_REMOVE;
                });

                let windows = this.getInterestingWindows();
                if(windows.length <= 1)
                    return;

                this._removePreviewMenuTimeout();
                this._removeMenuTimeout();
                this.hideLabel();
                let isScroll = true;
                this._cycleWindows(windows, isScroll);
            }
        }
        else
            return;
    }

    _onDestroy(){
        this.stopAllAnimations();

        this._menu?.close();
        this._previewMenu?.close();

        if (this._scrollTimeOutId) {
            GLib.source_remove(this._scrollTimeOutId);
            this._scrollTimeOutId = null;
        }

        this._connections.forEach((object, id) => {
            object.disconnect(id);
            id = null;
        });
        this._connections = null;

        this._previewMenu?.destroy();

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
    }

    animateLaunch(){
        IconGrid.zoomOutActor(this.appIcon);
    }

    /**
    * Update target for minimization animation
    * Credit: Dash to Dock
    * https://github.com/micheleg/dash-to-dock/blob/master/appIcons.js
    */
    updateIconGeometry() {
        if (this.get_stage() === null)
            return;

        this.get_allocation_box();
        let rect = new Meta.Rectangle();

        [rect.x, rect.y] = this.get_transformed_position();
        [rect.width, rect.height] = this.get_transformed_size();

        let windows = this.getInterestingWindows();
        windows.forEach(w => {
            w.set_icon_geometry(rect);
        });
    }

    _setIndicatorLocation(){
        const indicatorLocation = this._settings.get_enum('indicator-location');

        if(this.indicator)
            this.indicator.style = null;

        if(indicatorLocation === IndicatorLocation.TOP)
            this.indicator = this.indicatorTop;
        else
            this.indicator = this.indicatorBottom;

        this.setActiveState();
    }

    stopAllAnimations(){
        this.indicator.style += 'transition-duration: 0ms;';
        this.appIcon.style = 'transition-duration: 0ms;';
        this.indicator.remove_all_transitions();
        this.appIcon.remove_all_transitions();
    }

    getDragActor() {
        return this.app.create_icon_texture(this._settings.get_int('icon-size') * 1.5);
    }

    getDragActorSource() {
        return this;
    }

    _onDragBegin() {
        this.stopAllAnimations();

        this.newIndex = -1;

        this._removePreviewMenuTimeout();
        this._removeMenuTimeout();
        this.hideLabel();
        this._dragging = true;

        this._dragMonitor = {
            dragMotion: this._onDragMotion.bind(this),
        };
        DND.addDragMonitor(this._dragMonitor);

        this.opacity = 105;
        Main.overview.beginItemDrag(this);
    }

    _onDragMotion(dragEvent) {
        let parentBox = this.get_parent();

        let [x, y] = parentBox.get_transformed_position();

        const deltaX = dragEvent.x - x;
        const appIconMargin = 2;

        this.index = Math.ceil((deltaX) / (this.width + appIconMargin));
        if(this.newIndex < 0)
            this.newIndex = this.index;

        this.index = Math.min(Math.max(this.index, 0), parentBox.get_n_children() - 1);

        const itemAtIndex = parentBox.get_child_at_index(this.index);

        if(itemAtIndex.monitorIndex !== this.monitorIndex)
            return DND.DragMotionResult.CONTINUE;

        if(itemAtIndex.isFavorite)
            return DND.DragMotionResult.CONTINUE;

        if(this.newIndex === this.index)
            return DND.DragMotionResult.CONTINUE;

        if(itemAtIndex instanceof AppIcon){
            this.newIndex = this.index;
            parentBox.remove_child(this);
            parentBox.insert_child_at_index(this, this.index);
            this.positionIndex = this.index;
        }

        return DND.DragMotionResult.CONTINUE;
    }

    _onDragCancelled() {
        this.indicator.style.replace('transition-duration: 0ms;', '');
        this.appIcon.style = null;
        this._dragging = false;
        Main.overview.cancelledItemDrag(this);
        this.updateIconGeometry();
    }

    _onDragEnd() {
        this.indicator.style.replace('transition-duration: 0ms;', '');
        this.appIcon.style = null;
        this._dragging = false;
        this.undoFade();

        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        Main.overview.endItemDrag(this);
        this.updateIconGeometry();
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
        let indicatorWidth = INDICATOR_RUNNING_WIDTH;

        let windows = this.getInterestingWindows();

        if(windows.length >= 1){
            indicatorColor = this._settings.get_string('indicator-color-running');
            windows.forEach(window => {
                if(window.has_focus()){
                    if(windows.length > 1)
                        this.overlayWidget.show();
                    this.appIcon.add_style_pseudo_class('active');
                    indicatorWidth = INDICATOR_FOCUSED_WIDTH;
                    indicatorColor = this._settings.get_string('indicator-color-focused');
                }
            });
        }

        if(!this._settings.get_boolean('indicators'))
            indicatorColor = 'transparent';

        this.indicator.style = `background-color: ${indicatorColor};`;
        this.indicator.ease({
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
        this._cycleWindowList?.forEach(window => {
            delete window.cycled;
        });
    }

    _resetCycleWindows(){
        if (this._cycleWindowList && this._cycleWindowList.length !== this.getInterestingWindows().length) {
            this._clearCycleWindow();
            this._cycleWindowList = null;
        }
    }

    _setCylceWindowsTimeout(windows) {
        this._removeCylceWindowsTimeout();

        this._cylceWindowsTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this._cylceWindowsTimeoutId = 0;
            this._clearCycleWindow();
            this._cycleWindowList = null;
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._cylceWindowsTimeoutId, '[azTaskbar] cycleWindows');
    }

    _cycleWindows(windows, scroll){
        const clickActionSetting = this._settings.get_enum('click-action');
        const cycleMinimize = clickActionSetting === ClickAction.CYCLE_MINIMIZE && !scroll;
        const cycle = clickActionSetting === ClickAction.CYCLE || scroll;
        if(cycleMinimize || cycle){
            //start a timer that clears cycle state after x amount of time
            this._setCylceWindowsTimeout();

            if(!this._cycleWindowList)
                this._cycleWindowList = windows;

            let cycled = this._cycleWindowList.filter(window => {
                if(window.cycled)
                    return window;
            });
            if(cycled.length === this._cycleWindowList.length){
                this._cycleWindowList.forEach(window => {
                    if(cycleMinimize)
                        window.minimize();
                    window.cycled = false;
                });
                if(cycleMinimize)
                    return true;
            }
            for(let i = 0; i < this._cycleWindowList.length; i++){
                let window = this._cycleWindowList[i];
                if(window.has_focus() && !window.cycled){
                    window.cycled = true;
                }
                if(!window.cycled){
                    window.cycled = true;
                    Main.activateWindow(window);
                    break;
                }
            }
            return true;
        }
        return false;
    }

    activate(button) {
        let event = Clutter.get_current_event();
        let modifiers = event ? event.get_state() : 0;
        let windows = this.getInterestingWindows();
        let isMiddleButton = button && button === Clutter.BUTTON_MIDDLE;
        let isCtrlPressed = (modifiers & Clutter.ModifierType.CONTROL_MASK) != 0;
        let openNewWindow = this.app.can_open_new_window() &&
                            this.app.state === Shell.AppState.RUNNING &&
                            (isCtrlPressed || isMiddleButton);

        Main.overview.hide();

        if (this.app.state === Shell.AppState.STOPPED || openNewWindow)
            IconGrid.zoomOutActor(this.appIcon);

        if (openNewWindow)
            this.app.open_new_window(-1);
        else{
            if(windows.length > 1){
                if(!this._cycleWindows(windows)){
                    this._removePreviewMenuTimeout();
                    this._removeMenuTimeout();
                    this.hideLabel();
                    this._previewMenu?.popup();
                }
            }
            else if(windows.length === 1){
                const window = windows[0];
                if(window.minimized || !window.has_focus())
                    Main.activateWindow(window);
                else
                    window.minimize();
            }
            //a favorited app is running, but no interesting windows on current workspace/monitor
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
            if(this.getInterestingWindows().length >= 1 && this.app.state == Shell.AppState.RUNNING){
                this._setPreviewPopupTimeout();
                if(shellVersion < 42 && this.menuManager.activeMenu)
                    this.appDisplayBar.removeWindowPreviewCloseTimeout();
            }
            if(!this.menuManager.activeMenu)
                this.showLabel();
        }
        else {
            if(shellVersion < 42 && this.menuManager.activeMenu)
                this.appDisplayBar.setWindowPreviewCloseTimeout();
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
        if (this._previewMenu?.isOpen)
            return;
        else{
            this._removeMenuTimeout();

            this._previewMenu?.popup();
        }
    }

    showLabel() {
        if(!this._settings.get_boolean('tool-tips'))
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

        this.tooltipLabel.remove_all_transitions();
        this.tooltipLabel.set_position(x, y);
        this.tooltipLabel.ease({
            opacity: 255,
            duration: 250,
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

var IndicatorLocation = {
    TOP: 0,
    BOTTOM: 1
}

var ClickAction = {
    CYCLE: 0,
    CYCLE_MINIMIZE: 1,
    PREVIEW: 2
}

var ScrollAction = {
    CYCLE: 0,
    NO_ACTION: 1
}
