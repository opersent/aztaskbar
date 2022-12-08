const { Clutter, GLib, GObject, Graphene, Meta, Shell, St } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { AppIconIndicator } = Me.imports.appIconIndicator;
const { AppMenu } = imports.ui.appMenu;
const DND = imports.ui.dnd;
const Enums = Me.imports.enums;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Utils = Me.imports.utils;
const { WindowPreviewMenu } = Me.imports.windowPreview;

const MAX_MULTI_WINDOW_DASHES = 3;

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

        this._iconSizeChangeId = this._settings.connect('changed::icon-size', () => this.updateIcon());

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
        if(this.pressed)
            this._box.add_style_class_name('pressed');
        else
            this._box.remove_style_class_name('pressed');

        let icon = this._iconBin.get_child();

        icon?.ease({
            duration: 150,
            scale_x: this.pressed ? .85 : 1,
            scale_y: this.pressed ? .85 : 1,
        });
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
        this._settings.disconnect(this._iconSizeChangeId);
        this._iconSizeChangeId = null;

        if(this._showWindowTitleId){
            this._settings.disconnect(this._showWindowTitleId);
            this._showWindowTitleId = null;
        }
    }

    animateIn(){
        this.ease({
            duration: 150,
            opacity: 255,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    _animateAppIcon(isMinimized){
        if(!St.Settings.get().enable_animations)
            return;

        let icon = this._iconBin.get_child();

        // Default value (AnimationDirection.TOP)
        let translationY = isMinimized ? -3 : 3;

         //get the value of your new setting
         //if the setting is for a bottom panel, invert the translationY value
         const animationDirectionSetting = this._settings.get_enum("animation-direction");
          if (animationDirectionSetting === Enums.AnimationDirection.BOT)
              translationY *= -1;

        icon?.ease({
            duration: 150,
            translation_y: translationY,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                icon?.ease({
                    translation_y: 0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                });
            },
        });
    }
});

