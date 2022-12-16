const Me = imports.misc.extensionUtils.getCurrentExtension();
const {Gio, GLib, St} = imports.gi;
const Enums = Me.imports.enums;

function getStylesheetFile(){
    try {
        const directoryPath = GLib.build_filenamev([GLib.get_home_dir(), ".local/share/azTaskbar"]);
        const stylesheetPath = GLib.build_filenamev([directoryPath, "stylesheet.css"]);

        let dir = Gio.File.new_for_path(directoryPath);
        if(!dir.query_exists(null))
            dir.make_directory(null);

        let stylesheet = Gio.File.new_for_path(stylesheetPath);
        if(!stylesheet.query_exists(null))
            stylesheet.create(Gio.FileCreateFlags.NONE, null);

        return stylesheet;
    } catch (e) {
        log(`AppIcons Taskbar - Custom stylesheet error: ${e.message}`);
        return null;
    }
}

function unloadStylesheet(){
    if(!Me.customStylesheet)
        return;

    let theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    theme.unload_stylesheet(Me.customStylesheet);
}

function updateStylesheet(settings){
    let stylesheet = Me.customStylesheet;

    if(!stylesheet){
        log("AppIcons Taskbar - Custom stylesheet error!");
        return;
    }

    let [overridePanelHeight, panelHeight] = settings.get_value('main-panel-height').deep_unpack();
    const panelLocation = settings.get_enum('panel-location');

    let customStylesheetCSS = '';
    
    if(overridePanelHeight){
        customStylesheetCSS += `.azTaskbar-panel{
            height: ${panelHeight}px;
        }`;

        if(panelLocation === Enums.PanelLocation.BOTTOM){
            customStylesheetCSS += `.azTaskbar-bottom-panel #overview{
                margin-bottom: ${panelHeight}px;
            }`;
        }
    }
    else{
        customStylesheetCSS += `.azTaskbar-bottom-panel #overview{
            margin-bottom: 24px;
        }`;
    }

    try{
        let bytes = new GLib.Bytes(customStylesheetCSS);

        stylesheet.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (stylesheet, res) => {
            if(!stylesheet.replace_contents_finish(res))
                throw new Error("AppIcons Taskbar - Error replacing contents of custom stylesheet file.");

            let theme = St.ThemeContext.get_for_stage(global.stage).get_theme();

            unloadStylesheet();
            Me.customStylesheet = stylesheet;
            theme.load_stylesheet(Me.customStylesheet);

            return true;
        });
    }
    catch(e){
        log("AppIcons Taskbar - Error updating custom stylesheet. " + e.message);
        return false;
    }
}
