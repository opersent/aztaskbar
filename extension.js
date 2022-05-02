const { Clutter, Gio, GLib, GObject, Meta, Shell, St } = imports.gi;

const { AppMenu } = imports.ui.appMenu;
const AppFavorites = imports.ui.appFavorites;
const BoxPointer = imports.ui.boxpointer;
const DND = imports.ui.dnd;
const ExtensionUtils = imports.misc.extensionUtils;
const IconGrid = imports.ui.iconGrid;
const Main = imports.ui.main;
const Me = ExtensionUtils.getCurrentExtension();
const PopupMenu = imports.ui.popupMenu;
const { WindowPreviewMenu } = Me.imports.windowPreview;

let settings, appDisplayBox, extensionConnections;

const INDICATOR_RUNNING_WIDTH = 7;
const INDICATOR_FOCUSED_WIDTH = 13;

var AppDisplayBox = GObject.registerClass(
class azTaskbar_AppDisplayBox extends St.ScrollView {
    _init(settings) {
        super._init({
            style_class: 'hfade'
        });
        this.set_policy(St.PolicyType.EXTERNAL, St.PolicyType.NEVER);

        this._settings = settings;
        this.mainBox = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        })
        this.clip_to_allocation = true;
        this.add_actor(this.mainBox);
        this._workId = Main.initializeDeferredWork(this, this._redisplay.bind(this));
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this._appSystem = Shell.AppSystem.get_default();
        this.oldAppIcons = new Map();
        this.peekInitialWorkspaceIndex = -1;

        this._connections = new Map();
        this._connections.set(this._settings.connect('changed::isolate-workspaces', () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::isolate-monitors', () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::favorites', () => this._queueRedisplay()), this._settings);
        this._connections.set(this._settings.connect('changed::icon-size', () => this._queueRedisplay()), this._settings);
        this._connections.set(AppFavorites.getAppFavorites().connect('changed', () => this._queueRedisplay()), AppFavorites.getAppFavorites());
        this._connections.set(this._appSystem.connect('app-state-changed', () => this._queueRedisplay()), this._appSystem);
        this._connections.set(this._appSystem.connect('installed-changed', () => {
            AppFavorites.getAppFavorites().reload();
            this._queueRedisplay();
        }), this._appSystem);
        this._connections.set(global.window_manager.connect('switch-workspace', () => this._queueRedisplay()), global.window_manager);
        this._connections.set(global.display.connect('window-entered-monitor', this._queueRedisplay.bind(this)), global.display);
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

        let appIcon = new AppIcon(this, app, monitorIndex, positionIndex, isFavorite);
        appIcon.isSet = true;
        this.oldAppIcons.set(appID, appIcon);
        return appIcon;
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
            else{
                this.mainBox.remove_child(actor);
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

            //if both Favorites and Isolate Monitors enabled, only show favs in primary monitor section
            let showFavorites = this._settings.get_boolean('favorites') &&
                (isolateMonitors ? monitorIndex === Main.layoutManager.primaryIndex : true);

            let running = this._getRunningApps();

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
                        this.mainBox.insert_child_at_index(item, positionIndex);
                    }

                    positionIndex++;
                });
            }
        }

        this.oldAppIcons.forEach((appIcon, appID) => {
            if(appIcon.isSet){
                appIcon.updateIconGeometry();
                appIcon.setActiveState();
                appIcon.setIconSize(this._settings.get_int('icon-size'));
            }
            else{
                this.oldAppIcons.delete(appID);
                appIcon.destroy();
            }
        });

        let children = this.mainBox.get_children();
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
                this.mainBox.insert_child_at_index(separator, i);
            }
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

        this.oldAppIcons.forEach((appIcon, appID) => {
            appIcon.stopAllAnimations();
            appIcon.destroy();
            this.oldAppIcons.delete(appID);
        });
        this.oldAppIcons = null;
    }
});

