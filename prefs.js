const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const {Gdk, GdkPixbuf, Gio, GLib, GObject, Gtk} = imports.gi;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

function init() {
    ExtensionUtils.initTranslations();
}

var GeneralPage = GObject.registerClass(
class azTaskbar_GeneralPage extends Gtk.ScrolledWindow {
    _init(settings) {
        super._init();
        this.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);

        this.mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 64,
            margin_end: 64,
            spacing: 20,
            homogeneous: false
        });
        this.set_child(this.mainBox);

        this._settings = settings;

        this.mainBox.append(new Gtk.Label({
            label: "<b>" + _("General") + "</b>",
            use_markup: true,
            xalign: 0
        }))
        let generalGroup = new FrameBox();
        this.mainBox.append(generalGroup);

        let favoritesSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        let favoritesRow = new FrameBoxRow();
        favoritesRow.add(new Gtk.Label({
            label: _("Favorites"),
            use_markup: true,
            xalign: 0
        }))
        favoritesSwitch.set_active(this._settings.get_boolean('favorites'));
        favoritesSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('favorites', widget.get_active());
        });
        favoritesRow.add(favoritesSwitch);
        generalGroup.add(favoritesRow);

        let iconSizeSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 15, upper: 50, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.END,
            hexpand: true
        });
        iconSizeSpinButton.set_value(this._settings.get_int('icon-size'));
        iconSizeSpinButton.connect('value-changed', (widget) => {
            this._settings.set_int('icon-size', widget.get_value());
        });
        let iconSizeRow = new FrameBoxRow();
        iconSizeRow.add(new Gtk.Label({
            label: _("Icon Size"),
            use_markup: true,
            xalign: 0
        }))
        iconSizeRow.add(iconSizeSpinButton);
        generalGroup.add(iconSizeRow);

        let isolateWorkspacesSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        let isolateWorkspacesRow = new FrameBoxRow();
        isolateWorkspacesRow.add(new Gtk.Label({
            label: _("Isolate Workspaces"),
            use_markup: true,
            xalign: 0
        }))
        isolateWorkspacesSwitch.set_active(this._settings.get_boolean('isolate-workspaces'));
        isolateWorkspacesSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('isolate-workspaces', widget.get_active());
        });
        isolateWorkspacesRow.add(isolateWorkspacesSwitch);
        generalGroup.add(isolateWorkspacesRow);

        let isolateMonitorsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        let isolateMonitorsRow = new FrameBoxRow();
        isolateMonitorsRow.add(new Gtk.Label({
            label: _("Isolate Monitors"),
            use_markup: true,
            xalign: 0
        }))
        isolateMonitorsSwitch.set_active(this._settings.get_boolean('isolate-monitors'));
        isolateMonitorsSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('isolate-monitors', widget.get_active());
        });
        isolateMonitorsRow.add(isolateMonitorsSwitch);
        generalGroup.add(isolateMonitorsRow);

        this.mainBox.append(new Gtk.Label({
            label: "<b>" + _("Indicator") + "</b>",
            use_markup: true,
            xalign: 0
        }))
        let indicatorsGroup = new FrameBox();
        this.mainBox.append(indicatorsGroup);

        let indicatorSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        let indicatorRow = new FrameBoxRow();
        indicatorRow.add(new Gtk.Label({
            label: _("Indicators"),
            use_markup: true,
            xalign: 0
        }))
        indicatorSwitch.set_active(this._settings.get_boolean('indicators'));
        indicatorSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('indicators', widget.get_active());
        });
        indicatorRow.add(indicatorSwitch);
        indicatorsGroup.add(indicatorRow);

        let indicatorLocationCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        indicatorLocationCombo.append_text(_('Top'));
        indicatorLocationCombo.append_text(_('Bottom'));
        indicatorLocationCombo.set_active(this._settings.get_enum('indicator-location'));
        indicatorLocationCombo.connect('changed', (widget) => {
            this._settings.set_enum('indicator-location', widget.get_active());
        });
        let indicatorLocationRow = new FrameBoxRow();
        indicatorLocationRow.add(new Gtk.Label({
            label: _("Indicator Location"),
            use_markup: true,
            xalign: 0
        }))
        indicatorLocationRow.add(indicatorLocationCombo);
        indicatorsGroup.add(indicatorLocationRow);

        let color = new Gdk.RGBA();
        color.parse(this._settings.get_string('indicator-color-running'));
        let indicatorRunningColorButton = new Gtk.ColorButton({
            rgba: color,
            use_alpha: true,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        indicatorRunningColorButton.connect('color-set', (widget) => {
            const color = widget.get_rgba().to_string();
            this._settings.set_string('indicator-color-running', color);
        });
        let indicatorRunningRow = new FrameBoxRow();
        indicatorRunningRow.add(new Gtk.Label({
            label: _("Running Indicator Color"),
            use_markup: true,
            xalign: 0
        }))
        indicatorRunningRow.add(indicatorRunningColorButton);
        indicatorsGroup.add(indicatorRunningRow);

        color = new Gdk.RGBA();
        color.parse(this._settings.get_string('indicator-color-focused'));
        let indicatorFocusedColorButton = new Gtk.ColorButton({
            rgba: color,
            use_alpha: true,
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        indicatorFocusedColorButton.connect('color-set', (widget) => {
            const color = widget.get_rgba().to_string();
            this._settings.set_string('indicator-color-focused', color);
        });

        let indicatorFocusedRow = new FrameBoxRow();
        indicatorFocusedRow.add(new Gtk.Label({
            label: _("Focused Indicator Color"),
            use_markup: true,
            xalign: 0
        }))
        indicatorFocusedRow.add(indicatorFocusedColorButton);
        indicatorsGroup.add(indicatorFocusedRow);
    }
});

var ActionsPage = GObject.registerClass(
class azTaskbar_ActionsPage extends Gtk.ScrolledWindow {
    _init(settings) {
        super._init();
        this.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);

        this.mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 64,
            margin_end: 64,
            spacing: 20,
            homogeneous: false
        });
        this.set_child(this.mainBox);

        this._settings = settings;

        this.mainBox.append(new Gtk.Label({
            label: "<b>" + _("Click Actions") + "</b>",
            use_markup: true,
            xalign: 0
        }))
        let clickActionGroup = new FrameBox();
        this.mainBox.append(clickActionGroup);

        let clickOptionsCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        clickOptionsCombo.append_text(_('Toggle / Cycle'));
        clickOptionsCombo.append_text(_('Toggle / Cycle + Minimize'));
        clickOptionsCombo.append_text(_('Toggle / Preview'));
        clickOptionsCombo.set_active(this._settings.get_enum('click-action'));
        clickOptionsCombo.connect('changed', (widget) => {
            this._settings.set_enum('click-action', widget.get_active());
        });
        let clickOptionsRow = new FrameBoxRow();
        clickOptionsRow.add(new Gtk.Label({
            label: _("Left Click") + '\n<span size="smaller">' + _("Modify Left Click Action of Running App Icons") + "</span>",
            use_markup: true,
            xalign: 0
        }))
        clickOptionsRow.add(clickOptionsCombo);
        clickActionGroup.add(clickOptionsRow);

        this.mainBox.append(new Gtk.Label({
            label: "<b>" + _("Scroll Action") + "</b>",
            use_markup: true,
            xalign: 0
        }))
        let scrollOptionsGroup = new FrameBox();
        this.mainBox.append(scrollOptionsGroup);

        let scrollOptionsCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        scrollOptionsCombo.append_text(_('No Action'));
        scrollOptionsCombo.append_text(_('Cycle Windows'));
        //clickOptionsCombo.set_active(this._settings.get_enum('click-action'));
        scrollOptionsCombo.connect('changed', (widget) => {
            //this._settings.set_enum('click-action', widget.get_active());
        });
        let scrollOptionsRow = new FrameBoxRow();
        scrollOptionsRow.add(new Gtk.Label({
            label: _("Scroll Action"),
            use_markup: true,
            xalign: 0
        }))
        scrollOptionsRow.add(scrollOptionsCombo);
        scrollOptionsGroup.add(scrollOptionsRow);

        this.mainBox.append(new Gtk.Label({
            label: "<b>" + _("Hover Actions") + "</b>",
            use_markup: true,
            xalign: 0
        }))
        let hoverActionGroup = new FrameBox();
        this.mainBox.append(hoverActionGroup);

        let toolTipsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        let toolTipsRow = new FrameBoxRow();
        toolTipsRow.add(new Gtk.Label({
            label: _("Tool-Tips"),
            use_markup: true,
            xalign: 0
        }))
        toolTipsSwitch.set_active(this._settings.get_boolean('tool-tips'));
        toolTipsSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('tool-tips', widget.get_active());
        });
        toolTipsRow.add(toolTipsSwitch);
        hoverActionGroup.add(toolTipsRow);

        let windowPreviewsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
            hexpand: true,
            halign: Gtk.Align.END
        });
        let windowPreviewsRow = new FrameBoxRow();
        windowPreviewsRow.add(new Gtk.Label({
            label: _("Window Previews"),
            use_markup: true,
            xalign: 0
        }))
        windowPreviewsSwitch.set_active(this._settings.get_boolean('window-previews'));
        windowPreviewsSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('window-previews', widget.get_active());
        });
        windowPreviewsRow.add(windowPreviewsSwitch);
        hoverActionGroup.add(windowPreviewsRow);
    }
});

