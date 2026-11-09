//! Keep the pet visible across macOS Spaces (Mission Control desktops).
//!
//! Important:
//! - Use `CanJoinAllSpaces` + `Stationary` + `FullScreenAuxiliary`
//! - Do **not** poll `isOnActiveSpace` for join-all windows (it often
//!   returns false even when the window is correctly visible everywhere,
//!   and thrashing `MoveToActiveSpace` breaks Space affinity)
//! - On Space change: re-apply flags + `orderFrontRegardless`

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// NSWindowCollectionBehavior
const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const STATIONARY: usize = 1 << 4;
const IGNORES_CYCLE: usize = 1 << 6;
const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

/// NSStatusWindowLevel
const STATUS_WINDOW_LEVEL: isize = 25;

static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);
static APP_FOR_SPACES: OnceLock<AppHandle> = OnceLock::new();

fn collection_behavior() -> usize {
    // Stationary = stay on-screen when switching Spaces (widget-style)
    // CanJoinAllSpaces = associated with every Space
    CAN_JOIN_ALL_SPACES | STATIONARY | FULL_SCREEN_AUXILIARY | IGNORES_CYCLE
}

pub fn pin_to_all_spaces<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.set_visible_on_all_workspaces(true);
    let _ = window.set_always_on_top(true);

    if let Ok(ptr) = window.ns_window() {
        if !ptr.is_null() {
            unsafe {
                apply_ns(ptr);
            }
        }
    }
}

pub fn pin_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        pin_to_all_spaces(&window);
    }
}

/// Called when macOS reports an active Space change.
pub fn on_space_changed<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        // Re-assert flags first (AppKit sometimes clears them)
        pin_to_all_spaces(&window);
        if let Ok(ptr) = window.ns_window() {
            if !ptr.is_null() {
                unsafe {
                    order_front(ptr);
                }
            }
        }
        let _ = window.show();
    }
}

/// Start Space-change observer + a gentle re-pin (no MoveToActiveSpace thrash).
pub fn start_space_watcher(app: AppHandle) {
    if WATCHER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let _ = APP_FOR_SPACES.set(app.clone());

    // Immediate pin + delayed re-pins while webview settles
    pin_main(&app);
    let warm = app.clone();
    std::thread::spawn(move || {
        for ms in [80u64, 250, 600, 1500, 3000] {
            std::thread::sleep(std::time::Duration::from_millis(ms));
            let h = warm.clone();
            let h2 = warm.clone();
            let _ = h.run_on_main_thread(move || pin_main(&h2));
        }
    });

    // Official AppKit notification when user switches Spaces
    unsafe {
        register_space_change_observer();
        register_system_wake_observer();
        register_show_care_observer();
    }
}

/// Mac woke from sleep / lid open → frontend shows weather moment.
/// Debounced: DidWake + ScreensDidWake often fire together.
fn emit_system_wake() {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::Emitter;

    static LAST_WAKE_MS: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let prev = LAST_WAKE_MS.load(Ordering::Relaxed);
    // Collapse multi-notifications within 2.5s into one weather moment
    if now.saturating_sub(prev) < 2500 {
        return;
    }
    LAST_WAKE_MS.store(now, Ordering::Relaxed);

    if let Some(app) = APP_FOR_SPACES.get() {
        // Ensure pet is visible after lid open — do NOT float-to-center or
        // emit pet-tray "resume" here. That animates size/position and fights
        // the weather care strip expand → jitter + afterimage on unveil.
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.set_visible_on_all_workspaces(true);
            let _ = win.set_always_on_top(true);
        }
        let _ = app.emit("system-wake", ());
        eprintln!("[BAA] system-wake emitted (lid/sleep/display)");
    }
}

