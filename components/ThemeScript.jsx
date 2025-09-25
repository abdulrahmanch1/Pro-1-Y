
import React from 'react';

// This script is injected into the document head via app/layout.jsx to run before React hydrates.
// This prevents the theme flicker that can happen when the theme is set in a useEffect.
const themeScript = `
  (function() {
    function getInitialTheme() {
      try {
        const storedTheme = localStorage.getItem('theme');
        if (storedTheme) {
          return storedTheme;
        }
        // If no theme is stored, check the user's system preference.
        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
        if (mediaQuery.matches) {
          return 'light';
        }
      } catch (e) {
        // Ignore localStorage access errors (e.g., in private browsing).
      }
      return 'dark'; // Default to dark theme.
    }
    const theme = getInitialTheme();
    document.documentElement.setAttribute('data-theme', theme);
  })();
`;

const ThemeScript = () => (
  <script dangerouslySetInnerHTML={{ __html: themeScript }} />
);

export default ThemeScript;