var AboutPage = GObject.registerClass(
class azTaskbar_AboutPage extends Gtk.ScrolledWindow {
    _init() {
        super._init();
        this.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);

        this.mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 64,
            margin_end: 64,
            spacing: 0,
            homogeneous: false
        });
        this.set_child(this.mainBox);

        let releaseVersion;
        if(Me.metadata.version)
            releaseVersion = Me.metadata.version;
        else
            releaseVersion = 'unknown';

        let commitVersion;
        if(Me.metadata.commit)
            commitVersion = Me.metadata.commit;

        let projectUrl = Me.metadata.url;

        let arcMenuImage = new Gtk.Image({
            margin_bottom: 5,
            icon_name: 'arc-menu-logo',
            pixel_size: 100,
        });
        let arcMenuImageBox = new Gtk.Box( {
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 10,
            margin_bottom: 10,
            hexpand: false,
            vexpand: false
        });
        arcMenuImageBox.append(arcMenuImage);

        let arcMenuInfoBox = new Gtk.Box( {
            orientation: Gtk.Orientation.VERTICAL,
            hexpand: false,
            vexpand: false
        });
        let arcMenuLabel = new Gtk.Label({
            label: '<span size="large"><b>' + _('App Icons Taskbar') + '</b></span>',
            use_markup: true,
            vexpand: true,
            valign: Gtk.Align.FILL
        });

        let projectDescriptionLabel = new Gtk.Label({
            label: _('Show running apps and favorites on the main panel'),
            hexpand: false,
            vexpand: false,
            margin_bottom: 5
        });

        let extensionInfoFrame = new FrameBox();

        let arcMenuVersionRow = new FrameBoxRow({
            selectable: false,
            activatable: false
        });
        let versionText = new Gtk.Label({
            label: _('App Icons Taskbar Version'),
        });
        let versionInfo = new Gtk.Label({
            label: releaseVersion + '',
            hexpand: true,
            sensitive: false,
            halign: Gtk.Align.END
        });
        arcMenuVersionRow.add(versionText);
        arcMenuVersionRow.add(versionInfo);
        extensionInfoFrame.add(arcMenuVersionRow);

        let commitRow = new FrameBoxRow();
        let commitText = new Gtk.Label({
            label: _('Git Commit'),
        });
        let commitInfo = new Gtk.Label({
            label: commitVersion ? commitVersion : '',
            hexpand: true,
            sensitive: false,
            halign: Gtk.Align.END
        });
        commitRow.add(commitText);
        commitRow.add(commitInfo);
        if(commitVersion){
            extensionInfoFrame.add(this.createSeparator());
            extensionInfoFrame.add(commitRow);
        }

        let gnomeVersionRow = new FrameBoxRow({
            selectable: false,
            activatable: false
        });
        let gnomeVersionText = new Gtk.Label({
            label: _('GNOME Version'),
        });
        let gnomeVersionInfo = new Gtk.Label({
            label: imports.misc.config.PACKAGE_VERSION + '',
            hexpand: true,
            sensitive: false,
            halign: Gtk.Align.END
        });
        gnomeVersionRow.add(gnomeVersionText);
        gnomeVersionRow.add(gnomeVersionInfo);
        extensionInfoFrame.add(this.createSeparator());
        extensionInfoFrame.add(gnomeVersionRow);

        let osRow = new FrameBoxRow({
            selectable: false,
            activatable: false
        });
        let osText = new Gtk.Label({
            label: _('OS'),
        });
        let osInfoText;
        let name = GLib.get_os_info("NAME");
        let prettyName = GLib.get_os_info("PRETTY_NAME");
        if(prettyName)
            osInfoText = prettyName;
        else
            osInfoText = name;
        let versionID = GLib.get_os_info("VERSION_ID");
        if(versionID)
            osInfoText += "; Version ID: " + versionID;
        let buildID = GLib.get_os_info("BUILD_ID");
        if(buildID)
            osInfoText += "; " + "Build ID: " +buildID;

        let osInfo = new Gtk.Label({
            label: osInfoText,
            hexpand: true,
            sensitive: false,
            halign: Gtk.Align.END
        });
        osRow.add(osText);
        osRow.add(osInfo);
        extensionInfoFrame.add(this.createSeparator());
        extensionInfoFrame.add(osRow);

        let windowingRow = new FrameBoxRow({
            selectable: false,
            activatable: false
        });
        let windowingText = new Gtk.Label({
            label: _('Session Type'),
        });
        let windowingLabel;
        if(Me.metadata.isWayland)
            windowingLabel = "Wayland";
        else
            windowingLabel = "X11";

        let windowingInfo = new Gtk.Label({
            label: windowingLabel,
            hexpand: true,
            sensitive: false,
            halign: Gtk.Align.END
        });
        windowingRow.add(windowingText);
        windowingRow.add(windowingInfo);
        extensionInfoFrame.add(this.createSeparator());
        extensionInfoFrame.add(windowingRow);

        let linksBox = new Gtk.Box({
            hexpand: false,
            vexpand: false,
            valign: Gtk.Align.END,
            halign: Gtk.Align.CENTER,
            margin_top: 0,
            margin_bottom: 0,
            margin_start: 0,
            margin_end: 0,
            spacing: 0,
        });

        let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(Me.path + '/media/donate-icon.svg', 150, 50);
        let donateImage = Gtk.Picture.new_for_pixbuf(pixbuf);
        let donateLinkButton = new Gtk.LinkButton({
            child: donateImage,
            uri: 'https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=53CWA7NR743WC&item_name=Donate+to+support+my+work&currency_code=USD&source=url',
        });

        pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(Me.path + '/media/gitlab-icon.svg', 150, 50);
        let gitlabImage = Gtk.Picture.new_for_pixbuf(pixbuf);
        let projectLinkButton = new Gtk.LinkButton({
            child: gitlabImage,
            uri: projectUrl,
        });

        linksBox.append(projectLinkButton);
        linksBox.append(donateLinkButton);

        arcMenuImageBox.append(arcMenuLabel);
        arcMenuImageBox.append(projectDescriptionLabel);

        let gnuSofwareLabel = new Gtk.Label({
            label: _(GNU_SOFTWARE),
            use_markup: true,
            justify: Gtk.Justification.CENTER
        });
        let gnuSofwareLabelBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.END,
            vexpand: true,
            margin_top: 5,
            margin_bottom: 10
        });
        gnuSofwareLabelBox.append(gnuSofwareLabel);

        this.mainBox.append(arcMenuImageBox);
        this.mainBox.append(arcMenuInfoBox);
        this.mainBox.append(extensionInfoFrame);

        this.mainBox.append(gnuSofwareLabelBox);
        this.mainBox.append(linksBox);
    }

    createSeparator(){
        let separatorRow = new Gtk.ListBoxRow({
            selectable: false,
            activatable: false
        });
        separatorRow.set_child(Gtk.Separator.new(Gtk.Orientation.HORIZONTAL));
        return separatorRow;
    }
});

