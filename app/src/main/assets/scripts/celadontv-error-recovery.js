// CeladonTV error recovery: the Reload button on Twitch's "Looks like something went wrong"
// screen opens the home screen instead of reloading the same page.
//
// Starshot's Reload reloads the current URL, which brings the same error straight back when
// the page itself is what fails (the login page did this after every sign-in). Picking Home
// in the top nav always cleared it, so Reload now does the same: it loads Starshot's home
// screen. Every other button, including the top nav shown over the error, works as before.
(function () {
    'use strict';

    // Starshot's full-screen error ("InternalServerError"): its picture, in any language.
    const ERROR_IMAGE = 'img[src*="error-500"]';

    // The error screen a button belongs to: the nearest ancestor holding the error picture
    // and no links (the top nav is links, so its buttons never count). Null for any other
    // button.
    function errorScreenOf(el) {
        if (!el || el.tagName !== 'BUTTON') return null;
        for (let node = el.parentElement; node; node = node.parentElement) {
            if (node.querySelector(ERROR_IMAGE)) return node.querySelector('a[href]') ? null : node;
        }
        return null;
    }

    function install(win, homeUrl) {
        const doc = win.document;
        function recover(event, target) {
            if (!errorScreenOf(target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            win.location.replace(homeUrl);
        }
        // Capture on window runs before Starshot's own handlers (this is registered first).
        win.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.keyCode === 13) recover(event, doc.activeElement);
        }, true);
        win.addEventListener('click', (event) => {
            const button = event.target && event.target.closest ? event.target.closest('button') : null;
            recover(event, button);
        }, true);
    }

    if (typeof window !== 'undefined' && window.top === window && !window.__ctvErrorRecoveryInstalled) {
        window.__ctvErrorRecoveryInstalled = true;
        install(window, window.location.origin + '/');
    }

    if (typeof module !== 'undefined') module.exports = { errorScreenOf, install, ERROR_IMAGE };
})();
