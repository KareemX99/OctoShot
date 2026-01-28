/**
 * Theme Toggle Logic - Standardized for OctoSHOT
 * Handles Light/Dark mode switching with SVG icons (No Emojis)
 */

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('themeToggle');

    // If no theme toggle button exists on this page, exit
    if (!themeToggle) return;

    // Check for saved theme preference
    // Default to light if not set, or check system preference if desired (optional)
    // Here we stick to explicit user choice or default light
    let isDarkTheme = localStorage.getItem('theme') === 'dark';

    // Apply initial theme class
    if (isDarkTheme) {
        document.body.classList.add('dark-theme');
    }

    // SVG Templates (Matching Dashboard Style)
    // Moon Icon (for Light Mode -> Click to switch to Dark)
    const moonSvg = '<svg class="theme-icon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

    // Sun Icon (for Dark Mode -> Click to switch to Light)
    // Using simple outline style as requested
    const sunSvg = '<svg class="theme-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/></svg>';

    // Set initial icon
    themeToggle.innerHTML = isDarkTheme ? sunSvg : moonSvg;

    // Toggle Handler
    themeToggle.addEventListener('click', (e) => {
        // Prevent default button behavior if any
        e.preventDefault();

        // Toggle state
        isDarkTheme = !isDarkTheme;

        // Toggle Class
        document.body.classList.toggle('dark-theme');

        // Update Local Storage
        localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light');

        // Update Icon
        themeToggle.innerHTML = isDarkTheme ? sunSvg : moonSvg;
    });
});
