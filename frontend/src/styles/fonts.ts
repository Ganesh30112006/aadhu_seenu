/*
 * Self-hosted fonts. Every @font-face in these files declares a unicode-range, so:
 *  - Latin text is always rendered by Inter (first in --font-sans), and Noto's Latin faces are
 *    never downloaded;
 *  - the Telugu / Devanagari files are fetched only when a page actually contains those scripts.
 */
import '@fontsource-variable/inter/wght.css';
import '@fontsource/noto-sans-telugu/400.css';
import '@fontsource/noto-sans-telugu/600.css';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/600.css';