var ShowAppsIcon = GObject.registerClass(
class azTaskbar_ShowAppsIcon extends BaseButton {
    _init(settings) {
        super._init(settings);

        this.tooltipLabel.text = _('Show Applications');
        this.bind_property('checked', Main.overview.dash.showAppsButton, 'checked', GObject.BindingFlags.BIDIRECTIONAL);
        this.connect("notify::checked", () => this._onChecked());
        this.updateIcon();
    }

    _onChecked(){
        if(this.checked)
            this._box.add_style_pseudo_class('checked');
        else
            this._box.remove_style_pseudo_class('checked');
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
            pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 })
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
        this._desiredIndicatorWidth = 1;
        this._startIndicatorWidth = 0;
        this._draggable = DND.makeDraggable(this, { timeoutThreshold: 200 });
        this._dragBeginId = this._draggable.connect('drag-begin', this._onDragBegin.bind(this));
        this._dragCancelledId = this._draggable.connect('drag-cancelled', this._onDragCancelled.bind(this));
        this._dragEndId = this._draggable.connect('drag-end', this._onDragEnd.bind(this));
        this._animateIndicatorsComplete = true;
        this._runningIndicator = new AppIconIndicator(this);
        this._overlayGroup.add_actor(this._runningIndicator);

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
        this._connectWindowMinimizeEvent();

        this._connections = new Map();
        this._connections.set(this._settings.connect('changed::multi-window-indicator-style', () => this._onIndicatorSettingChanged()), this._settings);
        this._connections.set(this._settings.connect('changed::show-window-titles', () => this.setActiveState()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-location', () => this._onIndicatorSettingChanged()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-running', () => this._onIndicatorSettingChanged()), this._settings);
        this._connections.set(this._settings.connect('changed::indicator-color-focused', () => this._onIndicatorSettingChanged()), this._settings);
        this._connections.set(this._settings.connect('changed::desaturation-factor', () => this._setDesaturateEffect()), this._settings);
        this._connections.set(this._settings.connect('changed::icon-style', () => this.updateIcon()), this._settings);
        this._connections.set(global.display.connect('notify::focus-window', () => this.setActiveState()), global.display);
        this._connections.set(this.app.connect('windows-changed', () => this._onWindowsChanged()), this.app);
        this._connections.set(this.connect('scroll-event', this._onMouseScroll.bind(this)), this);
        this._connections.set(this._previewMenu.connect('open-state-changed', this._previewMenuOpenStateChanged.bind(this)), this._previewMenu);
    }

    _onIndicatorSettingChanged(){
        let forceRedraw = true;
        this.setActiveState(forceRedraw);
    }

    _setFocused(){
        this.appState = Enums.AppState.FOCUSED;
        Utils.ensureActorVisibleInScrollView(this.appDisplayBox, this);
        this._box.add_style_pseudo_class('active');
    }

    setActiveState(forceRedraw){
        this.oldAppState = this.appState;
        this._previousNWindows = this._nWindows;

        if(this._dragging || !this.mapped || !this.get_parent()?.mapped)
            return;

        this._box.style = null;

        let showMultiWindowIndicator;

        let windows = this.getInterestingWindows();
        if(windows.length >= 1){
            this._nWindows = windows.length > MAX_MULTI_WINDOW_DASHES ? MAX_MULTI_WINDOW_DASHES : windows.length;
            this.appState = Enums.AppState.RUNNING;
            if(windows.length > 1)
                showMultiWindowIndicator = true;

            windows.forEach(window => {
                if(window.has_focus())
                    this._setFocused();
            });

            if(this.appState === Enums.AppState.RUNNING)
                this._box.set_style_pseudo_class(null);
        }
        else{
            this._box.set_style_pseudo_class(null);
            this.appState = Enums.AppState.NOT_RUNNING;
        }

        this.updateLabel();

        if(this._previousNWindows === undefined)
            this._previousNWindows = this._nWindows;

        this._runningIndicator.updateIndicator(forceRedraw, this.oldAppState, this.appState, this._previousNWindows, this._nWindows);

        if(this._settings.get_enum('multi-window-indicator-style') !== Enums.MultiWindowIndicatorStyle.INDICATOR || !showMultiWindowIndicator)
            this._hideMultiWindowIndicator();
        else if(showMultiWindowIndicator && !this.multiWindowIndicator.visible)
            this._showMultiWindowIndicator();
    }

    updateLabel(){
        const showLabels = this._settings.get_boolean('show-window-titles') && this.appState === Enums.AppState.FOCUSED;

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

        if(scrollAction === Enums.ScrollAction.CYCLE && direction){
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

        this._disconnectWindowMinimizeEvent();
        this._menu?.close();
        this._previewMenu?.close();

        if (this._scrollTimeOutId) {
            GLib.source_remove(this._scrollTimeOutId);
            this._scrollTimeOutId = null;
        }

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

        this._draggable.disconnect(this._dragBeginId);
        this._dragBeginId = null;
        this._draggable.disconnect(this._dragCancelledId);
        this._dragCancelledId = null;
        this._draggable.disconnect(this._dragEndId);
        this._dragEndId = null;

        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }

        if (this._draggable) {
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
        if(appIconStyle === Enums.AppIconStyle.SYMBOLIC)
            this._iconBin.add_style_class_name('azTaskbar-symbolic-icon');

        let icon = this.app.create_icon_texture(iconSize);
        icon.pivot_point = new Graphene.Point({ x: 0.5, y: 0.5 });
        this._iconBin.set_child(icon);

        let indicatorSize = Math.max(5, Math.round(iconSize / 4));

        if(indicatorSize % 2 === 0)
            indicatorSize++;

        this.multiWindowIndicator.icon_size = indicatorSize;
    }

    updateAppIcon(){
        this.setActiveState();
        this.updateIconGeometry();
        this._onWindowsChanged();
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
        this._runningIndicator.endAnimation();

        let icon = this._iconBin.get_child();

        if(!icon)
            return;

        icon.remove_all_transitions();
        icon.scale_x = 1;
        icon.scale_y = 1;
        icon.translation_y = 0;
    }

    getDragActor() {
        return this.app.create_icon_texture(this._settings.get_int('icon-size') * 1.5);
    }

    getDragActorSource() {
        return this._iconBin;
    }

    _onDragBegin() {
        const children = this.mainBox.get_children();
        this.dragStartPosition = children.indexOf(this);
        this._dragging = true;
        this.stopAllAnimations();
        this.calculateFavoritesIndicies();
        this.newIndex = -1;

        this._removePreviewMenuTimeout();
        this._removeMenuTimeout();
        this.hideLabel();

        this._dragMonitor = {
            dragMotion: this._onDragMotion.bind(this),
        };
        DND.addDragMonitor(this._dragMonitor);

        this._overlayGroup.opacity = 105;
        this._highlightFavorites(true);
    }

    _highlightFavorites(highlight){
        const visibleItems = this.mainBox.get_children();
        for (const item of visibleItems) {
            if(highlight && item.isFavorite)
                item.add_style_class_name('azTaskbar-favorite');
            else
                item.remove_style_class_name('azTaskbar-favorite');
        }
    }

    calculateFavoritesIndicies(){
        const children = this.mainBox.get_children();
        let appFavoritesIdicies = [];
        children.map(child => {
            if(child.isFavorite)
                appFavoritesIdicies.push(children.indexOf(child));
        });
        this.firstFavIndex = appFavoritesIdicies[0];
        this.lastFavIndex = appFavoritesIdicies[appFavoritesIdicies.length - 1];
    }

    _onDragMotion(dragEvent) {
        return DND.DragMotionResult.CONTINUE;
    }

    _onDragCancelled() {
        this.mainBox.remove_child(this);
        this.mainBox.insert_child_at_index(this, this.dragStartPosition);
        this.positionIndex = this.dragStartPosition;
        this._endDrag();
    }

    _onDragEnd() {
        this._endDrag();
    }

    _endDrag() {
        this._removeDragMonitor();
        this.lastPositionIndex = null;
        this.undoFade();
        this._highlightFavorites(false);
        this._box.style = null;
        this.updateIconGeometry();
    }

    _cancelActions(){
        if (this._draggable)
            this._draggable.fakeRelease();
        this.fake_release();
    }

    _removeDragMonitor(){
        this._dragging = false;
        if(this._dragMonitor){
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
    }

    undoFade() {
        this._overlayGroup.ease({
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
        this._cancelActions();

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

    _onWindowsChanged(){
        if (this._cycleWindowList && this._cycleWindowList.length !== this.getInterestingWindows().length) {
            this._clearCycleWindow();
            this._cycleWindowList = null;
        }

        this._connectWindowMinimizeEvent()
    }

    _disconnectWindowMinimizeEvent(){
        let windows = this.getInterestingWindows();
        windows.forEach(window => {
            if (window._windowMinimizeId > 0) {
                window.disconnect(window._windowMinimizeId);
                window._windowMinimizeId = 0;
            }
        });
    }

    _connectWindowMinimizeEvent(){
        this._windowList = this.getInterestingWindows();
        this._windowList.forEach(window => {
            if (window._windowMinimizeId > 0) {
                window.disconnect(window._windowMinimizeId);
                window._windowMinimizeId = 0;
            }
            window._windowMinimizeId = window.connect('notify::minimized', () => this._animateAppIcon(window.minimized));
        });
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
        const cycleMinimize = clickActionSetting === Enums.ClickAction.CYCLE_MINIMIZE;
        if(!scrollDirection && clickActionSetting === Enums.ClickAction.NO_TOGGLE_CYCLE || clickActionSetting === Enums.ClickAction.CYCLE)
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

            if(windowIndex != nextWindowIndex){
                Main.activateWindow(windows[nextWindowIndex]);
            }
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

        if (this.app.state === Shell.AppState.STOPPED || openNewWindow){
            let isMinimized = false;
            this._animateAppIcon(isMinimized);
        }

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
                if(this._settings.get_enum('click-action') === Enums.ClickAction.NO_TOGGLE_CYCLE)
                    Main.activateWindow(window);
                else if(window.minimized || !window.has_focus()){
                    Main.activateWindow(window);
                }
                else
                    window.minimize();
            }
            //a favorited app is running, but no interesting windows on current workspace/monitor
            else if(this.app.state === Shell.AppState.RUNNING){
                let isMinimized = false;
                this._animateAppIcon(isMinimized);
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
            Utils.ensureActorVisibleInScrollView(this.appDisplayBox, this);
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
        return Utils.getInterestingWindows(this._settings, this.getWindows(), this.monitorIndex);
    }

    _windowPreviews() {
        if (this._previewMenu?.isOpen)
            return;
        else{
            this._removeMenuTimeout();
            this._cancelActions();
            this._previewMenu?.popup();
        }
    }

    _showMultiWindowIndicator(){
        if(this._settings.get_enum('multi-window-indicator-style') !== Enums.MultiWindowIndicatorStyle.INDICATOR)
            return;

        this.multiWindowIndicator.remove_all_transitions();
        this.multiWindowIndicator.opacity = 0;
        this.multiWindowIndicator.show();
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
