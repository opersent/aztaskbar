const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const {Adw, Gdk, GdkPixbuf, Gio, GLib, GObject, Gtk} = imports.gi;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

var GeneralPage = GObject.registerClass(
class azTaskbar_GeneralPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _("Settings"),
            icon_name: 'preferences-system-symbolic',
            name: 'GeneralPage'
        });

        this._settings = settings;

        let generalGroup = new Adw.PreferencesGroup({
            title: _("General")
        });
        this.add(generalGroup);

        let panelPositions = new Gtk.StringList();
        panelPositions.append(_("Left"));
        panelPositions.append(_("Center"));
        panelPositions.append(_("Right"));
        let panelPositionRow = new Adw.ComboRow({
            title: _("Position in Panel"),
            model: panelPositions,
            selected: this._settings.get_enum('position-in-panel')
        });
        panelPositionRow.connect("notify::selected", (widget) => {
            this._settings.set_enum('position-in-panel', widget.selected);
        });
        generalGroup.add(panelPositionRow);

        let positionOffsetSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 15, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        positionOffsetSpinButton.set_value(this._settings.get_int('position-offset'));
        positionOffsetSpinButton.connect('value-changed', (widget) => {
            this._settings.set_int('position-offset', widget.get_value());
        });
        let positionOffsetRow = new Adw.ActionRow({
            title: _("Position Offset"),
            subtitle: _("Offset the position within the above selected box"),
            activatable_widget: positionOffsetSpinButton
        });
        positionOffsetRow.add_suffix(positionOffsetSpinButton);
        generalGroup.add(positionOffsetRow);

        let [panelHeightOverride, panelHeight] = this._settings.get_value('main-panel-height').deep_unpack();

        let panelHeightSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        panelHeightSwitch.connect('notify::active', (widget) => {
            let [oldEnabled_, oldValue] = this._settings.get_value('main-panel-height').deep_unpack();
            this._settings.set_value('main-panel-height', new GLib.Variant('(bi)', [widget.get_active(), oldValue]));
            if(widget.get_active())
                panelHeightSpinButton.set_sensitive(true);
            else
                panelHeightSpinButton.set_sensitive(false);
        });
        let panelHeightSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 60,
                step_increment: 1
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
            value: panelHeight,
            sensitive: panelHeightOverride
        });
        panelHeightSpinButton.connect('value-changed', (widget) => {
            let [oldEnabled, oldValue_] = this._settings.get_value('main-panel-height').deep_unpack();
            this._settings.set_value('main-panel-height', new GLib.Variant('(bi)', [oldEnabled, widget.get_value()]));
        });

        let panelHeightRow = new Adw.ActionRow({
            title: _('Panel Height'),
            activatable_widget: panelHeightSwitch
        });
        panelHeightRow.add_suffix(panelHeightSwitch);
        panelHeightRow.add_suffix(new Gtk.Separator({
            orientation: Gtk.Orientation.VERTICAL,
            margin_top: 10,
            margin_bottom: 10
        }));
        panelHeightRow.add_suffix(panelHeightSpinButton);
        panelHeightSwitch.set_active(panelHeightOverride);
        generalGroup.add(panelHeightRow);

        let iconSizeSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 15, upper: 50, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        iconSizeSpinButton.set_value(this._settings.get_int('icon-size'));
        iconSizeSpinButton.connect('value-changed', (widget) => {
            this._settings.set_int('icon-size', widget.get_value());
        });
        let iconSizeRow = new Adw.ActionRow({
            title: _("Icon Size"),
            activatable_widget: iconSizeSpinButton
        });
        iconSizeRow.add_suffix(iconSizeSpinButton);
        generalGroup.add(iconSizeRow);

        let desatureFactorSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0.0, upper: 1.0, step_increment: 0.05, page_increment: 0.1, page_size: 0,
            }),
            climb_rate: 0.05,
            digits: 2,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        desatureFactorSpinButton.set_value(this._settings.get_double('desaturation-factor'));
        desatureFactorSpinButton.connect('value-changed', (widget) => {
            this._settings.set_double('desaturation-factor', widget.get_value());
        });
        let desatureFactorRow = new Adw.ActionRow({
            title: _("Icon Desaturate Factor"),
            activatable_widget: desatureFactorSpinButton
        });
        desatureFactorRow.add_suffix(desatureFactorSpinButton);
        generalGroup.add(desatureFactorRow);

        let iconStyles = new Gtk.StringList();
        iconStyles.append(_("Regular"));
        iconStyles.append(_("Symbolic"));
        let iconStyleRow = new Adw.ComboRow({
            title: _("Icon Style"),
            subtitle: _("Icon themes may not have a symbolic icon for every app"),
            model: iconStyles,
            selected: this._settings.get_enum('icon-style')
        });
        iconStyleRow.connect("notify::selected", (widget) => {
            this._settings.set_enum('icon-style', widget.selected);
        });
        generalGroup.add(iconStyleRow);

        let favoritesSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        let favoritesRow = new Adw.ActionRow({
            title: _("Favorites"),
            activatable_widget: favoritesSwitch
        });
        favoritesSwitch.set_active(this._settings.get_boolean('favorites'));
        favoritesSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('favorites', widget.get_active());
        });
        favoritesRow.add_suffix(favoritesSwitch);
        generalGroup.add(favoritesRow);

        let isolateWorkspacesSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        let isolateWorkspacesRow = new Adw.ActionRow({
            title: _("Isolate Workspaces"),
            activatable_widget: isolateWorkspacesSwitch
        });
        isolateWorkspacesSwitch.set_active(this._settings.get_boolean('isolate-workspaces'));
        isolateWorkspacesSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('isolate-workspaces', widget.get_active());
        });
        isolateWorkspacesRow.add_suffix(isolateWorkspacesSwitch);
        generalGroup.add(isolateWorkspacesRow);

        let isolateMonitorsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        let isolateMonitorsRow = new Adw.ActionRow({
            title: _("Isolate Monitors"),
            activatable_widget: isolateMonitorsSwitch
        });
        isolateMonitorsSwitch.set_active(this._settings.get_boolean('isolate-monitors'));
        isolateMonitorsSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('isolate-monitors', widget.get_active());
        });
        isolateMonitorsRow.add_suffix(isolateMonitorsSwitch);
        generalGroup.add(isolateMonitorsRow);

        let indicatorGroup = new Adw.PreferencesGroup({
            title: _("Indicator")
        });
        this.add(indicatorGroup);

        let multiWindowIndicatorSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        let multiWindowIndicatorRow = new Adw.ActionRow({
            title: _("Multi-Window Indicator"),
            activatable_widget: multiWindowIndicatorSwitch
        });
        multiWindowIndicatorSwitch.set_active(this._settings.get_boolean('multi-window-indicator'));
        multiWindowIndicatorSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('multi-window-indicator', widget.get_active());
        });
        multiWindowIndicatorRow.add_suffix(multiWindowIndicatorSwitch);
        indicatorGroup.add(multiWindowIndicatorRow);

        let indicatorSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        let indicatorRow = new Adw.ActionRow({
            title: _("Indicators"),
            activatable_widget: indicatorSwitch
        });
        indicatorSwitch.set_active(this._settings.get_boolean('indicators'));
        indicatorSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('indicators', widget.get_active());
        });
        indicatorRow.add_suffix(indicatorSwitch);
        indicatorGroup.add(indicatorRow);

        let indicatorLocations = new Gtk.StringList();
        indicatorLocations.append(_("Top"));
        indicatorLocations.append(_("Bottom"));
        let indicatorLocationRow = new Adw.ComboRow({
            title: _("Indicator Location"),
            model: indicatorLocations,
            selected: this._settings.get_enum('indicator-location')
        });
        indicatorLocationRow.connect("notify::selected", (widget) => {
            this._settings.set_enum('indicator-location', widget.selected);
        });
        indicatorGroup.add(indicatorLocationRow);

        let color = new Gdk.RGBA();
        color.parse(this._settings.get_string('indicator-color-running'));
        let indicatorRunningColorButton = new Gtk.ColorButton({
            rgba: color,
            use_alpha: true,
            valign: Gtk.Align.CENTER
        });
        indicatorRunningColorButton.connect('color-set', (widget) => {
            const color = widget.get_rgba().to_string();
            this._settings.set_string('indicator-color-running', color);
        });
        let indicatorRunningRow = new Adw.ActionRow({
            title: _("Running Indicator Color"),
            activatable_widget: indicatorRunningColorButton
        });
        indicatorRunningRow.add_suffix(indicatorRunningColorButton);
        indicatorGroup.add(indicatorRunningRow);

        color = new Gdk.RGBA();
        color.parse(this._settings.get_string('indicator-color-focused'));
        let indicatorFocusedColorButton = new Gtk.ColorButton({
            rgba: color,
            use_alpha: true,
            valign: Gtk.Align.CENTER
        });
        indicatorFocusedColorButton.connect('color-set', (widget) => {
            const color = widget.get_rgba().to_string();
            this._settings.set_string('indicator-color-focused', color);
        });

        let indicatorFocusedRow = new Adw.ActionRow({
            title: _("Focused Indicator Color"),
            activatable_widget: indicatorFocusedColorButton
        });
        indicatorFocusedRow.add_suffix(indicatorFocusedColorButton);
        indicatorGroup.add(indicatorFocusedRow);
    }
});

