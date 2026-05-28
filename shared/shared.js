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
       Enforces user selected or default dark theme         ── */
;(function applyThemeEarly() {
    const savedTheme = localStorage.getItem('rescuebot-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
})();

/* ── HELPERS ─────────────────────────────────────────────────── */

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rescuebot-theme', theme);
    updateThemeIcons(theme);
    window.dispatchEvent(new CustomEvent('ares:themeChanged', { detail: theme }));
}

function toggleTheme() {
    const current = getCurrentTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
}

function updateThemeIcons(theme) {
    // In dark mode → show sun icon (to switch to light)
    // In light mode → show moon icon (to switch to dark)
    const iconName = theme === 'dark' ? 'sun' : 'moon';

    document.querySelectorAll('[id="theme-toggle"], [id="landing-theme-toggle"], .theme-toggle-btn, .nav-theme-btn').forEach(btn => {
        btn.innerHTML = `<i data-lucide="${iconName}"></i>`;
        if (window.lucide) window.lucide.createIcons({ nodes: [btn] });
        
        const label = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
        btn.setAttribute('title', label);
        btn.setAttribute('aria-label', label);
    });
}


/* ── MAIN DOM READY ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

    /* ── Apply saved theme icon state ─────────────────────────── */
    updateThemeIcons(getCurrentTheme());

    /* ── MOBILE MENU + BACKDROP + COLLAPSE ───────────────────── */
    const sidebarEl = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const backdrop  = document.getElementById('sidebar-backdrop');

    // Restore desktop collapsed state on page load
    if (sidebarEl && window.innerWidth > 900) {
        const isCollapsed = localStorage.getItem('rescuebot-sidebar-collapsed') === 'true';
        if (isCollapsed) {
            sidebarEl.classList.add('collapsed');
        }
    }

    if (sidebarEl && mobileBtn) {
        mobileBtn.addEventListener('click', () => {
            if (window.innerWidth <= 900) {
                sidebarEl.classList.add('mobile-open');
                if (backdrop) backdrop.classList.add('visible');
            } else {
                sidebarEl.classList.toggle('collapsed');
                const isCollapsed = sidebarEl.classList.contains('collapsed');
                localStorage.setItem('rescuebot-sidebar-collapsed', isCollapsed ? 'true' : 'false');
            }
        });
        if (backdrop) {
            backdrop.addEventListener('click', () => {
                sidebarEl.classList.remove('mobile-open');
                backdrop.classList.remove('visible');
            });
        }
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                sidebarEl.classList.remove('mobile-open');
                if (backdrop) backdrop.classList.remove('visible');
            });
        });
    }

    /* ── THEME TOGGLE BUTTON ─────────────────────────────────── */
    document.querySelectorAll('#theme-toggle, #landing-theme-toggle, .theme-toggle-btn, .nav-theme-btn').forEach(btn => {
        btn.addEventListener('click', toggleTheme);
    });

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
        const bg      = isLight ? '#FFFFFF' : '#0E1520';
        const color   = isLight ? '#0F172A' : '#EFF2F7';
        const border  = isLight ? '#E2E8F0' : 'rgba(255,255,255,0.08)';

        const accentColors = {
            success: '#22C55E',
            error: '#EF4444',
            warning: '#F59E0B',
            info: '#3B82F6'
        };
        const accent = accentColors[type] || accentColors.info;

        // Remove existing toast of same type to prevent stacking
        const existing = document.querySelector(`.rescuebot-toast[data-type="${type}"]`);
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'rescuebot-toast';
        toast.dataset.type = type;
        toast.style.cssText = `
            position:fixed; bottom:24px; right:24px; z-index:9999;
            background:${bg}; border:1px solid ${border}; border-left: 4px solid ${accent};
            color:${color}; padding:12px 18px; border-radius:6px;
            font-family:var(--font-body),sans-serif; font-size:12.5px; font-weight:500;
            box-shadow:0 4px 12px rgba(0,0,0,0.15);
            max-width:320px; opacity:0; transform:translateY(8px);
            transition:opacity 0.22s ease, transform 0.22s ease;
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
