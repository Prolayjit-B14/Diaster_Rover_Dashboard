/**
 * RescueBOT Shared UI Logic
 * Handles global components like the clock, navbar, and icon system.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- THEME CONTROLLER ---
    const themeToggle = document.getElementById('theme-toggle');
    const html = document.documentElement;
    
    // Initial Theme Load
    const savedTheme = localStorage.getItem('theme') || 'dark';
    html.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = html.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            html.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeIcon(newTheme);
        });
    }

    function updateThemeIcon(theme) {
        const icon = themeToggle?.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
            if (window.lucide) window.lucide.createIcons();
        }
    }

    // --- ICON INITIALIZATION ---
    const initIcons = () => {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    };
    initIcons();
    
    // Export for dynamic content updates
    window.refreshIcons = initIcons;

    // --- REAL-TIME MISSION CLOCK ---
    const timeDisplay = document.getElementById('current-time');
    const updateClock = () => {
        if (!timeDisplay) return;
        const now = new Date();
        timeDisplay.textContent = now.toLocaleTimeString('en-GB', { 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };
    
    if (timeDisplay) {
        setInterval(updateClock, 1000);
        updateClock();
    }

    // --- NAVIGATION ACTIVE STATE ---
    const markActiveNav = () => {
        const currentPath = window.location.pathname.toLowerCase();
        const navItems = document.querySelectorAll('.nav-item');
        
        navItems.forEach(item => {
            const href = item.getAttribute('href').toLowerCase().replace('../', '');
            if (currentPath.includes(href)) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    };
    markActiveNav();

    // --- PAGE TRANSITION EFFECT ---
    const frame = document.querySelector('.app-frame');
    if (frame) {
        frame.style.opacity = '1';
    }

    // Intercept all internal links for smooth exit
    document.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href');
            if (href && !href.startsWith('http') && !href.startsWith('#')) {
                e.preventDefault();
                if (frame) {
                    frame.style.opacity = '0';
                    frame.style.transform = 'scale(0.98)';
                    frame.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
                }
                setTimeout(() => {
                    window.location.href = href;
                }, 400);
            }
        });
    });
});

/**
 * Global UI Utilities
 */
window.ARES_UI = {
    toast: (message, type = 'info') => {
        console.log(`[ARES-UI] ${type.toUpperCase()}: ${message}`);
        // Implementation for a toast system could go here if needed
    }
};

