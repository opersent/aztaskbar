const { Clutter, GLib, GObject, Shell, St } = imports.gi;

const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const AppFavorites = imports.ui.appFavorites;
const { AppMenu } = imports.ui.appMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;

let settings, appDisplayBar;

var AppDisplayBar = GObject.registerClass(
class azTaskbar_AppDisplayBar extends St.BoxLayout {
	_init(settings) {
		super._init();

        this._settings = settings;

		this._workId = Main.initializeDeferredWork(this, this._redisplay.bind(this));
		this._menuManager = new PopupMenu.PopupMenuManager(this);

		this._appSystem = Shell.AppSystem.get_default();

        this.oldAppIcons = new Map();

        this.isolateWorkspacesID = this._settings.connect('changed::isolate-workspaces', () => this._redisplay());
        this.isolateMonitorsID = this._settings.connect('changed::isolate-monitors', () => this._redisplay());
        this.favoritesID = this._settings.connect('changed::favorites', () => this._redisplay());

		this.appFavoritesChangedID = AppFavorites.getAppFavorites().connect('changed', this._redisplay.bind(this));
		this.appSystemChangedID = this._appSystem.connect('app-state-changed', this._redisplay.bind(this));
		this.restackedID = global.display.connect('restacked', this._redisplay.bind(this));
		this.markedUrgentID = global.display.connect('window-marked-urgent', this._redisplay.bind(this));
		this.demandsAttentionID = global.display.connect('window-demands-attention', this._redisplay.bind(this));
		this.switchWorkspaceID = global.window_manager.connect('switch-workspace', this._redisplay.bind(this));
		this.windowEnteredMonitorID = global.display.connect('window-entered-monitor', this._redisplay.bind(this));

		this._redisplay();
		this.connect("destroy", () => this._destroy());
	}

	_createAppItem(app, monitorIndex){
        let appID = app.get_id() + ", " + monitorIndex;
        let item = this.oldAppIcons.get(appID);

        if(item){
            item.setActiveState();
            return item;
        }
    
		let button = new AppIcon(this._settings, app, this._menuManager, monitorIndex);
        this.oldAppIcons.set(appID, button);
		return button;
	}

	_redisplay() {
        this.oldApps = [];
        
        if(this.boxes){
            for(let i = 0; i < this.boxes.length; i++){
                let pos = 0;
                this.boxes[i].get_children().forEach(actor => {
                    if(actor instanceof AppIcon){
                        this.boxes[i].remove_child(actor);
                        this.oldApps.push({
                            monitorIndex: actor.monitorIndex,
                            app: actor.app,
                            pos
                        });
                        pos++;
                    }
                });
            }
        }

		this.destroy_all_children();
		this.boxes = [];

        let isolateMonitors = this._settings.get_boolean('isolate-monitors');
        let monitorCount = isolateMonitors ? Main.layoutManager.monitors.length : 1;

		for(let i = 0; i < monitorCount; i++){
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

            //Search old apps, if running contains an old app, remove from running
            oldApps.forEach(oldApp => {
                const index = running.indexOf(oldApp.app);
                if (index > -1) {
                    const [app] = running.splice(index, 1);
                    if (!showFavorites || !(app.get_id() in favorites))
                    newApps.push({
                        app,
                        pos: oldApp.pos
                    }); 
                }
            });

            if(showFavorites){
                let favsArray = appFavorites.getFavorites();
                for (let i = favsArray.length - 1; i >= 0; i--){
                    newApps.push({
                        app: favsArray[i],
                        pos: 0
                    }); 
                }
            }

            // Second: add the new apps
            running.forEach(app => {
                if (!showFavorites || !(app.get_id() in favorites))
                    newApps.push({
                        app,
                        pos: -1
                    }); 
            });

            if(newApps.length > 0){
				let box = new St.BoxLayout();
				this.boxes.push(box);
				this.add_child(box);
                newApps.forEach(app => {
                    let item = this._createAppItem(app.app, monitorIndex);

                    let pos = app.pos;
                    if(pos > -1){
                        box.insert_child_at_index(item, pos);
                    }
                    else{
                        box.add_child(item);
                    }
                });
			}
		}

		for(let i = 0; i < this.boxes.length - 1; i++){
			let separator = new St.Widget({
				style_class: "azTaskbar-Separator",
				x_align: Clutter.ActorAlign.FILL,
				y_align: Clutter.ActorAlign.CENTER,
				width: 1,
				height: 15,
			});
			this.boxes[i].add_child(separator);
		}

        //destroy old AppIcons that are no longer needed
        this.oldAppIcons.forEach((value,key,map) => {
            if(!value.get_parent()){
                value.destroy();
                this.oldAppIcons.delete(key);
            }
        });

        this.queue_relayout();
    }

	_destroy() {
        this.oldAppIcons.forEach((value,key,map) => {
            if(!value.get_parent()){
                value.destroy();
                this.oldAppIcons.delete(key);
            }
        });
        this.oldAppIcons = null;

		

        if (this.isolateWorkspacesID) {
			this._settings.disconnect(this.isolateWorkspacesID);
			this.isolateWorkspacesID = null;
		}

        if (this.isolateMonitorsID) {
			this._settings.disconnect(this.isolateMonitorsID);
			this.isolateMonitorsID = null;
		}

        if (this.favoritesID) {
			this._settings.disconnect(this.favoritesID);
			this.favoritesID= null;
		}

		if (this.appFavoritesChangedID) {
			AppFavorites.getAppFavorites().disconnect(this.appFavoritesChangedID);
			this.appFavoritesChangedID = null;
		}

		if (this.appSystemChangedID) {
			this._appSystem.disconnect(this.appSystemChangedID);
			this.appSystemChangedID = null;
		}

		if (this.restackedID) {
			global.display.disconnect(this.restackedID);
			this.appFavoritesChangedID = null;
		}

		if (this.markedUrgentID) {
			global.display.disconnect(this.markedUrgentID);
			this.markedUrgentID = null;
		}

		if (this.demandsAttentionID) {
			global.display.disconnect(this.demandsAttentionID);
			this.demandsAttentionID = null;
		}

		if (this.switchWorkspaceID) {
			global.window_manager.disconnect(this.switchWorkspaceID);
			this.switchWorkspaceID = null;
		}

		if (this.windowEnteredMonitorID) {
			global.display.disconnect(this.windowEnteredMonitorID);
			this.windowEnteredMonitorID = null;
		}

        this.destroy_all_children();
	}
});

