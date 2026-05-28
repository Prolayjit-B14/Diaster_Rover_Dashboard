/**
 * RescueBOT Shared UI Logic v3.1
 * Theme toggle, sidebar, clock, nav transitions — all pages.
 *
 * Fixes applied:
 *  - Theme icon initial state corrected (dark → show moon, light → show sun)
 *  - Added RESCUEBOT_UI.setText() utility to avoid per-page duplication
 *  - Page transition opacity guarded to avoid flash
 */

/* ── THEME INIT (run immediately, before DOMContentLoaded)
       Prevents flash-of-unstyled-content on page load      ── */
;(function applyThemeEarly() {
    const saved = localStorage.getItem('rescuebot-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
})();

/* ── HELPERS ─────────────────────────────────────────────────── */

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rescuebot-theme', theme);
    updateThemeIcons(theme);
}

function toggleTheme() {
    const current = getCurrentTheme();
    setTheme(current === 'dark' ? 'light' : 'dark');
}

function updateThemeIcons(theme) {
    // In dark mode → show sun icon (to switch to light)
    // In light mode → show moon icon (to switch to dark)
    const iconName = theme === 'dark' ? 'sun' : 'moon';

    document.querySelectorAll('[id="theme-toggle"], .theme-toggle-btn').forEach(btn => {
        const icon = btn.querySelector('i[data-lucide], svg');
        if (icon && icon.tagName === 'I') {
            icon.setAttribute('data-lucide', iconName);
            if (window.lucide) window.lucide.createIcons({ nodes: [icon] });
        }
        const label = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    });
}

/* ── MAIN DOM READY ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

    /* ── Apply saved theme icon state ─────────────────────────── */
    updateThemeIcons(getCurrentTheme());

    /* ── MOBILE MENU + BACKDROP ──────────────────────────────── */
    const sidebarEl = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const backdrop  = document.getElementById('sidebar-backdrop');

    if (sidebarEl && mobileBtn && backdrop) {
        mobileBtn.addEventListener('click', () => {
            sidebarEl.classList.add('mobile-open');
            backdrop.classList.add('visible');
        });
        backdrop.addEventListener('click', () => {
            sidebarEl.classList.remove('mobile-open');
            backdrop.classList.remove('visible');
        });
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                sidebarEl.classList.remove('mobile-open');
                backdrop.classList.remove('visible');
            });
        });
    }

    /* ── THEME TOGGLE BUTTON ─────────────────────────────────── */
    document.querySelectorAll('#theme-toggle, .theme-toggle-btn').forEach(btn => {
        btn.addEventListener('click', toggleTheme);
    });

    /* ── SIDEBAR COLLAPSE (not used in icon-only mode) ─────────── */
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    if (sidebarEl && collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            sidebarEl.classList.toggle('collapsed');
            setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 50);
        });
    }

    /* ── ACTIVE NAV ITEM ─────────────────────────────────────── */
    const currentPath = window.location.pathname.toLowerCase();
    document.querySelectorAll('.nav-item').forEach(item => {
        const href = (item.getAttribute('href') || '').toLowerCase();
        const page = href.split('/').filter(Boolean).pop() || 'index';
        if (
            currentPath.includes(page) ||
            (page === 'index' && currentPath.endsWith('/')) ||
            (page === '' && (currentPath.endsWith('/') || currentPath.endsWith('index.html')))
        ) {
            item.classList.add('active');
        }
    });

    /* ── MISSION CLOCK ───────────────────────────────────────── */
    const clockEl = document.getElementById('mission-clock');
    if (clockEl) {
        const tick = () => {
            clockEl.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
        };
        setInterval(tick, 1000);
        tick();
    }

    /* ── MISSION TIMER ───────────────────────────────────────── */
    const timerEl = document.getElementById('mission-timer');
    if (timerEl) {
        let secs = 0;
        setInterval(() => {
            secs++;
            const h = String(Math.floor(secs / 3600)).padStart(2, '0');
            const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
            const s = String(secs % 60).padStart(2, '0');
            timerEl.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    /* ── PAGE TRANSITION (fade-in on load) ───────────────────── */
    const shell = document.querySelector('.app-shell, body');
    if (shell) {
        shell.style.opacity = '0';
        requestAnimationFrame(() => {
            shell.style.transition = 'opacity 0.3s ease';
            shell.style.opacity    = '1';
        });
    }

    /* ── NAVIGATION CLICK — smooth fade out before navigate ──── */
    document.querySelectorAll('a.nav-item, a[data-nav]').forEach(link => {
        link.addEventListener('click', e => {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('javascript')) {
                e.preventDefault();
                const root = document.querySelector('.app-shell') || document.body;
                root.style.transition = 'opacity 0.22s ease';
                root.style.opacity    = '0';
                setTimeout(() => { window.location.href = href; }, 230);
            }
        });
    });

    /* ── ICON INITIALIZATION ─────────────────────────────────── */
    if (window.lucide) window.lucide.createIcons();
    window.refreshIcons = () => { if (window.lucide) window.lucide.createIcons(); };
});

/* ── GLOBAL UTILITIES ───────────────────────────────────────── */
window.RESCUEBOT_UI = {

    toast(message, type = 'info') {
        const isLight = getCurrentTheme() === 'light';
        const bg      = isLight ? '#FFFFFF' : '#1E2840';
        const color   = isLight ? '#0F172A' : '#F1F5F9';
        const border  = isLight ? '#E2E8F0' : 'rgba(255,255,255,0.1)';

        // Remove existing toast of same type to prevent stacking
        const existing = document.querySelector(`.rescuebot-toast[data-type="${type}"]`);
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'rescuebot-toast';
        toast.dataset.type = type;
        toast.style.cssText = `
            position:fixed; bottom:24px; right:24px; z-index:9999;
            background:${bg}; border:1px solid ${border};
            color:${color}; padding:12px 20px; border-radius:8px;
            font-family:'Inter',system-ui,sans-serif; font-size:13px; font-weight:500;
            box-shadow:0 4px 20px rgba(0,0,0,0.25);
            max-width:320px; opacity:0; transform:translateY(8px);
            transition:opacity 0.25s ease, transform 0.25s ease;
            pointer-events:none;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity   = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity   = '0';
            toast.style.transform = 'translateY(8px)';
            setTimeout(() => toast.remove(), 280);
        }, 3500);
    },

    /**
     * Set inner text of a DOM element by ID. Safe — no-ops if element missing.
     * @param {string} id
     * @param {string|number} value
     */
    setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    },

    formatValue(val, decimals = 1) {
        if (val === null || val === undefined || val === '--') return '--';
        return parseFloat(val).toFixed(decimals);
    },

    animateValue(element, from, to, duration = 500) {
        const start  = performance.now();
        const update = (time) => {
            const progress = Math.min((time - start) / duration, 1);
            const eased    = progress < 0.5
                ? 2 * progress * progress
                : -1 + (4 - 2 * progress) * progress;
            element.textContent = (from + (to - from) * eased).toFixed(1);
            if (progress < 1) requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    },

    getTheme:    getCurrentTheme,
    setTheme,
    toggleTheme
};
