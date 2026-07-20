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
