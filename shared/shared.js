/**
 * RescueBOT Shared UI Logic v2.0
 * Handles sidebar, theme, clock, nav, page transitions
 */

document.addEventListener('DOMContentLoaded', () => {

    // ── SIDEBAR COLLAPSE ───────────────────────────────────────
    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    if (sidebar && collapseBtn) {
        const savedState = localStorage.getItem('sidebar-collapsed') === 'true';
        if (savedState) sidebar.classList.add('collapsed');
        collapseBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
        });
    }

    // ── ACTIVE NAV ITEM ────────────────────────────────────────
    const currentPath = window.location.pathname.toLowerCase();
    document.querySelectorAll('.nav-item').forEach(item => {
        const href = (item.getAttribute('href') || '').toLowerCase();
        const page = href.split('/').filter(Boolean).pop() || 'index';
        if (currentPath.includes(page) || (page === 'index' && currentPath.endsWith('/'))) {
            item.classList.add('active');
        }
    });

    // ── THEME TOGGLE ───────────────────────────────────────────
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
            document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
            localStorage.setItem('theme', isDark ? 'light' : 'dark');
        });
        const saved = localStorage.getItem('theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
    }

    // ── MISSION CLOCK ──────────────────────────────────────────
    const clockEl = document.getElementById('mission-clock');
    if (clockEl) {
        const tick = () => {
            const now = new Date();
            clockEl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
        };
        setInterval(tick, 1000);
        tick();
    }

    // ── MISSION TIMER ──────────────────────────────────────────
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

    // ── PAGE TRANSITION ────────────────────────────────────────
    const content = document.querySelector('.page-content, .page-enter-target');
    if (content) content.classList.add('page-enter');

    document.querySelectorAll('a.nav-item, a[data-nav]').forEach(link => {
        link.addEventListener('click', e => {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('http') && !href.startsWith('#')) {
                e.preventDefault();
                const shell = document.querySelector('.app-shell, body');
                if (shell) {
                    shell.style.opacity = '0';
                    shell.style.transition = 'opacity 0.25s ease';
                }
                setTimeout(() => window.location.href = href, 250);
            }
        });
    });

    // ── ICON INITIALIZATION ─────────────────────────────────────
    if (window.lucide) window.lucide.createIcons();
    window.refreshIcons = () => { if (window.lucide) window.lucide.createIcons(); };
});

// ── GLOBAL UTILITIES ────────────────────────────────────────────
window.RESCUEBOT_UI = {
    toast(message, type = 'info') {
        const colors = { info: '#00D4FF', success: '#00FF88', warning: '#FFB800', error: '#FF2D55' };
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 24px; right: 24px; z-index: 9999;
            background: #0D1B35; border: 1px solid ${colors[type] || colors.info};
            color: #E8F4FD; padding: 12px 20px; border-radius: 10px;
            font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 20px ${colors[type]}33;
            animation: slideInToast 0.3s ease; max-width: 320px;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
    },

    formatValue(val, decimals = 1) {
        if (val === null || val === undefined || val === '--') return '--';
        return parseFloat(val).toFixed(decimals);
    },

    animateValue(element, from, to, duration = 500) {
        const start = performance.now();
        const update = (time) => {
            const progress = Math.min((time - start) / duration, 1);
            const eased = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
            element.textContent = (from + (to - from) * eased).toFixed(1);
            if (progress < 1) requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }
};
