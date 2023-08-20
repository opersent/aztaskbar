import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {DateMenuButton} from 'resource:///org/gnome/shell/ui/dateMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

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

        const {statusArea} = Main.panel;
        const {quickSettings} = statusArea;
        const {activities} = statusArea;

        this._setPanelMenu('quickSettings', quickSettings.constructor, this._rightBox);
        this._setPanelMenu('dateMenu', DateMenuButton, this._centerBox);
        this._setPanelMenu('activities', activities.constructor, this._leftBox);
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