var ActionsPage = GObject.registerClass(
class azTaskbar_ActionsPage extends Adw.PreferencesPage {
    _init(settings) {
        super._init({
            title: _("Actions"),
            icon_name: 'input-mouse-symbolic',
            name: 'ActionsPage'
        });
        this._settings = settings;

        let clickActionGroup = new Adw.PreferencesGroup({
            title: _("Click Actions")
        });
        this.add(clickActionGroup);

        let clickOptions = new Gtk.StringList();
        clickOptions.append(_("Toggle / Cycle"));
        clickOptions.append(_("Toggle / Cycle + Minimize"));
        clickOptions.append(_("Toggle / Preview"));
        let clickOptionsRow = new Adw.ComboRow({
            title: _("Left Click"),
            subtitle: _("Modify Left Click Action of Running App Icons"),
            model: clickOptions,
            selected: this._settings.get_enum('click-action')
        });
        clickOptionsRow.connect("notify::selected", (widget) => {
            this._settings.set_enum('click-action', widget.selected);
        });
        clickActionGroup.add(clickOptionsRow);

        let scrollActionGroup = new Adw.PreferencesGroup({
            title: _("Scroll Actions")
        });
        this.add(scrollActionGroup);

        let scrollOptions = new Gtk.StringList();
        scrollOptions.append(_("Cycle Windows"));
        scrollOptions.append(_("No Action"));
        let scrollOptionsRow = new Adw.ComboRow({
            title: _("Scroll Action"),
            model: scrollOptions,
            selected: this._settings.get_enum('scroll-action')
        });
        scrollOptionsRow.connect("notify::selected", (widget) => {
            this._settings.set_enum('scroll-action', widget.selected);
        });
        scrollActionGroup.add(scrollOptionsRow);

        let hoverActionGroup = new Adw.PreferencesGroup({
            title: _("Hover Actions")
        });
        this.add(hoverActionGroup);

        let toolTipsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        let toolTipsRow = new Adw.ActionRow({
            title: _("Tool-Tips"),
            activatable_widget: toolTipsSwitch
        });
        toolTipsSwitch.set_active(this._settings.get_boolean('tool-tips'));
        toolTipsSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('tool-tips', widget.get_active());
        });
        toolTipsRow.add_suffix(toolTipsSwitch);
        hoverActionGroup.add(toolTipsRow);

        let windowPreviewsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        let windowPreviewsOptionsButton = new Gtk.Button({
            child: new Adw.ButtonContent({ icon_name: 'emblem-system-symbolic' }),
            valign: Gtk.Align.CENTER
        });
        windowPreviewsOptionsButton.connect('clicked', () => {
            let windowPreviewOptions = new WindowPreviewOptions(this.get_root(), this._settings);
            windowPreviewOptions.show();
        })
        let windowPreviewsRow = new Adw.ActionRow({
            title: _("Window Previews"),
            activatable_widget: windowPreviewsSwitch
        });
        windowPreviewsSwitch.set_active(this._settings.get_boolean('window-previews'));
        windowPreviewsOptionsButton.set_sensitive(this._settings.get_boolean('window-previews'));
        windowPreviewsSwitch.connect('notify::active', (widget) => {
            windowPreviewsOptionsButton.set_sensitive(widget.get_active());
            this._settings.set_boolean('window-previews', widget.get_active());
        });
        windowPreviewsRow.add_suffix(windowPreviewsOptionsButton);
        windowPreviewsRow.add_suffix(windowPreviewsSwitch);
        hoverActionGroup.add(windowPreviewsRow);
    }
});

