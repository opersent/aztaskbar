const { Clutter } = imports.gi;

function getInterestingWindows(settings, windows, monitorIndex) {
    if(settings.get_boolean('isolate-workspaces')){
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        windows = windows.filter(function(w) {
            const inWorkspace = w.get_workspace() === activeWorkspace;
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

/**
 * Adapted from GNOME Shell. Modified to work with a horizontal scrollView
 */
 function ensureActorVisibleInScrollView(scrollView, actor) {
    let adjustment = scrollView.hscroll.adjustment;
    let [value, lower_, upper, stepIncrement_, pageIncrement_, pageSize] = adjustment.get_values();

    let offset = 0;
    let hfade = scrollView.get_effect("fade");
    if (hfade)
        offset = hfade.fade_margins.left;

    let box = actor.get_allocation_box();
    let x1 = box.x1, x2 = box.x2;

    let parent = actor.get_parent();
    while (parent != scrollView) {
        if (!parent)
            throw new Error("actor not in scroll view");

        box = parent.get_allocation_box();
        x1 += box.x1;
        x2 += box.x1;
        parent = parent.get_parent();
    }

    if (x1 < value + offset)
        value = Math.max(0, x1 - offset);
    else if (x2 > value + pageSize - offset)
        value = Math.min(upper, x2 + offset - pageSize);
    else
        return;

    adjustment.ease(value, {
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        duration: 100,
    });
}