/// `osascript` / other tools can post `com.paytonhui.baa.show-care`.
unsafe fn register_show_care_observer() {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use tauri::Emitter;

    let Some(name_cls) = AnyClass::get(c"NSString") else {
        return;
    };
    let Some(dist_cls) = AnyClass::get(c"NSDistributedNotificationCenter") else {
        return;
    };
    let c_name = c"com.paytonhui.baa.show-care";
    let ns_name: *mut AnyObject =
        msg_send![name_cls, stringWithUTF8String: c_name.as_ptr()];
    let center: *mut AnyObject = msg_send![dist_cls, defaultCenter];
    let null_obj: *mut AnyObject = std::ptr::null_mut();

    let block = RcBlock::new(move |_notification: *mut AnyObject| {
        if let Some(app) = APP_FOR_SPACES.get() {
            let app2 = app.clone();
            let _ = app2.run_on_main_thread(move || {
                if let Some(app) = APP_FOR_SPACES.get() {
                    let _ = app.emit("show-care-bubble", ());
                }
            });
        }
    });
    let block = Box::leak(Box::new(block));
    let observer: *mut AnyObject = msg_send![
        center,
        addObserverForName: ns_name,
        object: null_obj,
        queue: null_obj,
        usingBlock: &**block
    ];
    std::mem::forget(observer);
}

/// NSWorkspace wake + screen wake for MacBook lid open / sleep end.
unsafe fn register_system_wake_observer() {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    let name_cls = AnyClass::get(c"NSString").expect("NSString");
    let null_obj: *mut AnyObject = std::ptr::null_mut();

    // Workspace notification center (DidWake / ScreensDidWake / session)
    let ws_cls = AnyClass::get(c"NSWorkspace").expect("NSWorkspace");
    let shared: *mut AnyObject = msg_send![ws_cls, sharedWorkspace];
    let ws_center: *mut AnyObject = msg_send![shared, notificationCenter];

    // Cover common MacBook unveil paths:
    // - DidWake: machine left sleep
    // - ScreensDidWake: displays on (lid open with display sleep)
    // - SessionDidBecomeActive: user session active after lock/switch
    let wake_names = [
        c"NSWorkspaceDidWakeNotification",
        c"NSWorkspaceScreensDidWakeNotification",
        c"NSWorkspaceSessionDidBecomeActiveNotification",
    ];

    for c_name in wake_names {
        let ns_name: *mut AnyObject =
            msg_send![name_cls, stringWithUTF8String: c_name.as_ptr()];

        let block = RcBlock::new(move |_notification: *mut AnyObject| {
            if let Some(app) = APP_FOR_SPACES.get() {
                let app2 = app.clone();
                let _ = app2.run_on_main_thread(move || {
                    emit_system_wake();
                });
            }
        });
        let block = Box::leak(Box::new(block));

        let observer: *mut AnyObject = msg_send![
            ws_center,
            addObserverForName: ns_name,
            object: null_obj,
            queue: null_obj,
            usingBlock: &**block
        ];
        std::mem::forget(observer);
    }

    eprintln!("[BAA] System-wake observers registered (wake/screens/session)");
}

unsafe fn register_space_change_observer() {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    // NSString from UTF-8
    let name_cls = AnyClass::get(c"NSString").expect("NSString");
    let c_name = c"NSWorkspaceActiveSpaceDidChangeNotification";
    let ns_name: *mut AnyObject = msg_send![name_cls, stringWithUTF8String: c_name.as_ptr()];

    let center_cls = AnyClass::get(c"NSNotificationCenter").expect("NSNotificationCenter");
    let center: *mut AnyObject = msg_send![center_cls, defaultCenter];

    // Block runs on posting thread; hop to Tauri main thread
    let block = RcBlock::new(move |_notification: *mut AnyObject| {
        if let Some(app) = APP_FOR_SPACES.get() {
            let app2 = app.clone();
            let app3 = app.clone();
            let _ = app2.run_on_main_thread(move || {
                on_space_changed(&app3);
            });
        }
    });

    // Keep block alive for process lifetime
    let block = Box::leak(Box::new(block));

    let null_obj: *mut AnyObject = std::ptr::null_mut();
    let observer: *mut AnyObject = msg_send![
        center,
        addObserverForName: ns_name,
        object: null_obj,
        queue: null_obj,
        usingBlock: &**block
    ];

    // Keep observer token alive for process lifetime
    let _observer_token = observer;
    std::mem::forget(_observer_token);

    eprintln!("[BAA] Space-change observer registered");
}