function fillPreferencesWindow(window) {
    let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    if(!iconTheme.get_search_path().includes(Me.path + "/media"))
        iconTheme.add_search_path(Me.path + "/media");

    const AdwPrefs = Me.imports.adwPrefs;

    const settings = ExtensionUtils.getSettings();

    window.set_search_enabled(true);

    const generalPage = new AdwPrefs.GeneralPage(settings);
    window.add(generalPage);

    const actionsPage = new AdwPrefs.ActionsPage(settings);
    window.add(actionsPage);

    const aboutPage = new AdwPrefs.AboutPage();
    window.add(aboutPage);
}

function buildPrefsWidget(){
    let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    if(!iconTheme.get_search_path().includes(Me.path + "/media"))
        iconTheme.add_search_path(Me.path + "/media");

    const settings = ExtensionUtils.getSettings();

    let notebook = new Gtk.Notebook();

    notebook.append_page(new GeneralPage(settings), new Gtk.Label({
        label: "<b>" + _("Settings") + "</b>",
        use_markup: true,
        xalign: 0
    }));

    notebook.append_page(new ActionsPage(settings), new Gtk.Label({
        label: "<b>" + _("Actions") + "</b>",
        use_markup: true,
        xalign: 0
    }));

    notebook.append_page(new AboutPage(), new Gtk.Label({
        label: "<b>" + _("About") + "</b>",
        use_markup: true,
        xalign: 0
    }));

    notebook.connect("realize", () => {
        let window = notebook.get_root();

        window.default_width = 650;
        window.default_height = 600;
    });

    notebook.show();
    return notebook;
}

