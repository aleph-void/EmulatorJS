(() => {
    "use strict";

    const DS_W = 256;
    const DS_H = 192;
    const MAX_GAP = 126; // melonds_screen_gap upper bound

    const $ = (sel) => document.querySelector(sel);
    const root = document.documentElement;
    const shell = $("#shell");
    const controls = $("#controls");
    const screenTop = $("#screen-top");
    const screenBottom = $("#screen-bottom");

    let layout = null;
    let applied = { mode: null, gap: null };

    const place = (el, r) => {
        if (!r) {
            el.style.display = "none";
            return;
        }
        el.style.display = "";
        el.style.left = r.x + "px";
        el.style.top = r.y + "px";
        el.style.width = r.w + "px";
        el.style.height = r.h + "px";
    };
    const rect = (x, y, w, h) => ({ x, y, w, h });
    const centered = (cx, cy, w, h) => rect(cx - w / 2, cy - h / 2, w, h);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    const safeAreaProbe = document.createElement("div");
    safeAreaProbe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;" +
        "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.appendChild(safeAreaProbe);

    function safeArea() {
        const cs = getComputedStyle(safeAreaProbe);
        return {
            top: parseFloat(cs.paddingTop) || 0,
            right: parseFloat(cs.paddingRight) || 0,
            bottom: parseFloat(cs.paddingBottom) || 0,
            left: parseFloat(cs.paddingLeft) || 0
        };
    }

    // Find the fold from the Viewport Segments API, or assume one in the middle
    function detectFold(W, H) {
        const segs = window.viewport && window.viewport.segments;
        if (segs && segs.length === 2) {
            const [a, b] = segs;
            if (Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1) {
                return { mode: "stacked", start: a.bottom, end: b.top, real: true };
            }
            const [l, r] = a.left < b.left ? [a, b] : [b, a];
            return { mode: "side", start: l.right, end: r.left, real: true };
        }
        if (W > H * 1.25) return { mode: "side", start: W / 2, end: W / 2, real: false };
        return { mode: "stacked", start: H / 2, end: H / 2, real: false };
    }

    // Start/Select/Menu: at least a 44px touch target, with the label fitted to the width
    function smallButton(ctl, width) {
        const dot = clamp(Math.min(ctl * 0.34, width * 0.3), 18, 32);
        const font = clamp(Math.min(dot * 0.48, (width - dot - 4) / 5.5), 8, 14);
        return { h: Math.max(44, dot + 12), dot, font };
    }

    function stackedLayout(W, H, fold, inset) {
        const FW = Math.min(W, H * 0.95);
        const x0 = (W - FW) / 2;
        const pad = clamp(Math.min(FW, H) * 0.03, 8, 22);
        const barH = clamp(H * 0.055, 28, 46);

        const topArea = rect(x0, inset.top, FW, fold.start - inset.top);
        const botArea = rect(x0, fold.end, FW, H - inset.bottom - fold.end);

        const topInner = topArea.h - pad * 2;
        const botInner = botArea.h - barH - pad * 2;
        let s = Math.min(Math.min(topInner, botInner) * 0.88 / DS_H, FW * 0.54 / DS_W);

        const yT = topArea.y + topArea.h / 2;
        const yB = botArea.y + barH + (botArea.h - barH) / 2;
        const D = yB - yT;
        let gap = Math.round(D / s - DS_H);
        if (gap > MAX_GAP) {
            s = Math.min(D / (DS_H + MAX_GAP), FW * 0.6 / DS_W);
            gap = clamp(Math.round(D / s - DS_H), 0, MAX_GAP);
        } else if (gap < 0) {
            s = D / DS_H;
            gap = 0;
        }

        const sw = DS_W * s;
        const sh = DS_H * s;
        const ch = (DS_H * 2 + gap) * s;
        const canvas = centered(W / 2, (yT + yB) / 2, sw, ch);
        const top = rect(canvas.x, canvas.y, sw, sh);
        const bottom = rect(canvas.x, canvas.y + ch - sh, sw, sh);

        const sideW = (FW - sw) / 2;
        const leftCx = x0 + sideW / 2;
        const rightCx = x0 + FW - sideW / 2;
        const ctl = clamp(Math.min(sideW * 0.86, botInner * 0.5), 64, 170);
        const smallInset = clamp(sideW * 0.12, 8, 16);
        const colW = sideW - smallInset * 2;
        const small = smallButton(ctl, colW);
        const dpad = centered(leftCx, bottom.y + bottom.h * 0.42, ctl, ctl);
        const face = centered(rightCx, bottom.y + bottom.h * 0.42, ctl, ctl);
        const maxBottom = botArea.y + botArea.h - pad * 0.5;
        const startY = Math.min(face.y + face.h + 2, maxBottom - small.h * 2);
        const bezelPad = clamp(s * 6, 5, 14);
        const shoulderW = clamp(sideW * 0.75, 50, 130);

        return {
            mode: "stacked",
            gap, s, canvas, top, bottom,
            lid: rect(x0 + 2, topArea.y + 2, FW - 4, topArea.h - 4 + (fold.real ? 0 : 6)),
            base: rect(x0 + 2, botArea.y + (fold.real ? 0 : -6) + 2, FW - 4, botArea.h - 4 + (fold.real ? 0 : 6)),
            hinge: fold.real && fold.end > fold.start
                ? rect(x0, fold.start, FW, fold.end - fold.start)
                : rect(x0 + FW * 0.04, fold.start - 4, FW * 0.92, 8),
            bezelTop: grow(top, bezelPad),
            bezelBottom: grow(bottom, bezelPad),
            speakerL: sideW > 40 ? centered(leftCx, yT, Math.min(sideW * 0.32, 30), Math.min(sideW * 0.21, 20)) : null,
            speakerR: sideW > 40 ? centered(rightCx, yT, Math.min(sideW * 0.32, 30), Math.min(sideW * 0.21, 20)) : null,
            led: centered(rightCx, botArea.y + barH / 2, 6, 6),
            l: centered(x0 + pad + shoulderW / 2, botArea.y + barH / 2 + 2, shoulderW, barH * 0.72),
            r: centered(x0 + FW - pad - shoulderW / 2, botArea.y + barH / 2 + 2, shoulderW, barH * 0.72),
            dpad,
            face,
            small,
            start: rect(x0 + FW - sideW + smallInset, startY, colW, small.h),
            select: rect(x0 + FW - sideW + smallInset, startY + small.h, colW, small.h),
            menu: rect(x0 + smallInset, startY, colW, small.h),
            menuSide: "right"
        };
    }

    function sideLayout(W, H, fold, inset) {
        const pad = clamp(Math.min(W, H) * 0.03, 8, 22);
        const barH = clamp(H * 0.08, 30, 46);
        const leftW = fold.start - inset.left;
        const rightW = W - inset.right - fold.end;
        const usableH = H - inset.top - inset.bottom;

        const s = Math.min((usableH - barH) * 0.56 / DS_H, Math.min(leftW, rightW) * 0.94 / DS_W);
        const sw = DS_W * s;
        const sh = DS_H * s;
        const hingeCx = (fold.start + fold.end) / 2;
        const canvas = rect(hingeCx - sw, inset.top + barH + pad * 0.5, sw * 2, sh);
        const top = rect(canvas.x, canvas.y, sw, sh);
        const bottom = rect(canvas.x + sw, canvas.y, sw, sh);

        const lowerY = canvas.y + sh + pad;
        const lowerH = H - inset.bottom - pad - lowerY;
        const ctl = clamp(Math.min(lowerH * 0.92, Math.min(leftW, rightW) * 0.42), 64, 170);
        const cy = lowerY + lowerH / 2;
        const leftCx = inset.left + leftW * 0.36;
        const rightCx = W - inset.right - rightW * 0.36;
        const smallW = ctl * 0.9;
        const small = smallButton(ctl, smallW);
        const smallLX = leftCx + ctl * 0.6;
        const smallRX = rightCx - ctl * 0.6 - smallW;
        const bezelPad = clamp(s * 6, 5, 14);
        const shoulderW = clamp(Math.min(leftW, rightW) * 0.32, 50, 140);

        return {
            mode: "side",
            gap: 0, s, canvas, top, bottom,
            lid: rect(inset.left + 2, 2, leftW - 4 + (fold.real ? 0 : 6), H - 4),
            base: rect(fold.end + (fold.real ? 0 : -6) + 2, 2, rightW - 4 + (fold.real ? 0 : 6), H - 4),
            hinge: fold.real && fold.end > fold.start
                ? rect(fold.start, 0, fold.end - fold.start, H)
                : rect(fold.start - 4, H * 0.04, 8, H * 0.92),
            bezelTop: grow(top, bezelPad),
            bezelBottom: grow(bottom, bezelPad),
            speakerL: null,
            speakerR: null,
            led: centered(W - inset.right - pad - shoulderW - 14, inset.top + barH / 2 + 2, 6, 6),
            l: centered(inset.left + pad + shoulderW / 2, inset.top + barH / 2 + 2, shoulderW, barH * 0.65),
            r: centered(W - inset.right - pad - shoulderW / 2, inset.top + barH / 2 + 2, shoulderW, barH * 0.65),
            dpad: centered(leftCx, cy, ctl, ctl),
            face: centered(rightCx, cy, ctl, ctl),
            small,
            start: rect(smallRX, cy - small.h - 4, smallW, small.h),
            select: rect(smallLX, cy - small.h - 4, smallW, small.h),
            menu: rect(smallLX, cy + 4, smallW, small.h),
            menuSide: "right"
        };
    }

    function grow(r, by) {
        return rect(r.x - by, r.y - by, r.w + by * 2, r.h + by * 2);
    }

    function computeLayout() {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const inset = safeArea();
        const fold = detectFold(W, H);
        return fold.mode === "stacked"
            ? stackedLayout(W, H, fold, inset)
            : sideLayout(W, H, fold, inset);
    }

    function render() {
        layout = computeLayout();
        const L = layout;
        document.body.dataset.mode = L.mode;

        place(shell.querySelector(".lid"), L.lid);
        place(shell.querySelector(".base"), L.base);
        place(shell.querySelector(".hinge"), L.hinge);
        place(shell.querySelector(".bezel-top"), L.bezelTop);
        place(shell.querySelector(".bezel-bottom"), L.bezelBottom);
        place(shell.querySelector(".speaker-l"), L.speakerL);
        place(shell.querySelector(".speaker-r"), L.speakerR);
        place(shell.querySelector(".led"), L.led);
        place(screenTop, L.top);
        place(screenBottom, L.bottom);

        const shoulders = controls.querySelectorAll(".shoulder");
        place(shoulders[0], L.l);
        place(shoulders[1], L.r);
        shoulders.forEach((el) => el.style.fontSize = (L.l.h * 0.55) + "px");
        place(controls.querySelector(".dpad"), L.dpad);
        const face = controls.querySelector(".face");
        place(face, L.face);
        face.style.fontSize = (L.face.w * 0.14) + "px";
        place(controls.querySelector('[data-input="3"]'), L.start);
        place(controls.querySelector('[data-input="2"]'), L.select);
        place(controls.querySelector('[data-action="menu"]'), L.menu);
        controls.querySelectorAll(".small").forEach((el) => el.style.fontSize = L.small.font + "px");
        controls.style.setProperty("--dot", L.small.dot + "px");

        const c = L.canvas;
        root.style.setProperty("--cv-x", c.x + "px");
        root.style.setProperty("--cv-y", c.y + "px");
        root.style.setProperty("--cv-w", c.w + "px");
        root.style.setProperty("--cv-h", c.h + "px");
        root.style.setProperty("--sw", L.top.w + "px");
        root.style.setProperty("--bs-cx", (L.bottom.x + L.bottom.w / 2) + "px");
        root.style.setProperty("--bs-cy", (L.bottom.y + L.bottom.h / 2) + "px");
        root.style.setProperty("--bs-w", L.bottom.w + "px");
        root.style.setProperty("--ts-x", L.top.x + "px");
        root.style.setProperty("--ts-y", L.top.y + "px");
        if (L.mode === "stacked" && L.gap > 0) {
            // Hide the gap between the screens so the hinge shows through
            const a = (L.top.h / c.h * 100).toFixed(3) + "%";
            const b = ((L.bottom.y - c.y) / c.h * 100).toFixed(3) + "%";
            root.style.setProperty("--cv-clip",
                `polygon(0 0, 100% 0, 100% ${a}, 0 ${a}, 0 ${b}, 100% ${b}, 100% 100%, 0 100%)`);
        } else {
            root.style.setProperty("--cv-clip", "none");
        }

        syncCoreLayout();
    }

    function coreOptions() {
        return {
            "melonds_screen_layout": layout.mode === "stacked" ? "Top/Bottom" : "Left/Right",
            "melonds_screen_gap": String(layout.gap)
        };
    }

    let syncTimer = null;
    function syncCoreLayout() {
        const emu = window.EJS_emulator;
        if (!emu || !emu.started || !emu.gameManager) return;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
            const opts = coreOptions();
            if (applied.mode !== opts.melonds_screen_layout) {
                emu.menuOptionChanged("melonds_screen_layout", opts.melonds_screen_layout);
                applied.mode = opts.melonds_screen_layout;
            }
            if (applied.gap !== opts.melonds_screen_gap) {
                emu.menuOptionChanged("melonds_screen_gap", opts.melonds_screen_gap);
                applied.gap = opts.melonds_screen_gap;
            }
        }, 120);
    }

    let renderQueued = false;
    function queueRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            render();
        });
    }

    window.addEventListener("resize", queueRender);
    window.addEventListener("orientationchange", queueRender);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", queueRender);
    if (window.viewport && window.viewport.addEventListener) window.viewport.addEventListener("segmentschange", queueRender);
    ["(horizontal-viewport-segments: 2)", "(vertical-viewport-segments: 2)"].forEach((q) => {
        const mq = window.matchMedia(q);
        if (mq.addEventListener) mq.addEventListener("change", queueRender);
    });

    // Input
    function press(id, value) {
        const emu = window.EJS_emulator;
        if (!emu || !emu.started || !emu.gameManager) return;
        emu.gameManager.simulateInput(0, id, value);
    }

    function bindSimple(el, onDown, onUp) {
        const active = new Set();
        el.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            el.setPointerCapture(e.pointerId);
            if (active.size === 0) {
                el.classList.add("down");
                onDown();
            }
            active.add(e.pointerId);
        });
        const release = (e) => {
            if (!active.delete(e.pointerId)) return;
            if (active.size === 0) {
                el.classList.remove("down");
                if (onUp) onUp();
            }
        };
        el.addEventListener("pointerup", release);
        el.addEventListener("pointercancel", release);
        el.addEventListener("lostpointercapture", release);
    }

    controls.querySelectorAll(".shoulder, .small[data-input]").forEach((el) => {
        const id = parseInt(el.dataset.input, 10);
        bindSimple(el, () => press(id, 1), () => press(id, 0));
    });

    bindSimple(controls.querySelector('[data-action="menu"]'), () => {
        const emu = window.EJS_emulator;
        if (emu && emu.started) emu.frontend.menu.toggle();
    });

    // D-pad: 8-way from the angle of the touch relative to the centre
    const dpad = controls.querySelector(".dpad");
    const DIRS = { up: 4, down: 5, left: 6, right: 7 };
    const dpadPointers = new Map();
    let dpadHeld = new Set();

    function dirsFor(e) {
        const r = dpad.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const out = new Set();
        if (Math.hypot(dx, dy) < r.width * 0.1) return out;
        const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        if (angle >= 292.5 || angle < 67.5) out.add("right");
        if (angle >= 22.5 && angle < 157.5) out.add("down");
        if (angle >= 112.5 && angle < 247.5) out.add("left");
        if (angle >= 202.5 && angle < 337.5) out.add("up");
        return out;
    }

    function updateDpad() {
        const next = new Set();
        dpadPointers.forEach((dirs) => dirs.forEach((d) => next.add(d)));
        for (const d of Object.keys(DIRS)) {
            if (next.has(d) && !dpadHeld.has(d)) press(DIRS[d], 1);
            if (!next.has(d) && dpadHeld.has(d)) press(DIRS[d], 0);
        }
        dpadHeld = next;
        dpad.dataset.dir = [...next].join(" ");
    }

    dpad.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        dpad.setPointerCapture(e.pointerId);
        dpadPointers.set(e.pointerId, dirsFor(e));
        updateDpad();
    });
    dpad.addEventListener("pointermove", (e) => {
        if (!dpadPointers.has(e.pointerId)) return;
        dpadPointers.set(e.pointerId, dirsFor(e));
        updateDpad();
    });
    const dpadRelease = (e) => {
        if (!dpadPointers.delete(e.pointerId)) return;
        updateDpad();
    };
    dpad.addEventListener("pointerup", dpadRelease);
    dpad.addEventListener("pointercancel", dpadRelease);
    dpad.addEventListener("lostpointercapture", dpadRelease);

    // Face buttons: one touch zone so a thumb can roll between buttons or press two at once
    const face = controls.querySelector(".face");
    const faceBtns = [...face.querySelectorAll(".face-btn")];
    const facePointers = new Map();
    let faceHeld = new Set();

    function faceFor(e) {
        const hits = faceBtns.map((b) => {
            const r = b.getBoundingClientRect();
            return { b, d: Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)), r: r.width / 2 };
        }).sort((p, q) => p.d - q.d);
        const out = new Set();
        if (hits[0].d < hits[0].r * 1.5) out.add(hits[0].b);
        if (hits[1].d < hits[1].r * 1.15 && hits[1].d < hits[0].d * 1.3) out.add(hits[1].b);
        return out;
    }

    function updateFace() {
        const next = new Set();
        facePointers.forEach((btns) => btns.forEach((b) => next.add(b)));
        for (const b of faceBtns) {
            const id = parseInt(b.dataset.input, 10);
            if (next.has(b) && !faceHeld.has(b)) { b.classList.add("down"); press(id, 1); }
            if (!next.has(b) && faceHeld.has(b)) { b.classList.remove("down"); press(id, 0); }
        }
        faceHeld = next;
    }

    face.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        face.setPointerCapture(e.pointerId);
        facePointers.set(e.pointerId, faceFor(e));
        updateFace();
    });
    face.addEventListener("pointermove", (e) => {
        if (!facePointers.has(e.pointerId)) return;
        facePointers.set(e.pointerId, faceFor(e));
        updateFace();
    });
    const faceRelease = (e) => {
        if (!facePointers.delete(e.pointerId)) return;
        updateFace();
    };
    face.addEventListener("pointerup", faceRelease);
    face.addEventListener("pointercancel", faceRelease);
    face.addEventListener("lostpointercapture", faceRelease);

    // Keep EmulatorJS from treating button presses as taps on the game area
    ["click", "mousedown", "mousemove", "touchstart"].forEach((type) => {
        controls.addEventListener(type, (e) => e.stopPropagation());
    });

    document.addEventListener("contextmenu", (e) => {
        if (controls.contains(e.target)) e.preventDefault();
    });

    // Themes
    const THEME_KEY = "duo-ds-theme";
    function setTheme(name) {
        document.body.dataset.theme = name;
        document.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-checked", String(s.dataset.theme === name)));
        const page = getComputedStyle(document.body).getPropertyValue("--page").trim();
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta && page) meta.content = page;
        try { localStorage.setItem(THEME_KEY, name); } catch (e) {}
    }
    document.querySelectorAll(".swatch").forEach((s) => s.addEventListener("click", () => setTheme(s.dataset.theme)));
    let savedTheme = null;
    try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
    setTheme(savedTheme && document.querySelector(`.swatch[data-theme="${savedTheme}"]`) ? savedTheme : "red");

    // Boot EmulatorJS
    const params = new URLSearchParams(location.search);

    // Threads need cross-origin isolation, which the service worker provides
    const useThreads = window.crossOriginIsolated === true && typeof SharedArrayBuffer === "function" && params.get("threads") !== "0";
    let starting = false;

    function start(gameUrl, name) {
        starting = true;
        render();
        const game = document.createElement("div");
        game.id = "game";
        const host = document.createElement("div");
        host.id = "ejs";
        game.appendChild(host);
        document.body.appendChild(game);

        const opts = coreOptions();
        applied = { mode: opts.melonds_screen_layout, gap: opts.melonds_screen_gap };

        window.EJS_player = "#ejs";
        window.EJS_core = "nds";
        window.EJS_gameUrl = gameUrl;
        window.EJS_gameName = name.replace(/\.[^.]+$/, "");
        window.EJS_pathtodata = "data/";
        window.EJS_startOnLoaded = true;
        window.EJS_backgroundColor = "transparent";
        window.EJS_color = getComputedStyle(document.body).getPropertyValue("--accent").trim();
        window.EJS_DEBUG_XX = params.get("debug") === "1";
        window.EJS_askBeforeExit = false;
        window.EJS_threads = useThreads;
        window.EJS_defaultOptions = Object.assign({
            "melonds_touch_mode": "Touch",
            "melonds_threaded_renderer": useThreads ? "enabled" : "disabled",
            "virtual-gamepad": "disabled",
            "menu-bar-button": "hidden"
        }, opts);
        window.EJS_ready = () => {
            window.EJS_emulator.frontend.elements.parent.appendChild(controls);
        };
        window.EJS_onGameStart = () => {
            document.body.classList.add("playing");
            // Saved settings can override the defaults, so push the layout once running
            applied = { mode: null, gap: null };
            const emu = window.EJS_emulator;
            emu.menuOptionChanged("melonds_touch_mode", "Touch");
            if (emu.frontend.toggleVirtualGamepad) emu.frontend.toggleVirtualGamepad(false);
            syncCoreLayout();
        };

        const script = document.createElement("script");
        script.src = "data/loader.js";
        document.body.appendChild(script);
    }

    // No accept filter: iOS greys out extensions it has no file type for, like .nds
    $("#rom-input").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!/\.(nds|zip|7z)$/i.test(file.name)) {
            $(".hint").textContent = "Pick a .nds, .zip or .7z file";
            e.target.value = "";
            return;
        }
        start(file, file.name);
    });

    if (params.get("rom")) start("roms/" + params.get("rom"), params.get("rom"));

    if ("serviceWorker" in navigator) {
        // Reload once when the worker first takes over so the page becomes isolated
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            let reloaded = false;
            try { reloaded = sessionStorage.getItem("duo-ds-isolated") === "1"; } catch (e) {}
            if (window.crossOriginIsolated || starting || reloaded) return;
            try { sessionStorage.setItem("duo-ds-isolated", "1"); } catch (e) {}
            location.reload();
        });
        navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    render();
})();
