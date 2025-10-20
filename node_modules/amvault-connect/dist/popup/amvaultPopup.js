let sharedPopup = null;
let overlayEl = null;
let isClosing = false;
function ensureOverlay() {
    if (overlayEl)
        return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'amvault-overlay';
    Object.assign(overlayEl.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(0,0,0,0.35)',
        zIndex: '9999',
        pointerEvents: 'none'
    });
    document.body.appendChild(overlayEl);
}
export function preOpenAmvaultPopup(name = 'amvault', w = 420, h = 640) {
    var _a, _b, _c, _d, _e, _f, _g;
    const oh = (_c = (_b = (_a = window.top) === null || _a === void 0 ? void 0 : _a.outerHeight) !== null && _b !== void 0 ? _b : window.outerHeight) !== null && _c !== void 0 ? _c : 0;
    const ow = (_f = (_e = (_d = window.top) === null || _d === void 0 ? void 0 : _d.outerWidth) !== null && _e !== void 0 ? _e : window.outerWidth) !== null && _f !== void 0 ? _f : 0;
    const y = Math.max((oh - h) / 2, 0);
    const x = Math.max((ow - w) / 2, 0);
    if (sharedPopup && !sharedPopup.closed)
        return sharedPopup;
    sharedPopup = (_g = window.open('about:blank', name, `toolbar=0,location=0,status=0,menubar=0,scrollbars=1,resizable=1,width=${w},height=${h},top=${y},left=${x}`)) !== null && _g !== void 0 ? _g : null;
    ensureOverlay();
    window.addEventListener('beforeunload', () => {
        try {
            sharedPopup === null || sharedPopup === void 0 ? void 0 : sharedPopup.close();
        }
        catch { }
        sharedPopup = null;
        if ((overlayEl === null || overlayEl === void 0 ? void 0 : overlayEl.parentNode) && overlayEl.parentNode.contains(overlayEl)) {
            try {
                overlayEl.parentNode.removeChild(overlayEl);
            }
            catch { }
        }
        overlayEl = null;
        isClosing = false;
    }, { once: true });
    return sharedPopup;
}
export function getSharedPopup() {
    return sharedPopup && !sharedPopup.closed ? sharedPopup : null;
}
export async function closeSharedPopup() {
    if (isClosing)
        return;
    isClosing = true;
    try {
        if (sharedPopup && !sharedPopup.closed)
            sharedPopup.close();
    }
    catch { }
    sharedPopup = null;
    if (overlayEl) {
        const parent = overlayEl.parentNode;
        if (parent && parent.contains(overlayEl)) {
            try {
                parent.removeChild(overlayEl);
            }
            catch { }
        }
    }
    overlayEl = null;
    await Promise.resolve();
    isClosing = false;
}
export async function closePopupThen(cb) {
    await closeSharedPopup();
    setTimeout(cb, 0);
}