var WindowPreviewOptions = GObject.registerClass(
class azTaskbar_WindowPreviewOptions extends Gtk.Window {
    _init(parent, settings) {
        super._init({
            title: _("Window Preview Options"),
            transient_for: parent,
            modal: true,
            default_width: 600,
            default_height: 425
        });

        this._settings = settings;

        let mainPage = new Adw.PreferencesPage();
        this.set_child(mainPage);

        let windowPreviewsGroup = new Adw.PreferencesGroup({
            title: _("Window Previews")
        });
        mainPage.add(windowPreviewsGroup);

        let showDelaySpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 1200, step_increment: 100, page_increment: 100, page_size: 0,
            }),
            climb_rate: 100,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        showDelaySpinButton.set_value(this._settings.get_int('window-previews-show-timeout'));
        showDelaySpinButton.connect('value-changed', (widget) => {
            this._settings.set_int('window-previews-show-timeout', widget.get_value());
        });
        let showDelaySpinRow = new Adw.ActionRow({
            title: _("Show Window Previews Delay"),
            subtitle: _("Time in ms to show the window preview"),
            activatable_widget: showDelaySpinButton
        });
        showDelaySpinRow.add_suffix(showDelaySpinButton);
        windowPreviewsGroup.add(showDelaySpinRow);

        let hideDelaySpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 1200, step_increment: 100, page_increment: 100, page_size: 0,
            }),
            climb_rate: 100,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        hideDelaySpinButton.set_value(this._settings.get_int('window-previews-hide-timeout'));
        hideDelaySpinButton.connect('value-changed', (widget) => {
            this._settings.set_int('window-previews-hide-timeout', widget.get_value());
        });
        let hideDelaySpinRow = new Adw.ActionRow({
            title: _("Hide Window Previews Delay"),
            subtitle: _("Time in ms to hide the window preview"),
            activatable_widget: hideDelaySpinButton
        });
        hideDelaySpinRow.add_suffix(hideDelaySpinButton);
        windowPreviewsGroup.add(hideDelaySpinRow);

        let windowPeekGroup = new Adw.PreferencesGroup({
            title: _("Window Peeking")
        });
        mainPage.add(windowPeekGroup);

        let enablePeekSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        let enablePeekRow = new Adw.ActionRow({
            title: _("Window Peeking"),
            subtitle: _("Hovering a window preview will focus desired window"),
            activatable_widget: enablePeekSwitch
        });
        enablePeekSwitch.set_active(this._settings.get_boolean('peek-windows'));
        enablePeekSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('peek-windows', widget.get_active());
        });
        enablePeekRow.add_suffix(enablePeekSwitch);
        windowPeekGroup.add(enablePeekRow);

        let peekTimeoutSpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 800, step_increment: 100, page_increment: 100, page_size: 0,
            }),
            climb_rate: 100,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        peekTimeoutSpinButton.set_value(this._settings.get_int('peek-windows-timeout'));
        peekTimeoutSpinButton.connect('value-changed', (widget) => {
            this._settings.set_int('peek-windows-timeout', widget.get_value());
        });
        let peekTimeoutSpinRow = new Adw.ActionRow({
            title: _("Window Peeking Delay"),
            subtitle: _("Time in ms to trigger window peek"),
            activatable_widget: peekTimeoutSpinButton
        });
        peekTimeoutSpinRow.add_suffix(peekTimeoutSpinButton);
        windowPeekGroup.add(peekTimeoutSpinRow);

        let peekOpacitySpinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 255, step_increment: 1, page_increment: 1, page_size: 0,
            }),
            climb_rate: 1,
            digits: 0,
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        peekOpacitySpinButton.set_value(this._settings.get_int('peek-windows-opacity'));
        peekOpacitySpinButton.connect('value-changed', (widget) => {
            this._settings.set_int('peek-windows-opacity', widget.get_value());
        });
        let peekOpacityRow = new Adw.ActionRow({
            title: _("Window Peeking Opacity"),
            subtitle: _("Opacity of non-focused windows during a window peek"),
            activatable_widget: peekOpacitySpinButton
        });
        peekOpacityRow.add_suffix(peekOpacitySpinButton);
        windowPeekGroup.add(peekOpacityRow);
    }
});