var AppIcon = GObject.registerClass(
class azTaskbar_AppIcon extends St.Button {
    _init(appDisplayBox, app, monitorIndex, positionIndex, isFavorite) {
        super._init({
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
        });

        this.appDisplayBox = appDisplayBox;
        this.app = app;
        this.menuManager = appDisplayBox.menuManager;
        this.monitorIndex = monitorIndex;
        this.positionIndex = positionIndex;
        this._settings = appDisplayBox._settings;
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

        this.appIcon = new St.Bin({
            reactive: true,
            can_focus: true,
            track_hover: true,
            style_class: 'azTaskbar-AppButton',
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL
        });
        this.bind_property('hover', this.appIcon, 'hover', GObject.BindingFlags.SYNC_CREATE);
        box.add_child(this.appIcon);

        this.desaturateEffect = new Clutter.DesaturateEffect();
        this.appIcon.add_effect(this.desaturateEffect);
        this._setDesaturateEffect();

        this.indicatorBottom = new St.Widget({
            style_class: 'azTaskbar-indicator',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });
        box.add_child(this.indicatorBottom);

        this.multiWindowIndicator = new St.Icon({
            icon_name: 'list-add-symbolic',
            icon_size: 5,
            style_class: 'azTaskbar-multi-window-indicator',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        this.multiWindowIndicator.hide();

        let overlayGroup = new Clutter.Actor({
            layout_manager: new Clutter.BinLayout(),
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        overlayGroup.add_actor(box);
        overlayGroup.add_actor(this.multiWindowIndicator);

        this.set_child(overlayGroup);

        this.tooltipLabel = new St.Label({
            style_class: 'dash-label azTaskbar-Tooltip',
            text: app.get_name()
        });
        this.tooltipLabel.hide();
        Main.layoutManager.addChrome(this.tooltipLabel);

        this._menu = null;
        this._menuTimeoutId = 0;

        this._previewMenu = new WindowPreviewMenu(this, this.menuManager);
        this.menuManager.addMenu(this._previewMenu);

        this._setIndicatorLocation();
        this.updateIcon();

        this._connections = new Map();
        this._connections.set(this._settings.connect('changed::multi-window-indicator', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicators', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-location', () => this._setIndicatorLocation()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-running', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-focused', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::desaturation-factor', () => this._setDesaturateEffect()), this._settings);
        this._connections.set(global.display.connect('notify::focus-window', () => this.setActiveState()), global.display);
        this._connections.set(this.app.connect('windows-changed', () => this._resetCycleWindows()), this.app);
        this._connections.set(this.connect('scroll-event', this._onMouseScroll.bind(this)), this);
        this._connections.set(this._previewMenu.connect('open-state-changed', this._previewMenuOpenStateChanged.bind(this)), this._previewMenu);

        this.connect('notify::hover', () => this._onHover());
        this.connect('clicked', () => this.hideLabel());
        this.connect('destroy', () => this._onDestroy());
    }

    _setDesaturateEffect(){
        this.desaturateEffect.factor = this._settings.get_double('desaturation-factor');
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

        let direction;

        switch (event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP:
            case Clutter.ScrollDirection.LEFT:
                direction = 'up';
                break;
            case Clutter.ScrollDirection.DOWN:
            case Clutter.ScrollDirection.RIGHT:
                direction = 'down';
                break;
        }

        if(scrollAction === ScrollAction.CYCLE && direction){
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
                this._cycleWindows(windows, direction);
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

    updateIcon(){
        let iconSize = this._settings.get_int('icon-size');
        this.appIcon.remove_style_class_name('azTaskbar-symbolic-icon');
        let appIconStyle = this._settings.get_enum('icon-style');
        if(appIconStyle === AppIconStyle.SYMBOLIC)
            this.appIcon.add_style_class_name('azTaskbar-symbolic-icon');
        
        this.appIcon.set_child(this.app.create_icon_texture(iconSize))
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

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;

        this.appIconState = AppIconState.NOT_RUNNING;
        this.appIcon.style = null;
        this.appIcon.set_style_pseudo_class(null);
        let indicatorColor = 'transparent';
        let indicatorWidth = INDICATOR_RUNNING_WIDTH;

        let windows = this.getInterestingWindows();
        if(windows.length >= 1){
            this.appIconState = AppIconState.RUNNING;
            indicatorColor = this._settings.get_string('indicator-color-running');
            windows.forEach(window => {
                if(windows.length > 1 && !this.multiWindowIndicator.visible)
                    this._showMultiWindowIndicator();
                if(window.has_focus()){
                    this.appIconState = AppIconState.FOCUSED;
                    ensureActorVisibleInScrollView(this.appDisplayBox, this);
                    this.appIcon.add_style_pseudo_class('active');
                    indicatorWidth = INDICATOR_FOCUSED_WIDTH;
                    indicatorColor = this._settings.get_string('indicator-color-focused');
                }
            });
        }
        //hide the multiwindow indicator if app icon no longer focused,
        //or app has 1 or 0 windows.
        if(windows.length <= 1 && this.multiWindowIndicator.visible)
            this._hideMultiWindowIndicator();

        if(!this._settings.get_boolean('multi-window-indicator') && this.multiWindowIndicator.visible)
            this._hideMultiWindowIndicator();

        if(!this._settings.get_boolean('indicators'))
            indicatorColor = 'transparent';

        //Some visual glitches occur during easing of the indicator width
        //when the condition below is met. Offset the width of the indicator
        //by 1px in this case.
        let offset = (this._settings.get_int('icon-size') % 2) === (INDICATOR_RUNNING_WIDTH % 2) ? 1 : 0;
        indicatorWidth -= offset;

        this.indicator.remove_all_transitions();
        this.indicator.style = `background-color: ${indicatorColor};`;
        this.indicator.ease({
            width: indicatorWidth * scaleFactor,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
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

        this._previewMenuTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._settings.get_int('window-previews-show-timeout'), () => {
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
            }), this._menu);

            Main.uiGroup.add_actor(this._menu.actor);
            this._contextMenuManager.addMenu(this._menu);
        }

        this._menu.open();
        this.setForcedHighlight(true);
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

    _cycleWindows(windows, scrollDirection){
        windows = windows.sort((a, b) => {
            return a.get_stable_sequence() > b.get_stable_sequence();
        });

        const clickActionSetting = this._settings.get_enum('click-action');
        const cycleMinimize = clickActionSetting === ClickAction.CYCLE_MINIMIZE;
        const cycle = clickActionSetting === ClickAction.CYCLE;
        if(scrollDirection){
            //mouse scroll cycle window logic borrowed from Dash to Panel
            //https://github.com/home-sweet-gnome/dash-to-panel/blob/master/utils.js#L415-L430
            let windowIndex = windows.indexOf(global.display.focus_window);
            let nextWindowIndex = windowIndex < 0 ? 0 :
                                  windowIndex + (scrollDirection == 'up' ? -1 : 1);

            if(nextWindowIndex === windows.length)
                nextWindowIndex = 0;
            else if(nextWindowIndex < 0)
                nextWindowIndex = windows.length - 1;

            if(windowIndex != nextWindowIndex)
                Main.activateWindow(windows[nextWindowIndex]);
            return true;
        }
        else if(cycleMinimize || cycle){
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
            let windowCount = this.getInterestingWindows().length;
            if(windowCount >= 1)
                this._setPreviewPopupTimeout();
            if(!this.menuManager.activeMenu)
                this.showLabel();
            ensureActorVisibleInScrollView(this.appDisplayBox, this);
        }
        else {
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

    _showMultiWindowIndicator(){
        if(!this._settings.get_boolean('multi-window-indicator'))
            return;

        this.multiWindowIndicator.opacity = 0;
        this.multiWindowIndicator.show();
        this.multiWindowIndicator.remove_all_transitions()
        this.multiWindowIndicator.ease({
            opacity: 255,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _hideMultiWindowIndicator() {
        this.multiWindowIndicator.remove_all_transitions()
        this.multiWindowIndicator.ease({
            opacity: 0,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.multiWindowIndicator.hide(),
        });
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
        const labelHeight = this.tooltipLabel.get_height();
        const xOffset = Math.floor((itemWidth - labelWidth) / 2);
        const x = Math.clamp(stageX + xOffset, 0, global.stage.width - labelWidth);

        const offset = 6;
        let y;

        //Check if should place tool-tip above or below app icon
        //Needed in case user has moved the panel to bottom of screen
        let labelBelowIconRect = new Meta.Rectangle({
            x,
            y: stageY + itemHeight + offset,
            width: labelWidth,
            height: labelHeight
        });

        let monitorIndex = Main.layoutManager.findIndexForActor(this);
        let workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);

        if(workArea.contains_rect(labelBelowIconRect))
            y = labelBelowIconRect.y;
        else
            y = stageY - labelHeight - offset;

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
    if(Meta.is_wayland_compositor())
        Me.metadata.isWayland = true;
    else
        Me.metadata.isWayland = false;

    settings = ExtensionUtils.getSettings();

    Me.customStylesheet = getStylesheetFile();
    updateStylesheet();

    extensionConnections = new Map();
    extensionConnections.set(settings.connect('changed::position-in-panel', () => addAppBoxToPanel(true)), settings);
    extensionConnections.set(settings.connect('changed::position-offset', () => addAppBoxToPanel(true)), settings);
    extensionConnections.set(settings.connect('changed::main-panel-height', () => updateStylesheet()), settings);

    appDisplayBox = new AppDisplayBox(settings);
    addAppBoxToPanel();

    extensionConnections.set(settings.connect('changed::icon-style', () => appDisplayBox.updateIcon()), settings);
    Main.panel.statusArea.appMenu.container.hide();
    Main.panel.add_style_class_name("azTaskbar-panel");
}

function disable() {
    if (!Main.overview.visible && !Main.sessionMode.isLocked)
        Main.panel.statusArea.appMenu.container.show();

    Main.panel.remove_style_class_name("azTaskbar-panel");

    unloadStylesheet();
    delete Me.customStylesheet;

    extensionConnections.forEach((object, id) => {
        object.disconnect(id);
        id = null;
    });
    extensionConnections = null;

    appDisplayBox.destroy();
    appDisplayBox = null;
    settings.run_dispose();
    settings = null;
}

function init() {
    ExtensionUtils.initTranslations(Me.metadata['gettext-domain']);
}

function addAppBoxToPanel(redisplay){
    if(redisplay){
        appDisplayBox.destroy();
        appDisplayBox = new AppDisplayBox(settings);
    }

    const offset = settings.get_int('position-offset');

    if(settings.get_enum('position-in-panel') === PanelPosition.LEFT)
        Main.panel._leftBox.insert_child_at_index(appDisplayBox, offset);
    else if(settings.get_enum('position-in-panel') === PanelPosition.CENTER)
        Main.panel._centerBox.insert_child_at_index(appDisplayBox, offset);
    else if(settings.get_enum('position-in-panel') === PanelPosition.RIGHT){
        let nChildren = Main.panel._rightBox.get_n_children();
        const order = Math.clamp(nChildren - offset, 0, nChildren);
        Main.panel._rightBox.insert_child_at_index(appDisplayBox, order);
    }
}

function updateStylesheet(){
    let [overridePanelHeight, panelHeight] = settings.get_value('main-panel-height').deep_unpack();
    let stylesheet = Me.customStylesheet;

    if(!stylesheet){
        log("azTaskbar - Custom stylesheet error!");
        return;
    }

    let customStylesheetCSS = overridePanelHeight ?
                                `.azTaskbar-panel{
                                    height: ${panelHeight}px;
                                }`
                            : null;

    if(!customStylesheetCSS){
        unloadStylesheet();
        return;
    }

    try{
        let bytes = new GLib.Bytes(customStylesheetCSS);

        stylesheet.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (stylesheet, res) => {
            if(!stylesheet.replace_contents_finish(res))
                throw new Error("azTaskbar - Error replacing contents of custom stylesheet file.");

            let theme = St.ThemeContext.get_for_stage(global.stage).get_theme();

            unloadStylesheet();
            Me.customStylesheet = stylesheet;
            theme.load_stylesheet(Me.customStylesheet);

            return true;
        });
    }
    catch(e){
        log("azTaskbar - Error updating custom stylesheet. " + e.message);
        return false;
    }
}

function getStylesheetFile(){
    let stylesheet = Gio.File.new_for_path(GLib.get_home_dir() + "/.local/share/azTaskbar/stylesheet.css");

    if(!stylesheet.query_exists(null)){
        GLib.spawn_command_line_sync("mkdir " + GLib.get_home_dir() + "/.local/share/azTaskbar");
        GLib.spawn_command_line_sync("touch " + GLib.get_home_dir() + "/.local/share/azTaskbar/stylesheet.css");
        stylesheet = Gio.File.new_for_path(GLib.get_home_dir() + "/.local/share/azTaskbar/stylesheet.css");
    }

    return stylesheet;
}

function unloadStylesheet(){
    if(!Me.customStylesheet)
        return;

    let theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    theme.unload_stylesheet(Me.customStylesheet);
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

/**
 * Adapted from GNOME Shell. Modified to work with a horizontal scrollView
 */
function ensureActorVisibleInScrollView(scrollView, actor) {
    let adjustment = scrollView.hscroll.adjustment;
    let [value, lower_, upper, stepIncrement_, pageIncrement_, pageSize] = adjustment.get_values();

    let offset = 0;
    let hfade = scrollView.get_effect("fade");
    if (hfade)
        offset = hfade.fade_margins.left;

    let box = actor.get_allocation_box();
    let x1 = box.x1, x2 = box.x2;

    let parent = actor.get_parent();
    while (parent != scrollView) {
        if (!parent)
            throw new Error("actor not in scroll view");

        box = parent.get_allocation_box();
        x1 += box.x1;
        x2 += box.x1;
        parent = parent.get_parent();
    }

    if (x1 < value + offset)
        value = Math.max(0, x1 - offset);
    else if (x2 > value + pageSize - offset)
        value = Math.min(upper, x2 + offset - pageSize);
    else
        return;

    adjustment.ease(value, {
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        duration: 100,
    });
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

var PanelPosition = {
    LEFT: 0,
    CENTER: 1,
    RIGHT: 2,
}

var AppIconState = {
    RUNNING: 0,
    FOCUSED: 1,
    NOT_RUNNING: 2,
}

var AppIconStyle = {
    REGULAR: 0,
    SYMBOLIC: 1,
}
