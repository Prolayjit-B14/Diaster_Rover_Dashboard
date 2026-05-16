/**
 * RescueBOT Shared UI Logic
 * Handles global components like the clock, navbar, and icon system.
 */

document.addEventListener('DOMContentLoaded', () => {
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
    document.body.classList.add('page-loaded');
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