unsafe fn apply_ns(ns_window: *mut std::ffi::c_void) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let obj = ns_window as *mut AnyObject;
    if obj.is_null() {
        return;
    }

    let behavior = collection_behavior();
    let _: () = msg_send![obj, setCollectionBehavior: behavior];
    let _: () = msg_send![obj, setLevel: STATUS_WINDOW_LEVEL];
    let _: () = msg_send![obj, setHidesOnDeactivate: false];
    // CanJoinAllSpaces windows should not hide when app is inactive
    let _: () = msg_send![obj, setCanHide: false];
    // Once, on TaoWindow: let the pet's empty top padding cross the menu bar.
    install_pet_top_reach(obj);
}

/// `windowLayout.ts`: pet window 220×324, head hit 100×87, centered.
/// `HEAD_SCREEN_SCALE` is 1/2. Do not change these to match a new scale.
const PET_WINDOW_H: f64 = 324.0;
const PET_HIT_H: f64 = 87.0;

/// Cocoa points of transparent window above the centered head.
fn head_top_pad(window_h: f64) -> f64 {
    window_h * (PET_WINDOW_H - PET_HIT_H) / (2.0 * PET_WINDOW_H)
}

/// Highest Cocoa origin.y that still keeps the head on the physical screen.
/// `screen_top` is `screen.frame` max Y. Higher origin.y is higher on screen.
fn relaxed_origin_y(proposed_y: f64, clamped_y: f64, height: f64, screen_top: f64) -> f64 {
    let max_origin_y = screen_top + head_top_pad(height) - height;
    let mut y = proposed_y;
    if y > max_origin_y {
        y = max_origin_y;
    }
    // Dock and the bottom edge stay on AppKit's clamp.
    if y < clamped_y {
        y = clamped_y;
    }
    y
}

#[repr(C)]
#[derive(Clone, Copy)]
struct NsPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct NsSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct NsRect {
    origin: NsPoint,
    size: NsSize,
}

unsafe impl objc2::encode::Encode for NsPoint {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGPoint",
        &[f64::ENCODING, f64::ENCODING],
    );
}

unsafe impl objc2::encode::Encode for NsSize {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGSize",
        &[f64::ENCODING, f64::ENCODING],
    );
}

unsafe impl objc2::encode::Encode for NsRect {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGRect",
        &[NsPoint::ENCODING, NsSize::ENCODING],
    );
}

type ConstrainImp = unsafe extern "C-unwind" fn(
    *mut objc2::runtime::AnyObject,
    objc2::runtime::Sel,
    NsRect,
    *mut objc2::runtime::AnyObject,
) -> NsRect;

static ORIGINAL_CONSTRAIN: OnceLock<ConstrainImp> = OnceLock::new();
static TOP_REACH_INSTALLED: AtomicBool = AtomicBool::new(false);

unsafe extern "C-unwind" fn constrain_baa_frame(
    this: *mut objc2::runtime::AnyObject,
    sel: objc2::runtime::Sel,
    proposed: NsRect,
    screen: *mut objc2::runtime::AnyObject,
) -> NsRect {
    let Some(original) = ORIGINAL_CONSTRAIN.get() else {
        return proposed;
    };
    let clamped = original(this, sel, proposed, screen);
    if this.is_null() || !title_is_exact_baa(this) {
        return clamped;
    }

    let mut screen = screen;
    if screen.is_null() {
        screen = objc2::msg_send![this, screen];
    }
    if screen.is_null() {
        return clamped;
    }
    let full: NsRect = objc2::msg_send![screen, frame];
    let mut out = proposed;
    // Sides stay inside the screen. The top may rise by the head's padding.
    out.origin.x = clamped.origin.x;
    out.origin.y = relaxed_origin_y(
        proposed.origin.y,
        clamped.origin.y,
        proposed.size.height,
        full.origin.y + full.size.height,
    );
    out
}

unsafe fn title_is_exact_baa(win: *mut objc2::runtime::AnyObject) -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let title: *mut AnyObject = msg_send![win, title];
    if title.is_null() {
        return false;
    }
    let bytes: *const std::ffi::c_char = msg_send![title, UTF8String];
    if bytes.is_null() {
        return false;
    }
    std::ffi::CStr::from_ptr(bytes).to_bytes() == b"BAA"
}

