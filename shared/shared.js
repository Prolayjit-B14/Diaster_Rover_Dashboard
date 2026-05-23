/**
 * RescueBOT Shared UI Logic v3.0
 * Theme toggle, sidebar, clock, nav transitions — all pages
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
    // Update every theme-toggle button on the page
    document.querySelectorAll('[id="theme-toggle"], .theme-toggle-btn').forEach(btn => {
        // Swap the lucide icon
        const icon = btn.querySelector('i[data-lucide], svg');
        if (icon) {
            // If using lucide <i> tag
            if (icon.tagName === 'I') {
                icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
                if (window.lucide) window.lucide.createIcons({ nodes: [icon] });
            }
        }
        // Update aria label
        btn.setAttribute('title', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
        btn.setAttribute('aria-label', btn.getAttribute('title'));
    });
}

/* ── MAIN DOM READY ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

    /* ── Apply saved theme (may already be set, but ensure icon) ── */
    const currentTheme = getCurrentTheme();
    updateThemeIcons(currentTheme);

    /* ── THEME TOGGLE BUTTON ─────────────────────────────────── */
    document.querySelectorAll('#theme-toggle, .theme-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            toggleTheme();
        });
    });

    /* ── SIDEBAR COLLAPSE ────────────────────────────────────── */
    const sidebar    = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    if (sidebar && collapseBtn) {
        // Restore saved state
        if (localStorage.getItem('sidebar-collapsed') === 'true') {
            sidebar.classList.add('collapsed');
        }
        collapseBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
            // Re-render icons so chevron direction updates
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
            shell.style.opacity = '1';
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
                root.style.opacity = '0';
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
        const colors = {
            info:    '#00D4FF',
            success: '#00FF88',
            warning: '#FFB800',
            error:   '#FF2D55'
        };
        const isLight = getCurrentTheme() === 'light';
        const bg    = isLight ? '#FFFFFF' : '#0D1B35';
        const color = isLight ? '#0F1B2D' : '#E8F4FD';
        const accent = colors[type] || colors.info;

        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 24px; right: 24px; z-index: 9999;
            background: ${bg}; border: 1px solid ${accent};
            color: ${color}; padding: 12px 20px; border-radius: 10px;
            font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2), 0 0 20px ${accent}33;
            max-width: 320px; opacity: 0; transform: translateY(8px);
            transition: opacity 0.25s ease, transform 0.25s ease;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Trigger enter animation
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        // Auto remove
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            setTimeout(() => toast.remove(), 280);
        }, 3500);
    },

    formatValue(val, decimals = 1) {
        if (val === null || val === undefined || val === '--') return '--';
        return parseFloat(val).toFixed(decimals);
    },

    animateValue(element, from, to, duration = 500) {
        const start = performance.now();
        const update = (time) => {
            const progress = Math.min((time - start) / duration, 1);
            const eased = progress < 0.5
                ? 2 * progress * progress
                : -1 + (4 - 2 * progress) * progress;
            element.textContent = (from + (to - from) * eased).toFixed(1);
            if (progress < 1) requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    },

    getTheme: getCurrentTheme,
    setTheme,
    toggleTheme
};
