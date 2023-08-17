import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import {DateMenuButton} from 'resource:///org/gnome/shell/ui/dateMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickSettingsMenu, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import * as RemoteAccessStatus from 'resource:///org/gnome/shell/ui/status/remoteAccess.js';
import * as PowerProfileStatus from 'resource:///org/gnome/shell/ui/status/powerProfiles.js';
import * as RFKillStatus from 'resource:///org/gnome/shell/ui/status/rfkill.js';
import * as CameraStatus from 'resource:///org/gnome/shell/ui/status/camera.js';
import * as VolumeStatus from 'resource:///org/gnome/shell/ui/status/volume.js';
import * as BrightnessStatus from 'resource:///org/gnome/shell/ui/status/brightness.js';
import * as SystemStatus from 'resource:///org/gnome/shell/ui/status/system.js';
import * as LocationStatus from 'resource:///org/gnome/shell/ui/status/location.js';
import * as NightLightStatus from 'resource:///org/gnome/shell/ui/status/nightLight.js';
import * as DarkModeStatus from 'resource:///org/gnome/shell/ui/status/darkMode.js';
import * as BacklightStatus from 'resource:///org/gnome/shell/ui/status/backlight.js';
import * as ThunderboltStatus from 'resource:///org/gnome/shell/ui/status/thunderbolt.js';
import * as AutoRotateStatus from 'resource:///org/gnome/shell/ui/status/autoRotate.js';
import * as BackgroundAppsStatus from 'resource:///org/gnome/shell/ui/status/backgroundApps.js';

const BUTTON_DND_ACTIVATION_TIMEOUT = 250;
const N_QUICK_SETTINGS_COLUMNS = 2;