/// TaoWindow is shared by every BAA window. Add `constrainFrameRect:toScreen:`
/// on that class once, and let the hook keep panels on-screen by title.
unsafe fn install_pet_top_reach(win: *mut objc2::runtime::AnyObject) {
    use objc2::runtime::{AnyClass, Imp};
    use objc2::sel;

    if TOP_REACH_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    let cls = (*win).class();
    let sel = sel!(constrainFrameRect:toScreen:);
    let Some(method) = cls.instance_method(sel) else {
        TOP_REACH_INSTALLED.store(false, Ordering::SeqCst);
        eprintln!("[BAA] top-reach: constrainFrameRect missing");
        return;
    };
    let types = objc2::ffi::method_getTypeEncoding(method);
    if types.is_null() {
        TOP_REACH_INSTALLED.store(false, Ordering::SeqCst);
        eprintln!("[BAA] top-reach: method encoding missing");
        return;
    }

    let orig: ConstrainImp = std::mem::transmute(method.implementation());
    let _ = ORIGINAL_CONSTRAIN.set(orig);
    let new_imp: Imp = std::mem::transmute(constrain_baa_frame as ConstrainImp);
    let cls_ptr = cls as *const AnyClass as *mut AnyClass;
    let added = objc2::ffi::class_addMethod(cls_ptr, sel, new_imp, types);
    if !added.as_bool() {
        // Selector already lives on this class. Replace that method only.
        let _prev = method.set_implementation(new_imp);
    }
    eprintln!("[BAA] pet head can reach the top of the screen");
}

#[cfg(test)]
mod top_reach_tests {
    use super::{head_top_pad, relaxed_origin_y};

    #[test]
    fn scale_one_pad_is_half_the_gap_above_the_head() {
        let pad = head_top_pad(324.0);
        assert!((pad - 118.5).abs() < 0.001);
    }

    #[test]
    fn head_may_touch_the_physical_top_and_still_stops_at_the_dock() {
        // 982-pt screen, menu bar leaves visible top at 944. Window is 324.
        // AppKit origin.y max under the menu bar: 944 - 324 = 620.
        let screen_top = 982.0;
        let height = 324.0;
        let dock_floor = 40.0;
        let menu_ceiling = 620.0;

        let at_top = relaxed_origin_y(900.0, menu_ceiling, height, screen_top);
        let pad = head_top_pad(height);
        assert!((at_top - (screen_top + pad - height)).abs() < 0.001);

        let mid = relaxed_origin_y(400.0, dock_floor, height, screen_top);
        assert!((mid - 400.0).abs() < 0.001);

        let into_dock = relaxed_origin_y(10.0, dock_floor, height, screen_top);
        assert!((into_dock - dock_floor).abs() < 0.001);
    }

    #[test]
    fn zoom_keeps_the_same_padding_fraction() {
        let h = 324.0 * 1.4;
        let pad = head_top_pad(h);
        assert!((pad / h - 118.5 / 324.0).abs() < 0.0001);
    }
}

unsafe fn order_front(ns_window: *mut std::ffi::c_void) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let obj = ns_window as *mut AnyObject;
    if obj.is_null() {
        return;
    }
    let _: () = msg_send![obj, orderFrontRegardless];
}

/// Show a window on top without making this app key — typing in other apps continues.
pub fn show_without_activating<R: Runtime>(window: &WebviewWindow<R>) {
    pin_to_all_spaces(window);
    if let Ok(ptr) = window.ns_window() {
        if !ptr.is_null() {
            unsafe {
                order_front(ptr);
                resign_key_if_needed(ptr);
            }
        }
    }
}

unsafe fn resign_key_if_needed(ns_window: *mut std::ffi::c_void) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let obj = ns_window as *mut AnyObject;
    if obj.is_null() {
        return;
    }
    let is_key: bool = msg_send![obj, isKeyWindow];
    if is_key {
        let _: () = msg_send![obj, resignKeyWindow];
    }
}
