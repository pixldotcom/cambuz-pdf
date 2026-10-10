'use strict';

/**
 * macOS-only adjustments to the application menu template.
 *
 * Cambuz builds its own menu. On macOS, Electron's default application menu
 * (which supplies "Quit", "Hide", "Services" and the standard Edit roles) is
 * replaced by that template, so two things must be restored there:
 *
 *  - An application menu, so macOS users get the standard "Quit Cambuz PDF
 *    Reader" item (Cmd+Q) and the usual Hide / Services items.
 *  - The Edit items with copy/cut/paste roles. On macOS the Cmd+C/X/V key
 *    equivalents are routed through these menu roles; without them Cmd+C does
 *    not reach the page's copy handling.
 *
 * Windows and Linux templates are returned unchanged, so their behaviour (and
 * the CI-verified Ctrl+C / Ctrl+Q handling) is not affected.
 */

const EDIT_ROLES = [
  { role: 'undo' },
  { role: 'redo' },
  { type: 'separator' },
  { role: 'cut' },
  { role: 'copy' },
  { role: 'paste' },
];

/**
 * @param {object[]} template Menu template built by main.js.
 * @param {string} platform   process.platform value.
 * @param {string} appName    Product name shown in the application menu.
 * @returns {object[]} A new template for Menu.buildFromTemplate().
 */
function applyMacMenuRoles(template, platform, appName) {
  if (platform !== 'darwin') return template;

  const appMenu = {
    label: appName,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const result = [appMenu];
  for (const item of template) {
    if (item.label === 'File' && Array.isArray(item.submenu)) {
      // Quit is provided by the application menu on macOS; drop the File
      // "Exit" item's Cmd+Q so the accelerator is not registered twice.
      result.push({
        ...item,
        submenu: item.submenu.map((entry) => (
          entry.label === 'Exit' ? { ...entry, accelerator: undefined } : entry
        )),
      });
    } else if (item.label === 'Edit' && Array.isArray(item.submenu)) {
      result.push({ ...item, submenu: [...EDIT_ROLES, { type: 'separator' }, ...item.submenu] });
    } else {
      result.push(item);
    }
  }
  return result;
}

module.exports = { applyMacMenuRoles };
