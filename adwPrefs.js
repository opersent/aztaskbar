const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const {Adw, Gdk, GdkPixbuf, Gio, GLib, GObject, Gtk} = imports.gi;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;


function init() {
    ExtensionUtils.initTranslations();
}

var GeneralPage = GObject.registerClass(
class azTaskbar_GeneralPage extends Adw.PreferencesPage {
    _init() {
        super._init({
            title: _("Settings"),
            icon_name: 'preferences-system-symbolic',
            name: 'GeneralPage'
        });

        this._settings = ExtensionUtils.getSettings();

        let generalGroup = new Adw.PreferencesGroup({
            title: _("General Settings")
        });
        this.add(generalGroup);

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
        generalGroup.add(toolTipsRow);

        let runningAppsGroup = new Adw.PreferencesGroup({
            title: _("Running Apps Settings")
        });
        this.add(runningAppsGroup);

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
        runningAppsGroup.add(isolateWorkspacesRow);

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
        runningAppsGroup.add(isolateMonitorsRow);

        let windowPreviewsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER
        });
        let windowPreviewsRow = new Adw.ActionRow({
            title: _("Window Previews"),
            activatable_widget: windowPreviewsSwitch
        });
        windowPreviewsSwitch.set_active(this._settings.get_boolean('window-previews'));
        windowPreviewsSwitch.connect('notify::active', (widget) => {
            this._settings.set_boolean('window-previews', widget.get_active());
        });
        windowPreviewsRow.add_suffix(windowPreviewsSwitch);
        runningAppsGroup.add(windowPreviewsRow);

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
        runningAppsGroup.add(indicatorRow);
    }
});

var AboutPage = GObject.registerClass(
class azTaskbar_AboutPage extends Adw.PreferencesPage {
    _init() {
        super._init({
            title: _("About"),
            icon_name: 'info-circle-symbolic',
            name: 'AboutPage'
        });

        //ArcMenu Logo and project description-------------------------------------
        let arcMenuLogoGroup = new Adw.PreferencesGroup();
        let arcMenuImage = new Gtk.Image({
            margin_bottom: 5,
            icon_name: 'arc-menu-logo',
            pixel_size: 100,
        });
        let arcMenuImageBox = new Gtk.Box( {
            orientation: Gtk.Orientation.VERTICAL,
            hexpand: false,
            vexpand: false
        });
        arcMenuImageBox.append(arcMenuImage);
        let arcMenuLabel = new Gtk.Label({
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
        arcMenuImageBox.append(arcMenuLabel);
        arcMenuImageBox.append(projectDescriptionLabel);
        arcMenuLogoGroup.add(arcMenuImageBox);

        this.add(arcMenuLogoGroup);
        //-----------------------------------------------------------------------

        //Extension/OS Info Group------------------------------------------------
        let extensionInfoGroup = new Adw.PreferencesGroup();
        let arcMenuVersionRow = new Adw.ActionRow({
            title: _("App Icons Taskbar Version"),
        });
        let releaseVersion;
        if(Me.metadata.version)
            releaseVersion = Me.metadata.version;
        else
            releaseVersion = 'unknown';
        arcMenuVersionRow.add_suffix(new Gtk.Label({
            label: releaseVersion + ''
        }));
        extensionInfoGroup.add(arcMenuVersionRow);

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

var GNU_SOFTWARE = '<span size="small">' +
    'This program comes with absolutely no warranty.\n' +
    'See the <a href="https://gnu.org/licenses/old-licenses/gpl-2.0.html">' +
    'GNU General Public License, version 2 or later</a> for details.' +
    '</span>';
