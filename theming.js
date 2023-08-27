import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Enums from './enums.js';

Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async');

const FileName = 'XXXXXX-aztaskbar-stylesheet.css';

/**
 * Create and load a custom stylesheet file into global.stage St.Theme
 * @param {Extension} extension
 */
export function createStylesheet(extension) {
    try {
        const [file] = Gio.File.new_tmp(FileName);
        extension.customStylesheet = file;
        updateStylesheet(extension);
    } catch (e) {
        log(`AppIcons Taskbar - Error creating custom stylesheet: ${e}`);
    }
}

/**
 * Unload the custom stylesheet from global.stage St.Theme
 * @param {Extension} extension
 */
function unloadStylesheet(extension) {
    if (!extension.customStylesheet)
        return;

    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    theme.unload_stylesheet(extension.customStylesheet);
}

/**
 * Delete and unload the custom stylesheet file from global.stage St.Theme
 * @param {Extension} extension
 */
export async function deleteStylesheet(extension) {
    unloadStylesheet(extension);

    const stylesheet = extension.customStylesheet;

    try {
        if (stylesheet.query_exists(null))
            await stylesheet.delete_async(GLib.PRIORITY_DEFAULT, null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            log(`AppIcons Taskbar - Error deleting custom stylesheet: ${e}`);
    } finally {
        delete extension.customStylesheet;
    }
}

/**
 * Write theme data to custom stylesheet and reload into global.stage St.Theme
 * @param {Extension} extension
 */
export async function updateStylesheet(extension) {
    const settings = extension.getSettings();
    const stylesheet = extension.customStylesheet;

    if (!stylesheet) {
        log('AppIcons Taskbar - Custom stylesheet error!');
        return;
    }

    unloadStylesheet(extension);

    const [overridePanelHeight, panelHeight] = settings.get_value('main-panel-height').deep_unpack();
    const panelLocation = settings.get_enum('panel-location');

    let customStylesheetCSS = '';

    if (overridePanelHeight) {
        customStylesheetCSS += `.azTaskbar-panel{
            height: ${panelHeight}px;
        }`;

        if (panelLocation === Enums.PanelLocation.BOTTOM) {
            customStylesheetCSS += `.azTaskbar-bottom-panel #overview{
                margin-bottom: ${panelHeight}px;
            }`;
        }
    } else {
        customStylesheetCSS += `.azTaskbar-bottom-panel #overview{
            margin-bottom: 24px;
        }`;
    }

    try {
        const bytes = new GLib.Bytes(customStylesheetCSS);
        const [success, etag_] = await stylesheet.replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);

        if (!success) {
            log('AppIcons Taskbar - Failed to replace contents of custom stylesheet.');
            return;
        }

        extension.customStylesheet = stylesheet;
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        theme.load_stylesheet(extension.customStylesheet);
    } catch (e) {
        log(`AppIcons Taskbar - Error updating custom stylesheet. ${e.message}`);
    }
}