var GNU_SOFTWARE = '<span size="small">' +
    'This program comes with absolutely no warranty.\n' +
    'See the <a href="https://gnu.org/licenses/old-licenses/gpl-2.0.html">' +
    'GNU General Public License, version 2 or later</a> for details.' +
    '</span>';

var FrameBox = GObject.registerClass(class azTaskbar_FrameBox extends Gtk.Frame {
    _init(params) {
        super._init(params);
        this._listBox = new Gtk.ListBox();
        this._listBox.set_selection_mode(Gtk.SelectionMode.NONE);
        Gtk.Frame.prototype.set_child.call(this, this._listBox);
    }

    add(boxRow) {
        this._listBox.append(boxRow);
    }

    show() {
        this._listBox.show();
        super.show();
    }
});

var FrameBoxRow = GObject.registerClass(class azTaskbar_FrameBoxRow extends Gtk.ListBoxRow {
    _init(params) {
        super._init(params);
        this.selectable = false;
        this.activatable = false;
        this._grid = new Gtk.Grid({
            orientation: Gtk.Orientation.HORIZONTAL,
            margin_top: 5,
            margin_bottom: 5,
            margin_start: 5,
            margin_end: 5,
            column_spacing: 20,
            row_spacing: 20
        });
        this.x = 0;
        Gtk.ListBoxRow.prototype.set_child.call(this, this._grid);
    }

    add(widget) {
        this._grid.attach(widget, this.x, 0, 1, 1);
        this.x++;
    }
});
