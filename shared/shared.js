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
       Enforces dark theme globally                         ── */
;(function applyThemeEarly() {
    document.documentElement.setAttribute('data-theme', 'dark');
})();


/* ── MAIN DOM READY ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

    /* ── DYNAMIC NAVIGATION & AVATAR INJECTION ──────────────── */
    const sidebarEl = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const backdrop  = document.getElementById('sidebar-backdrop');

    // Hide sidebar elements as layout is borderless horizontal
    if (sidebarEl) sidebarEl.style.display = 'none';
    if (mobileBtn) mobileBtn.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';

    const isRoot = !['/camera/', '/dashboard/', '/map/', '/sensors/', '/alerts/'].some(dir => window.location.pathname.toLowerCase().includes(dir));
    const prefix = isRoot ? './' : '../';
    const homePrefix = isRoot ? './' : '../';

    // Inject center horizontal floating navbar on app pages
    const topNavbar = document.querySelector('.top-navbar');
    if (topNavbar) {
        const navContainer = document.createElement('div');
        navContainer.className = 'nav-links-center';

        const items = [
            { label: 'Overview', path: 'dashboard/dashboard.html', icon: 'layout-dashboard' },
            { label: 'Live Monitoring', path: 'camera/camera.html', icon: 'video' },
            { label: 'Incident Map', path: 'map/map.html', icon: 'map-pin' },
            { label: 'Field Sensors', path: 'sensors/sensors.html', icon: 'activity' },
            { label: 'Alerts', path: 'alerts/alerts.html', icon: 'bell-ring' },
            { label: 'Home', path: '', icon: 'home' }
        ];

        navContainer.innerHTML = items.map(item => {
            const fullPath = item.path ? `${prefix}${item.path}` : homePrefix;
            
            let isActive = false;
            if (item.path) {
                const folder = item.path.split('/')[0];
                isActive = window.location.pathname.toLowerCase().includes('/' + folder + '/');
            } else {
                isActive = window.location.pathname.endsWith('/') || window.location.pathname.endsWith('/index.html');
            }
            
            const activeClass = isActive ? 'active' : '';
            return `<a href="${fullPath}" class="nav-link-item ${activeClass}" data-tooltip="${item.label}"><i data-lucide="${item.icon}"></i></a>`;
        }).join('');

        const rightSection = topNavbar.querySelector('.nav-right');
        topNavbar.insertBefore(navContainer, rightSection);

        // Render dynamic Lucide icons inside the injected navbar
        if (window.lucide) {
            window.lucide.createIcons({
                nodes: navContainer.querySelectorAll('[data-lucide]')
            });
        }
    }

    // Inject profile avatar in top right
    const avatar = document.createElement('div');
    avatar.className = 'nav-profile-avatar';
    avatar.textContent = 'PB';
    avatar.title = 'Prolayjit Banerjee';

    const navRight = document.querySelector('.nav-right');
    if (navRight) {
        navRight.appendChild(avatar);
    } else {
        const landingRight = document.querySelector('.landing-nav div[style*="display:flex"]');
        if (landingRight) {
            landingRight.appendChild(avatar);
        }
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
    document.querySelectorAll('a.nav-item, a.nav-link-item, a[data-nav]').forEach(link => {
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
        const bg      = '#0E1520';
        const color   = '#EFF2F7';
        const border  = 'rgba(255,255,255,0.08)';

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

    getTheme() {
        return 'dark';
    },
    setTheme(theme) {},
    toggleTheme() {}
};