var AboutPage = GObject.registerClass(
class azTaskbar_AboutPage extends Adw.PreferencesPage {
    _init() {
        super._init({
            title: _("About"),
            icon_name: 'help-about-symbolic',
            name: 'AboutPage'
        });

        //Logo and project description-------------------------------------
        let azTaskbarLogoGroup = new Adw.PreferencesGroup();
        let azTaskbarImage = new Gtk.Image({
            margin_bottom: 5,
            icon_name: 'aztaskbar-logo',
            pixel_size: 100,
        });
        let azTaskbarImageBox = new Gtk.Box( {
            orientation: Gtk.Orientation.VERTICAL,
            hexpand: false,
            vexpand: false
        });
        azTaskbarImageBox.append(azTaskbarImage);
        let azTaskbarLabel = new Gtk.Label({
            label: '<span size="larger"><b>' + _('App Icons Taskbar') + '</b></span>',
            use_markup: true,
            vexpand: true,
            valign: Gtk.Align.FILL
        });
        let projectDescriptionLabel = new Gtk.Label({
            label: _('Show running apps and favorites on the main panel'),
            hexpand: false,
            vexpand: false,
        });
        azTaskbarImageBox.append(azTaskbarLabel);
        azTaskbarImageBox.append(projectDescriptionLabel);
        azTaskbarLogoGroup.add(azTaskbarImageBox);

        this.add(azTaskbarLogoGroup);
        //-----------------------------------------------------------------------

        //Extension/OS Info Group------------------------------------------------
        let extensionInfoGroup = new Adw.PreferencesGroup();
        let azTaskbarVersionRow = new Adw.ActionRow({
            title: _("App Icons Taskbar Version"),
        });
        let releaseVersion;
        if(Me.metadata.version)
            releaseVersion = Me.metadata.version;
        else
            releaseVersion = 'unknown';
        azTaskbarVersionRow.add_suffix(new Gtk.Label({
            label: releaseVersion + ''
        }));
        extensionInfoGroup.add(azTaskbarVersionRow);

        let commitRow = new Adw.ActionRow({
            title: _('Git Commit')
        });
        let commitVersion;
        if(Me.metadata.commit)
            commitVersion = Me.metadata.commit;
        commitRow.add_suffix(new Gtk.Label({
            label: commitVersion ? commitVersion : '',
        }));
        if(commitVersion){
            extensionInfoGroup.add(commitRow);
        }

        let gnomeVersionRow = new Adw.ActionRow({
            title: _('GNOME Version'),
        });
        gnomeVersionRow.add_suffix(new Gtk.Label({
            label: imports.misc.config.PACKAGE_VERSION + '',
        }));
        extensionInfoGroup.add(gnomeVersionRow);

        let osRow = new Adw.ActionRow({
            title: _('OS'),
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
        osRow.add_suffix(new Gtk.Label({
            label: osInfoText,
            single_line_mode: false,
            wrap: true,
        }));
        extensionInfoGroup.add(osRow);

        let sessionTypeRow = new Adw.ActionRow({
            title: _('Session Type'),
        });
        let windowingLabel;
        if(Me.metadata.isWayland)
            windowingLabel = "Wayland";
        else
            windowingLabel = "X11";
        sessionTypeRow.add_suffix(new Gtk.Label({
            label: windowingLabel,
        }));
        extensionInfoGroup.add(sessionTypeRow);

        this.add(extensionInfoGroup);
        //-----------------------------------------------------------------------

        let linksGroup = new Adw.PreferencesGroup();
        let linksBox = new Adw.ActionRow();

        let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(Me.path + '/media/donate-icon.svg', -1, 50, true);
        let donateImage = Gtk.Picture.new_for_pixbuf(pixbuf);
        let donateLinkButton = new Gtk.LinkButton({
            child: donateImage,
            uri: 'https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=53CWA7NR743WC&item_name=Donate+to+support+my+work&currency_code=USD&source=url',
        });

        pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(Me.path + '/media/gitlab-icon.svg', -1, 50, true);
        let gitlabImage = Gtk.Picture.new_for_pixbuf(pixbuf);
        let projectUrl = Me.metadata.url;
        let projectLinkButton = new Gtk.LinkButton({
            child: gitlabImage,
            uri: projectUrl,
        });

        linksBox.add_prefix(projectLinkButton);
        linksBox.add_suffix(donateLinkButton);
        linksGroup.add(linksBox);
        this.add(linksGroup);

        let gnuSoftwareGroup = new Adw.PreferencesGroup();
        let gnuSofwareLabel = new Gtk.Label({
            label: GNU_SOFTWARE,
            use_markup: true,
            justify: Gtk.Justification.CENTER
        });
        let gnuSofwareLabelBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            valign: Gtk.Align.END,
            vexpand: true,
        });
        gnuSofwareLabelBox.append(gnuSofwareLabel);
        gnuSoftwareGroup.add(gnuSofwareLabelBox);
        this.add(gnuSoftwareGroup);
    }
});

function init() {
    ExtensionUtils.initTranslations();
}

function fillPreferencesWindow(window) {
    let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    if(!iconTheme.get_search_path().includes(Me.path + "/media"))
        iconTheme.add_search_path(Me.path + "/media");

    const settings = ExtensionUtils.getSettings();

    window.set_search_enabled(true);

    const generalPage = new GeneralPage(settings);
    window.add(generalPage);

    const actionsPage = new ActionsPage(settings);
    window.add(actionsPage);

    const aboutPage = new AboutPage();
    window.add(aboutPage);
}

var GNU_SOFTWARE = '<span size="small">' +
    'This program comes with absolutely no warranty.\n' +
    'See the <a href="https://gnu.org/licenses/old-licenses/gpl-2.0.html">' +
    'GNU General Public License, version 2 or later</a> for details.' +
    '</span>';