const ActivitiesButton = GObject.registerClass(
class ActivitiesButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, null, true);
        this.accessible_role = Atk.Role.TOGGLE_BUTTON;

        this.name = 'panelActivities';

        /* Translators: If there is no suitable word for "Activities"
            in your language, you can use the word for "Overview". */
        this._label = new St.Label({
            text: _('Activities'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_actor(this._label);

        this.label_actor = this._label;

        Main.overview.connect('showing', () => {
            this.add_style_pseudo_class('checked');
            this.add_accessible_state(Atk.StateType.CHECKED);
        });
        Main.overview.connect('hiding', () => {
            this.remove_style_pseudo_class('checked');
            this.remove_accessible_state(Atk.StateType.CHECKED);
        });

        this._xdndTimeOut = 0;
    }

    handleDragOver(source, _actor, _x, _y, _time) {
        if (source !== Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;

        if (this._xdndTimeOut !== 0)
            GLib.source_remove(this._xdndTimeOut);
        this._xdndTimeOut = GLib.timeout_add(GLib.PRIORITY_DEFAULT, BUTTON_DND_ACTIVATION_TIMEOUT, () => {
            this._xdndToggleOverview();
        });
        GLib.Source.set_name_by_id(this._xdndTimeOut, '[gnome-shell] this._xdndToggleOverview');

        return DND.DragMotionResult.CONTINUE;
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.TOUCH_END ||
            event.type() === Clutter.EventType.BUTTON_RELEASE) {
            if (Main.overview.shouldToggleByCornerOrButton())
                Main.overview.toggle();
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_key_release_event(event) {
        let symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_space) {
            if (Main.overview.shouldToggleByCornerOrButton()) {
                Main.overview.toggle();
                return Clutter.EVENT_STOP;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _xdndToggleOverview() {
        let [x, y] = global.get_pointer();
        let pickedActor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);

        if (pickedActor === this && Main.overview.shouldToggleByCornerOrButton())
            Main.overview.toggle();

        GLib.source_remove(this._xdndTimeOut);
        this._xdndTimeOut = 0;
        return GLib.SOURCE_REMOVE;
    }
});

const QuickSettings = GObject.registerClass(
class QuickSettings extends PanelMenu.Button {
    constructor() {
        super(0.0, C_('System menu in the top bar', 'System'), true);

        this._indicators = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
        });
        this.add_child(this._indicators);

        this.setMenu(new QuickSettingsMenu(this, N_QUICK_SETTINGS_COLUMNS));

        this._setupIndicators().catch(error =>
            logError(error, 'Failed to setup quick settings'));
    }

    async _setupIndicators() {
        if (Config.HAVE_NETWORKMANAGER) {
            /** @type {import('resource:///org/gnome/shell/ui/status/network.js')} */
            const NetworkStatus = await import('resource:///org/gnome/shell/ui/status/network.js');

            this._network = new NetworkStatus.Indicator();
        } else {
            this._network = null;
        }

        if (Config.HAVE_BLUETOOTH) {
            /** @type {import('resource:///org/gnome/shell/ui/status/bluetooth.js')} */
            const BluetoothStatus = await import('resource:///org/gnome/shell/ui/status/bluetooth.js');

            this._bluetooth = new BluetoothStatus.Indicator();
        } else {
            this._bluetooth = null;
        }

        this._system = new SystemStatus.Indicator();
        this._camera = new CameraStatus.Indicator();
        this._volumeOutput = new VolumeStatus.OutputIndicator();
        this._volumeInput = new VolumeStatus.InputIndicator();
        this._brightness = new BrightnessStatus.Indicator();
        this._remoteAccess = new RemoteAccessStatus.RemoteAccessApplet();
        this._location = new LocationStatus.Indicator();
        this._thunderbolt = new ThunderboltStatus.Indicator();
        this._nightLight = new NightLightStatus.Indicator();
        this._darkMode = new DarkModeStatus.Indicator();
        this._backlight = new BacklightStatus.Indicator();
        this._powerProfiles = new PowerProfileStatus.Indicator();
        this._rfkill = new RFKillStatus.Indicator();
        this._autoRotate = new AutoRotateStatus.Indicator();
        this._unsafeMode = new UnsafeModeIndicator();
        this._backgroundApps = new BackgroundAppsStatus.Indicator();

        this._indicators.add_child(this._remoteAccess);
        this._indicators.add_child(this._camera);
        this._indicators.add_child(this._volumeInput);
        this._indicators.add_child(this._location);
        this._indicators.add_child(this._brightness);
        this._indicators.add_child(this._thunderbolt);
        this._indicators.add_child(this._nightLight);
        if (this._network)
            this._indicators.add_child(this._network);
        this._indicators.add_child(this._darkMode);
        this._indicators.add_child(this._backlight);
        this._indicators.add_child(this._powerProfiles);
        if (this._bluetooth)
            this._indicators.add_child(this._bluetooth);
        this._indicators.add_child(this._rfkill);
        this._indicators.add_child(this._autoRotate);
        this._indicators.add_child(this._volumeOutput);
        this._indicators.add_child(this._unsafeMode);
        this._indicators.add_child(this._system);

        this._addItems(this._system.quickSettingsItems, N_QUICK_SETTINGS_COLUMNS);
        this._addItems(this._volumeOutput.quickSettingsItems, N_QUICK_SETTINGS_COLUMNS);
        this._addItems(this._volumeInput.quickSettingsItems, N_QUICK_SETTINGS_COLUMNS);
        this._addItems(this._brightness.quickSettingsItems, N_QUICK_SETTINGS_COLUMNS);

        this._addItems(this._camera.quickSettingsItems);
        this._addItems(this._remoteAccess.quickSettingsItems);
        this._addItems(this._thunderbolt.quickSettingsItems);
        this._addItems(this._location.quickSettingsItems);
        if (this._network)
            this._addItems(this._network.quickSettingsItems);
        if (this._bluetooth)
            this._addItems(this._bluetooth.quickSettingsItems);
        this._addItems(this._powerProfiles.quickSettingsItems);
        this._addItems(this._nightLight.quickSettingsItems);
        this._addItems(this._darkMode.quickSettingsItems);
        this._addItems(this._backlight.quickSettingsItems);
        this._addItems(this._rfkill.quickSettingsItems);
        this._addItems(this._autoRotate.quickSettingsItems);
        this._addItems(this._unsafeMode.quickSettingsItems);

        this._addItems(this._backgroundApps.quickSettingsItems, N_QUICK_SETTINGS_COLUMNS);
    }

    _addItems(items, colSpan = 1) {
        items.forEach(item => this.menu.addItem(item, colSpan));
    }
});

const UnsafeModeIndicator = GObject.registerClass(
class UnsafeModeIndicator extends SystemIndicator {
    _init() {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'channel-insecure-symbolic';

        global.context.bind_property('unsafe-mode',
            this._indicator, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
    }
});

export const Panel = GObject.registerClass(
class azTaskbarPanel extends St.Widget {
    _init(monitor) {
        super._init({
            name: 'panel',
            style_class: 'panel azTaskbar-panel',
            reactive: true,
        });
        this.connect('destroy', this._onDestroy.bind(this));

        this.set_offscreen_redirect(Clutter.OffscreenRedirect.ALWAYS);

        this.statusArea = {};

        this.monitor = monitor;

        this._leftBox = new St.BoxLayout({name: 'panelLeft'});
        this.add_child(this._leftBox);
        this._centerBox = new St.BoxLayout({name: 'panelCenter'});
        this.add_child(this._centerBox);
        this._rightBox = new St.BoxLayout({name: 'panelRight'});
        this.add_child(this._rightBox);

        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('touch-event', this._onTouchEvent.bind(this));

        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this.width = this.monitor.width;

        this._overviewShowingId = Main.overview.connect('showing', () => {
            this.style = 'transition-duration: 0ms;';
            this.add_style_pseudo_class('overview');
        });

        this._overviewHidingId = Main.overview.connect('hidden', () => {
            this.remove_style_pseudo_class('overview');
            this.style = null;
        });

        this._setPanelMenu('quickSettings', QuickSettings, this._rightBox);
        this._setPanelMenu('dateMenu', DateMenuButton, this._centerBox);
        this._setPanelMenu('activities', ActivitiesButton, this._leftBox);
    }

    vfunc_get_preferred_width(_forHeight) {
        if (this.monitor)
            return [0, this.monitor.width];

        return [0, 0];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;

        let [, leftNaturalWidth] = this._leftBox.get_preferred_width(-1);
        let [, centerNaturalWidth] = this._centerBox.get_preferred_width(-1);
        let [, rightNaturalWidth] = this._rightBox.get_preferred_width(-1);

        let sideWidth, centerWidth;
        centerWidth = centerNaturalWidth;

        // get workspace area and center date entry relative to it
        let monitor = Main.layoutManager.findMonitorForActor(this);
        let centerOffset = 0;
        if (monitor) {
            let workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
            centerOffset = 2 * (workArea.x - monitor.x) + workArea.width - monitor.width;
        }

        sideWidth = Math.max(0, (allocWidth - centerWidth + centerOffset) / 2);

        let childBox = new Clutter.ActorBox();

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.get_text_direction() === Clutter.TextDirection.RTL) {
            childBox.x1 = Math.max(allocWidth - Math.min(Math.floor(sideWidth),
                leftNaturalWidth), 0);
            childBox.x2 = allocWidth;
        } else {
            childBox.x1 = 0;
            childBox.x2 = Math.min(Math.floor(sideWidth),
                leftNaturalWidth);
        }
        this._leftBox.allocate(childBox);

        childBox.x1 = Math.ceil(sideWidth);
        childBox.y1 = 0;
        childBox.x2 = childBox.x1 + centerWidth;
        childBox.y2 = allocHeight;
        this._centerBox.allocate(childBox);

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.get_text_direction() === Clutter.TextDirection.RTL) {
            childBox.x1 = 0;
            childBox.x2 = Math.min(Math.floor(sideWidth),
                rightNaturalWidth);
        } else {
            childBox.x1 = Math.max(allocWidth - Math.min(Math.floor(sideWidth),
                rightNaturalWidth), 0);
            childBox.x2 = allocWidth;
        }
        this._rightBox.allocate(childBox);
    }

    _tryDragWindow(event) {
        if (Main.modalCount > 0)
            return Clutter.EVENT_PROPAGATE;

        const targetActor = global.stage.get_event_actor(event);
        if (targetActor !== this)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        let dragWindow = this._getDraggableWindowForPosition(x);

        if (!dragWindow)
            return Clutter.EVENT_PROPAGATE;

        return dragWindow.begin_grab_op(
            Meta.GrabOp.MOVING,
            event.get_device(),
            event.get_event_sequence(),
            event.get_time()) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    _onButtonPress(actor, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        return this._tryDragWindow(event);
    }

    _onTouchEvent(actor, event) {
        if (event.type() !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;

        return this._tryDragWindow(event);
    }

    vfunc_key_press_event(keyEvent) {
        let symbol = keyEvent.keyval;
        if (symbol === Clutter.KEY_Escape) {
            global.display.focus_default_window(keyEvent.time);
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_key_press_event(keyEvent);
    }

    _addToPanelBox(role, indicator, position, box) {
        let container = indicator.container;

        let parent = container.get_parent();
        if (parent)
            parent.remove_actor(container);

        box.insert_child_at_index(container, position);
        if (indicator.menu)
            this.menuManager.addMenu(indicator.menu);
        this.statusArea[role] = indicator;
        let destroyId = indicator.connect('destroy', emitter => {
            delete this.statusArea[role];
            emitter.disconnect(destroyId);
        });
    }

    addToStatusArea(role, indicator, position, box) {
        if (this.statusArea[role])
            throw new Error(`Extension point conflict: there is already a status indicator for role ${role}`);

        if (!(indicator instanceof PanelMenu.Button))
            throw new TypeError('Status indicator must be an instance of PanelMenu.Button');

        position ??= 0;
        let boxes = {
            left: this._leftBox,
            center: this._centerBox,
            right: this._rightBox,
        };
        let boxContainer = boxes[box] || this._rightBox;
        this.statusArea[role] = indicator;
        this._addToPanelBox(role, indicator, position, boxContainer);
        return indicator;
    }

    _getDraggableWindowForPosition(stageX) {
        let workspaceManager = global.workspace_manager;
        const windows = workspaceManager.get_active_workspace().list_windows();
        const allWindowsByStacking =
            global.display.sort_windows_by_stacking(windows).reverse();

        return allWindowsByStacking.find(metaWindow => {
            let rect = metaWindow.get_frame_rect();
            return metaWindow.get_monitor() === this.monitor.index &&
                metaWindow.showing_on_its_workspace() &&
                metaWindow.get_window_type() !== Meta.WindowType.DESKTOP &&
                metaWindow.maximized_vertically &&
                stageX > rect.x && stageX < rect.x + rect.width;
        });
    }

    // Credit: Dash to Panel https://github.com/home-sweet-gnome/dash-to-panel
    _setPanelMenu(propName, constr, container) {
        if (!this.statusArea[propName]) {
            this.statusArea[propName] = this._getPanelMenu(propName, constr);
            this.menuManager.addMenu(this.statusArea[propName].menu);
            container.insert_child_at_index(this.statusArea[propName].container, 0);
        }
    }

    // Credit: Dash to Panel https://github.com/home-sweet-gnome/dash-to-panel
    _removePanelMenu(propName) {
        const Me = Extension.lookupByURL(import.meta.url);
        if (this.statusArea[propName]) {
            let parent = this.statusArea[propName].container.get_parent();
            if (parent)
                parent.remove_actor(this.statusArea[propName].container);


            // calling this.statusArea[propName].destroy(); is buggy for now, gnome-shell never
            // destroys those panel menus...
            // since we can't destroy the menu (hence properly disconnect its signals), let's
            // store it so the next time a panel needs one of its kind, we can reuse it instead
            // of creating a new one
            let panelMenu = this.statusArea[propName];

            this.menuManager.removeMenu(panelMenu.menu);
            Me.persistentStorage[propName].push(panelMenu);
            this.statusArea[propName] = null;
        }
    }

    // Credit: Dash to Panel https://github.com/home-sweet-gnome/dash-to-panel
    _getPanelMenu(propName, constr) {
        const Me = Extension.lookupByURL(import.meta.url);
        Me.persistentStorage[propName] = Me.persistentStorage[propName] || [];

        if (!Me.persistentStorage[propName].length)
            Me.persistentStorage[propName].push(new constr(this));


        return Me.persistentStorage[propName].pop();
    }

    disable() {
        this._removePanelMenu('quickSettings');
        this._removePanelMenu('activities');
        this._removePanelMenu('dateMenu');
    }

    _onDestroy() {
        Main.overview.disconnect(this._overviewShowingId);
        Main.overview.disconnect(this._overviewHidingId);
    }
});
