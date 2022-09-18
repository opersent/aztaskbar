const { Clutter, GLib, GObject, St } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const { AppMenu } = imports.ui.appMenu;
const Enums = Me.imports.enums;

//Time between animation ticks (ms)
const ANIMATION_INTERVAL = 10;
//How many times the animation will tick (total 150ms animation)
const ANIMATION_TICKS = 15;

const INDICATOR_RADIUS = 1.5;
const DEGREES = Math.PI / 180;

var AppIconIndicator = GObject.registerClass(class azTaskbar_AppIconIndicator extends St.DrawingArea {
    _init(appIcon) {
        super._init({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._settings = appIcon._settings;
        this._appIcon = appIcon;
        this.app = appIcon.app;
        this.connect('destroy', () => this._onDestroy());
        this._animationState = Enums.AnimationState.NONE;
        this._indicatorColor = 'transparent';
        this._desiredIndicatorWidth = 1;
        this._startIndicatorWidth = 0;
    }

    _setAnimationState(oldWindows, windows){
        const dashesEnabled = this._settings.get_enum('multi-window-indicator-style') === Enums.MultiWindowIndicatorStyle.MULTI_DASH;

        if(dashesEnabled && (windows > 1 || windows < oldWindows))
            this._animationState = Enums.AnimationState.ANIMATE_DASHES;
        else
            this._animationState = Enums.AnimationState.ANIMATE_SINGLE;
    }

    _setIndicatorColor(appState){
        if(appState === Enums.AppState.RUNNING)
            this._indicatorColor = this._settings.get_string('indicator-color-running');
        else if(appState === Enums.AppState.FOCUSED)
            this._indicatorColor = this._settings.get_string('indicator-color-focused');
    }

    updateIndicator(oldAppState, appState, oldWindows, windows){
        const needsRepaint = oldAppState !== appState || (oldAppState === appState && oldWindows !== windows);

        if(!needsRepaint)
            return;

        this._setAnimationState(oldWindows, windows);
        this._setIndicatorColor(appState);
        
        this._endAnimation();

        if(this._animationState === Enums.AnimationState.ANIMATE_DASHES)
            this._startDashesAnimation(oldAppState, appState, oldWindows, windows);
        else if(this._animationState === Enums.AnimationState.ANIMATE_SINGLE)
            this._startSingleAnimation(appState);

        this._animateIndicatorsID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ANIMATION_INTERVAL, () => {
            this.queue_repaint();
            return this._animate();
        });
    }

    _startDashesAnimation(oldAppState, appState, oldWindows, windows){
        const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const singleWindowRemains = oldWindows === 2 && windows === 1;
        const singleWindowStart = oldWindows === 1 && windows === 2;

        let dashWidth = this._appIcon.width / 9;

        if(appState === Enums.AppState.FOCUSED && this._settings.get_boolean('show-window-titles'))
            this._indicatorSpacing = 17 * scaleFactor;
        else
            this._indicatorSpacing = 5 * scaleFactor;

        this._toDrawCount = windows - oldWindows;

        if(this._toDrawCount < 0)
            this._indicatorCount = oldWindows + this._toDrawCount;
        else
            this._indicatorCount = oldWindows;

        this._toDrawCount = Math.abs(this._toDrawCount);

        if(appState === Enums.AppState.FOCUSED && singleWindowRemains)
            this._indicatorWidth = this._appIcon.width / 4;
        else if(oldAppState === Enums.AppState.RUNNING && singleWindowStart)
            this._indicatorWidth = dashWidth;
        else if(appState === Enums.AppState.FOCUSED && singleWindowStart){
            this._indicatorWidth = dashWidth;
            dashWidth = this._appIcon.width / 4;
        }
        else
            this._indicatorWidth = dashWidth;

        this._desiredIndicatorWidth = (windows * this._indicatorWidth) + ((windows - 1) * this._indicatorSpacing);
        this._startIndicatorWidth = (oldWindows * dashWidth) + ((oldWindows - 1) * this._indicatorSpacing);
        this._indicatorTickWidth = (this._desiredIndicatorWidth - this._startIndicatorWidth) / ANIMATION_TICKS;
    }

    _startSingleAnimation(appState){ 
        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let radius = INDICATOR_RADIUS * scaleFactor;

        if(appState === Enums.AppState.NOT_RUNNING)
            this._desiredIndicatorWidth = -radius;
        else if(appState === Enums.AppState.RUNNING)
            this._desiredIndicatorWidth = this._appIcon.width / 9;
        else if(appState === Enums.AppState.FOCUSED)
            this._desiredIndicatorWidth = this._appIcon.width / 4;

        this._indicatorTickWidth = (this._desiredIndicatorWidth - this._startIndicatorWidth) / ANIMATION_TICKS;
    }

    _animate(){
        let animateDone = false;
        this._startIndicatorWidth += this._indicatorTickWidth;

        if(this._indicatorTickWidth > 0 && this._startIndicatorWidth >= this._desiredIndicatorWidth)
            animateDone = true;
        else if(this._indicatorTickWidth < 0 && this._startIndicatorWidth <= this._desiredIndicatorWidth)
            animateDone = true;
        else if(this._indicatorTickWidth === 0)
            animateDone = true;

        if(animateDone) {
            this._animateIndicatorsID = null;
            this._startIndicatorWidth = this._desiredIndicatorWidth;
            this.queue_repaint();
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }

    _endAnimation(){
        if(this._animateIndicatorsID){
            this._startIndicatorWidth = this._desiredIndicatorWidth;
            GLib.Source.remove(this._animateIndicatorsID);
            this._animateIndicatorsID = null;
        }
    }

    vfunc_repaint(){
        let width = this._startIndicatorWidth;

        let color = Clutter.color_from_string((this._indicatorColor ?? 'transparent'))[1];

        let [areaWidth, areaHeight] = this.get_surface_size();
        let cr = this.get_context();

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let radius = INDICATOR_RADIUS * scaleFactor;

        if(width <= -radius)
            return;

        let x = 0;
        let y = ((this._settings.get_enum('indicator-location') === Enums.IndicatorLocation.TOP) ? 0 : (areaHeight - (radius * 2)) / 2);

        Clutter.cairo_set_source_color(cr, color);

        if(this._animationState === Enums.AnimationState.ANIMATE_DASHES){
            cr.translate((areaWidth - width) / 2, y);
            //draw the previous visible indicators
            for(let i = 0; i < this._indicatorCount; i++){
                cr.newSubPath();
                x = i * this._indicatorWidth + i * this._indicatorSpacing;
                cr.arc(x, y + radius, radius, 90 * DEGREES, -90 * DEGREES);
                cr.arc(x + this._indicatorWidth, y + radius, radius, -90 * DEGREES, 90 * DEGREES);
                cr.closePath();
            }
            //draw the new indicator
            for(let i = 0; i < this._toDrawCount; i++){
                cr.newSubPath();
                x = width - this._indicatorWidth;
                cr.arc(x, y + radius, radius, 90 * DEGREES, -90 * DEGREES);
                cr.arc(x + this._indicatorWidth, y + radius, radius, -90 * DEGREES, 90 * DEGREES);
                cr.closePath();
            }
        }
        else{
            cr.translate((areaWidth - width) / 2, y);
            cr.newSubPath();
            cr.arc(x, y + radius, radius, 90 * DEGREES, -90 * DEGREES);
            cr.arc(x + width, y + radius, radius, -90 * DEGREES, 90 * DEGREES);
            cr.closePath();
        }

        cr.fill();
        cr.$dispose();
        return false;
    }

    _onDestroy(){
        this._endAnimation();
    }
});
