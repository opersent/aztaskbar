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
const Theming = Me.imports.theming;
const { WindowPreviewMenu } = Me.imports.windowPreview;

let settings, appDisplayBox, extensionConnections, currentMonitorIndex;
let tracker = Shell.WindowTracker.get_default();

const MAX_MULTI_DASHES = 3;

function getDropTarget(box, x){
    const hSpacing = 1;
    const visibleItems = box.get_children();
    for (const item of visibleItems) {
        const childBox = item.allocation.copy();
        childBox.set_origin(childBox.x1 % box.width, childBox.y1);
        if (x < childBox.x1 - hSpacing ||
            x > childBox.x2 + hSpacing)
            continue;

        return { item: item, index: visibleItems.indexOf(item) };
    }

    return { item: null, index: -1 };
}

function debugLog(appName, msg){
    if(appName === "Files")
        log(`${appName} ${msg}`);
}

var AppDisplayBox = GObject.registerClass(
class azTaskbar_AppDisplayBox extends St.ScrollView {
    _init(settings) {
        super._init({
            style_class: 'hfade'
        });
        this.set_policy(St.PolicyType.EXTERNAL, St.PolicyType.NEVER);

        this._settings = settings;
        this.showAppsIcon = new ShowAppsIcon(this._settings);
        this.mainBox = new St.BoxLayout({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        })
        this.mainBox._delegate = this;
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
        this._connections.set(this._settings.connect('changed::show-apps-button', () => this._queueRedisplay()), this._settings);
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

        this._dragPlaceholder = null;
        this._dragPlaceholderPos = -1;
        this._animatingPlaceholdersCount = 0;
    }

    getAppFromSource(source) {
        if (source instanceof AppIcon)
            return source.app;
        else
            return null;
    }

    getFavoritesIndicies(){
        const children = this.mainBox.get_children();
        let appFavoritesIdicies = [];
        children.map(child => {
            if(child.isFavorite)
                appFavoritesIdicies.push(children.indexOf(child));
        });
        return appFavoritesIdicies;
    }

    handleDragOver(source, actor, x, _y, _time){
        const indexRange = this.getFavoritesIndicies();
        const firstFavIndex = indexRange[0];
        const lastFavIndex = indexRange[indexRange.length - 1];

        let app = this.getAppFromSource(source);

        // Don't allow favoriting of transient apps
        if (app == null || app.is_window_backed())
            return DND.DragMotionResult.NO_DROP;

        if (!global.settings.is_writable('favorite-apps'))
            return DND.DragMotionResult.NO_DROP;

        let favorites = AppFavorites.getAppFavorites().getFavorites();

        let favPos = favorites.indexOf(app);

        let children = this.mainBox.get_children();
        let numChildren = children.length;
        let boxWidth = this.mainBox.width;

        // Keep the placeholder out of the index calculation; assuming that
        // the remove target has the same size as "normal" items, we don't
        // need to do the same adjustment there.
        if (this._hasPlaceHolder) {
            boxWidth -= this._dragPlaceholder.width;
            numChildren--;
        }

        let pos;
        if (this._emptyDropTarget)
            pos = firstFavIndex;
        else
            pos = Math.max(Math.floor(x * numChildren / boxWidth), firstFavIndex - 1)

        // Put the placeholder after the last favorite if we are not
        // in the favorites zone
        if (pos > lastFavIndex)
            pos = lastFavIndex + 1;

        if (pos !== this._dragPlaceholderPos && this._animatingPlaceholdersCount === 0) {
            this._dragPlaceholderPos = pos;

            // Don't allow positioning before or after self
            if (favPos != -1 && (pos == favPos || pos == favPos + 1)) {
                this.clearDragPlaceholder();
                return DND.DragMotionResult.CONTINUE;
            }

            // If the placeholder already exists, we just move
            // it, but if we are adding it, expand its size in
            // an animation
            let fadeIn;
            if (this._dragPlaceholder) {
                this._hasPlaceHolder = false;
                this._dragPlaceholder.destroy();
                fadeIn = false;
            } else {
                fadeIn = true;
            }

            this._dragPlaceholder = new imports.ui.dash.DragPlaceholderItem();
            this._dragPlaceholder.add_style_class_name('azTaskbar-favorite');

            let x = source.dragPos === firstFavIndex ? 1 : 0
            this._dragPlaceholder.pivot_point = new imports.gi.Graphene.Point({ x, y: .5 });

            this._dragPlaceholder.scale_y = 1;
            this._dragPlaceholder.opacity = 255;
            let iconSize = this._settings.get_int('icon-size');
            this._dragPlaceholder.child.set_width(iconSize + 10);
            this._dragPlaceholder.child.set_height(iconSize / 2);
            this.mainBox.insert_child_at_index(this._dragPlaceholder,
                                            this._dragPlaceholderPos);
            this._dragPlaceholder.show(fadeIn);
            this._hasPlaceHolder = true;
        }

        if (!this._dragPlaceholder)
            return DND.DragMotionResult.NO_DROP;

        let srcIsFavorite = source.dragPos < firstFavIndex - 1 || source.dragPos > lastFavIndex + 1 || source.isFavorite;

        if (srcIsFavorite)
            return DND.DragMotionResult.MOVE_DROP;

        return DND.DragMotionResult.COPY_DROP;
    }

    clearDragPlaceholder() {
        this._hasPlaceHolder = false;
        if (this._dragPlaceholder) {
            this._animatingPlaceholdersCount++;
            this._dragPlaceholder.animateOutAndDestroy();
            this._dragPlaceholder.connect('destroy', () => {
                this._animatingPlaceholdersCount--;
            });
            this._dragPlaceholder = null;
        }
        this._dragPlaceholderPos = -1;
    }

    acceptDrop(source, _actor, x, _y, _time){
        let app = this.getAppFromSource(source);

        source.opacity = 255;
        // Don't allow favoriting of transient apps
        if (app == null || app.is_window_backed())
            return false;

        if (!global.settings.is_writable('favorite-apps'))
            return false;

        let id = app.get_id();

        let favorites = AppFavorites.getAppFavorites().getFavoriteMap();

        let srcIsFavorite = id in favorites;

        let favPos = 0;
        let children = this.mainBox.get_children();

        for (let i = 0; i < this._dragPlaceholderPos; i++) {
            if (this._dragPlaceholder &&
                children[i] == this._dragPlaceholder)
                continue;

            let childId = children[i]._delegate.app?.get_id();
            if (childId == id)
                continue;
            if (childId in favorites)
                favPos++;
        }

        if (getDropTarget(this.mainBox, x).index !== this._dragPlaceholderPos)
            return true;

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, () => {
            let appFavorites = AppFavorites.getAppFavorites();
            if (srcIsFavorite)
                appFavorites.moveFavoriteToPos(id, favPos);
            else
                appFavorites.addFavoriteAtPos(id, favPos);

            return false;
        });

        return true;
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
        let monitorsCount = isolateMonitors ? Main.layoutManager.monitors.length : 1;
        let sortedMonitors = this._sortMonitors();
        let positionIndex = 0;
        for(let i = 0; i < monitorsCount; i++){
            let monitorIndex = sortedMonitors[i].index;

            let oldApps = this.oldApps.filter(oldApp => {
                if(oldApp.monitorIndex === monitorIndex)
                    return oldApp;
            })
            let newApps = [];

            let appFavorites = AppFavorites.getAppFavorites();
            let favorites = appFavorites.getFavoriteMap();

            //if both Favorites and Isolate Monitors enabled, show favorites first.
            let showFavorites = this._settings.get_boolean('favorites') &&
                (isolateMonitors ? i === 0 : true);

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
                appIcon.updateAppIcon();
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

        let [showAppsButton, showAppsButtonPosition] = this._settings.get_value('show-apps-button').deep_unpack();
        if(showAppsButton){
            if(showAppsButtonPosition === ShowAppsButtonPosition.LEFT)
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

var BaseButton = GObject.registerClass(
class azTaskbar_BaseButton extends St.Button {
    _init(settings) {
        super._init({
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
        });
        this._settings = settings;

        this._delegate = this;
        this._box = new St.BoxLayout({
            reactive: true,
            can_focus: true,
            track_hover: true,
            style_class: 'azTaskbar-BaseIcon',
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL
        });
        this.bind_property('hover', this._box, 'hover', GObject.BindingFlags.SYNC_CREATE);

        this._iconBin = new St.Bin({
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL
        });
        this._box.add_child(this._iconBin);

        this._label = new St.Label({
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._box.add_child(this._label);
        this._label.hide();

        this._overlayGroup = new Clutter.Actor({
            layout_manager: new Clutter.BinLayout(),
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._overlayGroup.add_actor(this._box);

        this.set_child(this._overlayGroup);

        this.connect('notify::hover', () => this._onHover());
        this.connect('notify::pressed', () => this._onPressed());
        this.connect('clicked', () => this._onClicked());
        this.connect('destroy', () => this._onDestroy());

        this.tooltipLabel = new St.Label({
            style_class: 'dash-label azTaskbar-Tooltip',
        });
        this.tooltipLabel.hide();
        Main.layoutManager.addChrome(this.tooltipLabel);
    }

    updateIcon(){
        throw new GObject.NotImplementedError();
    }

    _onHover()  {
        throw new GObject.NotImplementedError();
    }

    _onPressed()  {
        if(this.pressed){
            this._box.add_style_class_name('pressed');
        }
        else{
            this._box.remove_style_class_name('pressed');
        }
    }

    _onClicked() {
        throw new GObject.NotImplementedError();
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
        const offset = 6;
        const xOffset = Math.floor((itemWidth - labelWidth) / 2);

        let monitorIndex = Main.layoutManager.findIndexForActor(this);
        let workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);

        let x, y;
        x = Math.clamp(stageX + xOffset, 0 + offset, workArea.x + workArea.width - labelWidth - offset);

        //Check if should place tool-tip above or below app icon
        //Needed in case user has moved the panel to bottom of screen
        let labelBelowIconRect = new Meta.Rectangle({
            x,
            y: stageY + itemHeight + offset,
            width: labelWidth,
            height: labelHeight
        });

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

    _onDestroy(){
        this.tooltipLabel.remove_all_transitions();
        this.tooltipLabel.hide();
        this.tooltipLabel.destroy();

        if(this._showWindowTitleId){
            this._settings.disconnect(this._showWindowTitleId);
            this._showWindowTitleId = null;
        }
    }
});

var ShowAppsIcon = GObject.registerClass(
class azTaskbar_ShowAppsIcon extends BaseButton {
    _init(settings) {
        super._init(settings);

        this.tooltipLabel.text = _('Show Applications');
        this.bind_property('checked', Main.overview.dash.showAppsButton, 'checked', GObject.BindingFlags.BIDIRECTIONAL);
        this.updateIcon();
    }

    _onClicked() {
        this.hideLabel();
        if(Main.overview.visible && this.checked){
            this.checked = false;
            Main.overview.toggle();
        }
        else if(Main.overview.visible && !this.checked)
            this.checked = true;
        else{
            Main.overview.toggle();
            this.checked = true;
        }
    }

    updateIcon(){
        const icon_size = this._settings.get_int('icon-size');
        let icon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: icon_size,
        });
        this._iconBin.set_child(icon);
    }

    _onHover() {
        if(this.hover)
            this.showLabel();
        else
            this.hideLabel();
    }
});

var AppIcon = GObject.registerClass(
class azTaskbar_AppIcon extends BaseButton {
    _init(appDisplayBox, mainBox, app, monitorIndex, positionIndex, isFavorite) {
        super._init(appDisplayBox._settings);

        this.appDisplayBox = appDisplayBox;
        this.mainBox = mainBox;
        this.app = app;
        this.menuManager = appDisplayBox.menuManager;
        this.monitorIndex = monitorIndex;
        this.positionIndex = positionIndex;
        this.isFavorite = isFavorite;
        this._contextMenuManager = new PopupMenu.PopupMenuManager(this);
        this._indicatorColor = 'transparent';
        this._indicatorWidth = 1;
        this._draggable = DND.makeDraggable(this, { timeoutThreshold: 200 });
        this._draggable.connect('drag-begin', this._onDragBegin.bind(this));
        this._draggable.connect('drag-cancelled', this._onDragCancelled.bind(this));
        this._draggable.connect('drag-end', this._onDragEnd.bind(this));
        this._animateIndicatorsComplete = true;
        this._runningIndicator = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._overlayGroup.add_actor(this._runningIndicator);

        this._runningIndicator.connect('repaint', () => {
            this._drawRunningIndicator(this._runningIndicator);
        });

        this.desaturateEffect = new Clutter.DesaturateEffect();
        this._iconBin.add_effect(this.desaturateEffect);
        this._setDesaturateEffect();

        this.multiWindowIndicator = new St.Icon({
            icon_name: 'list-add-symbolic',
            style_class: 'azTaskbar-multi-window-indicator',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
        });
        this.multiWindowIndicator.hide();
        this._overlayGroup.add_actor(this.multiWindowIndicator);

        this.tooltipLabel.text = app.get_name();
        this._label.text = app.get_name();

        this._menu = null;
        this._menuTimeoutId = 0;

        this._previewMenu = new WindowPreviewMenu(this, this.menuManager);
        this.menuManager.addMenu(this._previewMenu);

        this.updateIcon();
        this.updateLabel();

        this._connections = new Map();
        this._connections.set(this._settings.connect('changed::multi-window-indicator-style', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::show-window-titles', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicators', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-location', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-running', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-focused', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::desaturation-factor', () => this._setDesaturateEffect()), this._settings);
        this._connections.set(global.display.connect('notify::focus-window', () => this.setActiveState()), global.display);
        this._connections.set(this.app.connect('windows-changed', () => this._resetCycleWindows()), this.app);
        this._connections.set(this.connect('scroll-event', this._onMouseScroll.bind(this)), this);
        this._connections.set(this._previewMenu.connect('open-state-changed', this._previewMenuOpenStateChanged.bind(this)), this._previewMenu);
    }

    _drawRunningIndicator(area){
        let width = this._indicatorGrowWidth ?? this._indicatorWidth;
        let color = Clutter.color_from_string((this._indicatorColor ?? 'transparent'))[1];

        let [areaWidth, areaHeight] = area.get_surface_size();

        let cr = area.get_context();

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let cornerRadius = 1.5 * scaleFactor;
        let radius = cornerRadius;
        let degrees = Math.PI / 180;

        let x = 0;
        let y = ((this._indicatorLocation === IndicatorLocation.TOP) ? 0 : (areaHeight - (radius * 2)) / 2);

        Clutter.cairo_set_source_color(cr, color);

        if(this._animateGrow || this._showMultiDashIndicator){
            let totalWidth = this._startIndicatorWidth;
            cr.translate((areaWidth - totalWidth) / 2, y);
            //draw the previous visible indicators
            for(let i = 0; i < this._indicatorCount; i++){
                cr.newSubPath();
                x = i * this._indicatorWidth + i * this._indicatorSpacing;
                cr.arc(x, y + radius, radius, 90 * degrees, -90 * degrees);
                cr.arc(x + this._indicatorWidth, y + radius, radius, -90 * degrees, 90 * degrees);
                cr.closePath();
            }
            //draw the new indicator
            for(let i = 0; i < this._toDrawCount; i++){
                cr.newSubPath();
                x = totalWidth - this._indicatorWidth;
                cr.arc(x, y + radius, radius, 90 * degrees, -90 * degrees);
                cr.arc(x + this._indicatorWidth, y + radius, radius, -90 * degrees, 90 * degrees);
                cr.closePath();
            }
        }
        else{
            cr.translate((areaWidth - width) / 2, y);
            cr.newSubPath();
            cr.arc(x, y + radius, radius, 90 * degrees, -90 * degrees);
            cr.arc(x + width, y + radius, radius, -90 * degrees, 90 * degrees);
            cr.closePath();
        }
        cr.fill();
        cr.$dispose();
    }

    _setFocused(){
        this.appIconState = AppIconState.FOCUSED;
        ensureActorVisibleInScrollView(this.appDisplayBox, this);
        this._box.add_style_pseudo_class('active');
        currentMonitorIndex = this.monitorIndex;
    }

    setActiveState(){
        this.previousAppIconState = this.appIconState;
        this._previousFocusApp = tracker.focus_app ?? this._previousFocusApp;
        this._previousNWindows = this._nWindows;
        this._indicatorLocation = this._settings.get_enum('indicator-location');

        if(this._dragging || !this.mapped || !this.get_parent()?.mapped)
            return;

        this._box.style = null;

        let showMultiWindowIndicator;

        let windows = this.getInterestingWindows();
        if(windows.length >= 1){
            this._nWindows = windows.length > MAX_MULTI_DASHES ? MAX_MULTI_DASHES : windows.length;
            this.appIconState = AppIconState.RUNNING;
            if(windows.length > 1)
                showMultiWindowIndicator = true;
            if(currentMonitorIndex === this.monitorIndex && this._previousFocusApp === this.app)
                this._setFocused();
            else{
                windows.forEach(window => {
                    if(window.has_focus())
                        this._setFocused();
                });
            }

            if(this.appIconState === AppIconState.RUNNING)
                this._box.set_style_pseudo_class(null);
        }
        else{
            this._box.set_style_pseudo_class(null);
            this.appIconState = AppIconState.NOT_RUNNING;
        }

        this.updateLabel();

        if(this._previousNWindows === undefined)
            this._previousNWindows = this._nWindows;

        this._showMultiDashIndicator = this._settings.get_enum('multi-window-indicator-style') === MultiWindowIndicatorStyle.MULTI_DASH && (this._nWindows > 1 || this._nWindows < this._previousNWindows);

        const needsAnimate = this.appIconState !== AppIconState.NOT_RUNNING && (this.previousAppIconState !== this.appIconState ||
                            (this.previousAppIconState === this.appIconState && this._previousNWindows !== this._nWindows));

        this._setIndicatorColor();

        if(this._settings.get_enum('multi-window-indicator-style') !== MultiWindowIndicatorStyle.INDICATOR || !showMultiWindowIndicator)
            this._hideMultiWindowIndicator();
        else if(showMultiWindowIndicator && !this.multiWindowIndicator.visible)
            this._showMultiWindowIndicator();

        if(needsAnimate){
            this._animateIndicatorsComplete = false;
            this._endAnimateIndicator();

            if(this._showMultiDashIndicator)
                this._startanimateIndicatorGrow();
            else
                this._startAnimateIndicatorWidth();

            this._animateIndicatorsID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
                this._runningIndicator.queue_repaint();
                if(this._animateGrow)
                    return this._animateIndicatorGrow();
                else
                    return this._animateIndicatorWidth();
            });
        }
        else{
            if(this._animateIndicatorsComplete){
                this._indicatorGrowWidth = null;
                this._runningIndicator.queue_repaint();
            }
        }
    }

    _startanimateIndicatorGrow(){
        this._animateGrow = true;
        const numTicks = 30;
        let multiDashWidth = this.width / 9;
        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        if(this.appIconState === AppIconState.FOCUSED && this._settings.get_boolean('show-window-titles'))
            this._indicatorSpacing = 17 * scaleFactor;
        else
            this._indicatorSpacing = 5 * scaleFactor;
        this._toDrawCount = this._nWindows - this._previousNWindows;
        const singleWindowRemains = this._previousNWindows === 2 && this._nWindows === 1;
        const singleWindowStart = this._previousNWindows === 1 && this._nWindows === 2;
        if(this._toDrawCount < 0)
            this._indicatorCount = this._previousNWindows + this._toDrawCount;
        else
            this._indicatorCount = this._previousNWindows;

        this._toDrawCount = Math.abs(this._toDrawCount);

        if(this.appIconState === AppIconState.FOCUSED && singleWindowRemains)
            this._indicatorWidth = this.width / 4;
        else if(this.previousAppIconState === AppIconState.RUNNING && singleWindowStart)
            this._indicatorWidth = multiDashWidth;
        else if(this.appIconState === AppIconState.FOCUSED && singleWindowStart){
            this._indicatorWidth = multiDashWidth;
            multiDashWidth = this.width / 4;
        }
        else
            this._indicatorWidth = multiDashWidth;

        this._totalIndicatorWidth = (this._nWindows * this._indicatorWidth) + ((this._nWindows - 1) * this._indicatorSpacing);
        this._startIndicatorWidth = (this._previousNWindows * multiDashWidth) + ((this._previousNWindows - 1) * this._indicatorSpacing);
        this._widthDiff = (this._totalIndicatorWidth - this._startIndicatorWidth) / numTicks;
    }

    _animateIndicatorGrow(){
        this._startIndicatorWidth += this._widthDiff;
        let animateDone = false;
        if(this._widthDiff > 0 && this._startIndicatorWidth >= this._totalIndicatorWidth)
            animateDone = true;
        else if(this._widthDiff < 0 && this._startIndicatorWidth <= this._totalIndicatorWidth)
            animateDone = true;
        else if(this._widthDiff === 0)
            animateDone = true;

        if(animateDone) {
            this._animateIndicatorsID = null;
            this._startIndicatorWidth = this._totalIndicatorWidth;
            this._runningIndicator.queue_repaint();
            this._animateGrow = false;
            this._animateIndicatorsComplete = true;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    _startAnimateIndicatorWidth(){
        const numTicks = 30;
        if(this.appIconState === AppIconState.NOT_RUNNING)
            this._indicatorWidth = 0;
        else if(this.appIconState === AppIconState.RUNNING)
            this._indicatorWidth = this.width / 9;
        else if(this.appIconState === AppIconState.FOCUSED)
            this._indicatorWidth = this.width / 4;

        if(this.previousAppIconState === undefined || this.previousAppIconState === AppIconState.NOT_RUNNING)
            this._indicatorGrowWidth = 0;
        else if(this.previousAppIconState === AppIconState.RUNNING)
            this._indicatorGrowWidth = this.width / 9;
        else if(this.previousAppIconState === AppIconState.FOCUSED)
            this._indicatorGrowWidth = this.width / 4;

        this._widthDiff = (this._indicatorWidth - this._indicatorGrowWidth) / numTicks;
    }

    _animateIndicatorWidth(){
        let animateDone = false;
        this._indicatorGrowWidth += this._widthDiff;
        if(this._widthDiff > 0 && this._indicatorGrowWidth >= this._indicatorWidth)
            animateDone = true;
        else if(this._widthDiff < 0 && this._indicatorGrowWidth <= this._indicatorWidth)
            animateDone = true;
        else if(this._widthDiff === 0)
            animateDone = true;

        if(animateDone) {
            this._animateIndicatorsID = null;
            this._indicatorGrowWidth = null;
            this._runningIndicator.queue_repaint();
            this._animateIndicatorsComplete = true;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    _endAnimateIndicator(){
        if(this._animateIndicatorsID){
            GLib.Source.remove(this._animateIndicatorsID);
            this._animateIndicatorsID = null;
            this._indicatorGrowWidth = null;
        }
    }

    _setIndicatorColor(){
        if(this.appIconState === AppIconState.NOT_RUNNING || !this._settings.get_boolean('indicators'))
            this._indicatorColor = 'transparent';
        else if(this.appIconState === AppIconState.RUNNING)
            this._indicatorColor = this._settings.get_string('indicator-color-running');
        else if(this.appIconState === AppIconState.FOCUSED)
            this._indicatorColor = this._settings.get_string('indicator-color-focused');
    }

    updateLabel(){
        const showLabels = this._settings.get_boolean('show-window-titles') && this.appIconState === AppIconState.FOCUSED;

        this._box.remove_style_class_name('azTaskbar-BaseIconText');

        if(showLabels){
            this._label.show();
            this._box.add_style_class_name('azTaskbar-BaseIconText');
        }
        else
            this._label.hide();

        let windows = this.getInterestingWindows();
        const showWindowTitle = windows.length === 1;

        if(this._notifyTitleId && this._singleWindow){
            this._notifyTitleId = this._singleWindow.disconnect(this._notifyTitleId);
            this._notifyTitleId = null;
            this._singleWindow = null;
        }

        if(showWindowTitle){
            this._singleWindow = windows[0];
            this._notifyTitleId = this._singleWindow.connect(
                'notify::title', () => this._label.text = this._singleWindow.get_title());
            this._label.text = this._singleWindow.get_title();
        }
        else
            this._label.text = this.app.get_name();
    }

    _onClicked() {
        this.hideLabel();
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

        this._endAnimateIndicator();

        if(this._notifyTitleId){
            this._notifyTitleId = this._singleWindow.disconnect(this._notifyTitleId);
            this._notifyTitleId = null;
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
        super._onDestroy();
    }

    updateIcon(){
        let iconSize = this._settings.get_int('icon-size');
        this._iconBin.remove_style_class_name('azTaskbar-symbolic-icon');
        let appIconStyle = this._settings.get_enum('icon-style');
        if(appIconStyle === AppIconStyle.SYMBOLIC)
            this._iconBin.add_style_class_name('azTaskbar-symbolic-icon');

        this._iconBin.set_child(this.app.create_icon_texture(iconSize));

        let indicatorSize = Math.max(5, Math.round(iconSize / 4));

        if(indicatorSize % 2 === 0)
            indicatorSize++;

        this.multiWindowIndicator.icon_size = indicatorSize;
    }

    updateAppIcon(){
        this.setActiveState();
        this.updateIcon();
        this.updateIconGeometry();
    }

    animateLaunch(){
        IconGrid.zoomOutActor(this._iconBin);
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

    stopAllAnimations(){
        this._box.style = 'transition-duration: 0ms;';
        this._box.remove_all_transitions();

        this._endAnimateIndicator();
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

        if(!this.isFavorite)
            this.opacity = 105;
        Main.overview.beginItemDrag(this);
        this._highlightFavorites(true);
    }

    _highlightFavorites(highlight){
        const visibleItems = this.mainBox.get_children();
        for (const item of visibleItems) {
            if(!item.isFavorite)
                continue;

            if(highlight)
                item.add_style_class_name('azTaskbar-favorite');
            else
                item.remove_style_class_name('azTaskbar-favorite');
        }
    }

    _onDragMotion(dragEvent) {
        const [success, x, y] =
            this.mainBox.transform_stage_point(dragEvent.x, dragEvent.y);

        if (!success)
            return;

        let dropTarget = getDropTarget(this.mainBox, x);
        let dropTargetItem = dropTarget.item;
        let index = dropTarget.index;

        this.dragPos = index;

        if(this === dropTargetItem || !dropTargetItem)
            return DND.DragMotionResult.CONTINUE;

        if(this.isFavorite || dropTargetItem.isFavorite)
            return DND.DragMotionResult.CONTINUE;

        if(dropTargetItem instanceof AppIcon){
            if(dropTargetItem.monitorIndex !== this.monitorIndex)
                return DND.DragMotionResult.CONTINUE;
            this.mainBox.remove_child(this);
            this.mainBox.insert_child_at_index(this, index);
            this.positionIndex = index;
        }

        return DND.DragMotionResult.CONTINUE;
    }

    _onDragCancelled() {
        this._dragCancelled = true;
        this._endDrag();
        Main.overview.cancelledItemDrag(this);
        this.updateIconGeometry();
    }

    _onDragEnd() {
        this._endDrag();
    }

    _endDrag() {
        this.undoFade();
        this.appDisplayBox.clearDragPlaceholder();
        this._highlightFavorites(false);
        this._box.style = null;
        this._dragging = false;

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

    setForcedHighlight(highlighted) {
        this._forcedHighlight = highlighted;
        if (highlighted)
            this._box.add_style_pseudo_class('focus');
        else
            this._box.remove_style_pseudo_class('focus');
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
        if(!scrollDirection && clickActionSetting === ClickAction.NO_TOGGLE_CYCLE || clickActionSetting === ClickAction.CYCLE)
            scrollDirection = true;
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
        else if(cycleMinimize){
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
                    window.minimize();
                    window.cycled = false;
                });
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
            IconGrid.zoomOutActor(this._iconBin);

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
                if(this._settings.get_enum('click-action') === ClickAction.NO_TOGGLE_CYCLE)
                    Main.activateWindow(window);
                else if(window.minimized || !window.has_focus())
                    Main.activateWindow(window);
                else
                    window.minimize();
            }
            //a favorited app is running, but no interesting windows on current workspace/monitor
            else if(this.app.state === Shell.AppState.RUNNING){
                IconGrid.zoomOutActor(this._iconBin);
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
        if(this._settings.get_enum('multi-window-indicator-style') !== MultiWindowIndicatorStyle.INDICATOR)
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
});

function enable() {
    settings = ExtensionUtils.getSettings();

    Me.customStylesheet = Theming.getStylesheetFile();
    Theming.updateStylesheet(settings);

    extensionConnections = new Map();
    extensionConnections.set(settings.connect('changed::position-in-panel', () => addAppBoxToPanel(true)), settings);
    extensionConnections.set(settings.connect('changed::position-offset', () => addAppBoxToPanel(true)), settings);
    extensionConnections.set(settings.connect('changed::main-panel-height', () => Theming.updateStylesheet(settings)), settings);

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

    Theming.unloadStylesheet();
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
    PREVIEW: 2,
    NO_TOGGLE_CYCLE: 3,
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

var ShowAppsButtonPosition = {
    LEFT: 0,
    RIGHT: 1,
}

var MultiWindowIndicatorStyle = {
    INDICATOR: 0,
    MULTI_DASH: 1,
    NONE: 2,
}