var AppIcon = GObject.registerClass(
class azTaskbar_AppIcon extends St.Button {
	_init(settings, app, menuManager, monitorIndex) {
		super._init({
            reactive: true,
            can_focus: true,
			track_hover: true
		});

		this.app = app;
        this._menuManager = menuManager;
		this.monitorIndex = monitorIndex;
        this._settings = settings;



        this._contextMenuManager = new PopupMenu.PopupMenuManager(this);

        let box = new St.BoxLayout({
            vertical: true,
        });

        this.indicator = new St.Widget({
            style_class: 'azTaskbar-indicator',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });
        box.add_child(this.indicator);

		this.appIcon = new St.Bin({ 
            reactive: true,
            can_focus: true,
			track_hover: true,
            style_class: 'azTaskbar-AppButton',
			x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
			child: app.create_icon_texture(20)
		});
        this.bind_property('hover', this.appIcon, 'hover', GObject.BindingFlags.SYNC_CREATE);

        box.add_child(this.appIcon);
		this.set_child(box);

        this.indicatorsID = this._settings.connect('changed::indicators', () => this.setActiveState());

        this.setActiveState();

        this.tooltipLabel = new St.Label({ 
			style_class: 'dash-label azTaskbar-Tooltip',
			text: app.get_name()
		});
        this.tooltipLabel.hide();
        Main.layoutManager.addChrome(this.tooltipLabel);

        this._menu = null;
    
        this._previewMenu = new Me.imports.windowPreview.WindowPreviewMenu(this);
        this._menuManager.addMenu(this._previewMenu);
        this._previewMenu.connect('open-state-changed', (menu, isPoppedUp) => {
            if (!isPoppedUp){
                this.setForcedHighlight(false);
                this._onMenuPoppedDown();
            }
            else{
                this.setForcedHighlight(true);
            }
        });

		let id = Main.overview.connect('hiding', () => {
			this._previewMenu.close();
		});

        this._menuTimeoutId = 0;

		this.connect('destroy', () => {
			Main.overview.disconnect(id);
			id = null;
		
            if (this.child !== null)
                this.child.destroy();

            
            this._removeMenuTimeout();
            this._removePreviewMenuTimeout();
            this._clearCycleWindow();
            this._removeCylceWindowsTimeout();
            this.tooltipLabel.remove_all_transitions();
            this.tooltipLabel.hide();
            this.tooltipLabel.destroy();

            if (this.indicatorsID) {
                this._settings.disconnect(this.indicatorsID);
                this.indicatorsID = null;
            }
        });

		this.connect('notify::hover', () => {
            this._syncLabel();
        });

        this.connect('clicked', () => {
            this.hideLabel();
        });
	}

    setActiveState(){
        this.indicator.set_style_pseudo_class(null);
        this.appIcon.set_style_pseudo_class(null)
        let styleClass = 'inactive';
        let windows = this.getInterestingWindows();

        if(windows.length >= 1){
            styleClass = 'active';
            windows.forEach(window => {
                if(window.has_focus()){
                    this.appIcon.add_style_pseudo_class('active')
                    styleClass = 'focused';
                }  
            });
        }

        if(!this._settings.get_boolean('indicators'))
            styleClass = 'inactive';

        this.indicator.add_style_pseudo_class(styleClass);
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

        if (this._previewMenuTimeoutId > 0)
            return;

        this._previewMenuTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
            this._previewMenuTimeoutId = 0;
            this._windowPreviews();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._previewMenuTimeoutId, '[azTaskbar] this.previewPopupMenu');
    }

    vfunc_button_press_event(buttonEvent) {
		this._removePreviewMenuTimeout();
		if (this._previewMenu?.isOpen){
			this._previewMenu.close();
		}
        const ret = super.vfunc_button_press_event(buttonEvent);
        if (buttonEvent.button == 1) {
            this._setPopupTimeout();
        } else if (buttonEvent.button == 3) {
            this.popupMenu();
        }
        return ret;
    }

	vfunc_clicked(button) {
        this._removeMenuTimeout();
        this.activate(button);
    }

	popupMenu(side = St.Side.TOP) {
        this._removeMenuTimeout();

        if (!this._menu) {
            this._menu = new AppMenu(this, side, {
                favoritesSection: true,
                showSingleWindows: true,
            });
            this._menu.setApp(this.app);
            this._menu.connect('open-state-changed', (menu, isPoppedUp) => {
				if (!isPoppedUp){
					this.setForcedHighlight(false);
					this._onMenuPoppedDown();
				}
				else{
					this.setForcedHighlight(true);
				}
            });
            Main.overview.connectObject('hiding',
                () => this._menu.close(), this);

            Main.uiGroup.add_actor(this._menu.actor);
            this._contextMenuManager.addMenu(this._menu);
        }

        //this.emit('menu-state-changed', true);

        this._menu.open();
        this._contextMenuManager.ignoreRelease();

        return false;
    }

    _onMenuPoppedDown() {
        this._removePreviewMenuTimeout();
        //this.emit('menu-state-changed', false);
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

	activate() {
        let event = Clutter.get_current_event();
        let modifiers = event ? event.get_state() : 0;
        let windows = this.getInterestingWindows();

        // Only consider SHIFT and CONTROL as modifiers (exclude SUPER, CAPS-LOCK, etc.)
        modifiers = modifiers & (Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.CONTROL_MASK);
    
        if (modifiers & Clutter.ModifierType.CONTROL_MASK) {
            let openNewWindow = this.app.can_open_new_window();
            if (openNewWindow)
                this.app.open_new_window(-1);
            else
                this.app.activate();
            return;
        }

        
        //App has More than 1 active window, Cycle through windows. Minimize all when cycle complete.
        if(windows.length > 1){
            //start a timer that clears cycle state after x amount of time
            this._setCylceWindowsTimeout();

            let cycled = windows.filter(window => {
                if(!window.cycled)
                    return window;
            });
            if(cycled.length === 0){
                windows.forEach(window => {
                    window.minimize();
                    window.cycled = false;
                });
                return;
            }
            for(let i = 0; i < windows.length; i++){
                let window = windows[i];
                if(!window.cycled){
                    window.cycled = true;
                    Main.activateWindow(window);
                    break;
                }
            }
            return;
        }
        else if(windows.length === 1){
            const window = windows[0];
            if(window.minimized || !window.has_focus())
                Main.activateWindow(window);
            else
                window.minimize();
            return;
        }
		
        //if (this.app.state == Shell.AppState.STOPPED || openNewWindow)
        //   this.animateLaunch();
        let openNewWindow = this.app.can_open_new_window();
        if (openNewWindow)
            this.app.open_new_window(-1);
        else
            this.app.activate();

        Main.overview.hide();
    }

	_syncLabel() {
        let shouldShow = this.hover;

        if (shouldShow) {
			if(this.getInterestingWindows().length >= 1 && this.app.state == Shell.AppState.RUNNING)
				this._setPreviewPopupTimeout();
            this.showLabel();
        } else {
			this.hideLabel();
			this._removePreviewMenuTimeout();
        }
    }

	getWindows() {
        return this.app.get_windows();
    }

    // Filter out unnecessary windows, for instance
    // nautilus desktop window.
    getInterestingWindows() {
        const interestingWindows = getInterestingWindows(this._settings, this.getWindows(), this.monitorIndex);

        if (!this._urgentWindows)
            return interestingWindows;

        return [...new Set([...this._urgentWindows, ...interestingWindows])];
    }

	_windowPreviews() {
        if (this._previewMenu.isOpen){
			this._previewMenu.close();
		}
        else{
			this._removeMenuTimeout();
			this.fake_release();

			this._previewMenu.popup();
			this._menuManager.ignoreRelease();
		}
    }

	showLabel() {
        if(!this._settings.get_boolean('tool-tips'))
            return;

        this.tooltipLabel.opacity = 0;
        this.tooltipLabel.show();

        let [stageX, stageY] = this.get_transformed_position();

        const itemWidth = this.allocation.get_width();

        const labelWidth = this.tooltipLabel.get_width();
        const xOffset = Math.floor((itemWidth - labelWidth) / 2);
        const x = Math.clamp(stageX + xOffset, 0, global.stage.width - labelWidth);

		const yOffset = 10;
        const y = stageY + this.tooltipLabel.height + yOffset;

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
