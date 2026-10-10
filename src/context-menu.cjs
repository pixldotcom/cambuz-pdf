// Cambuz PDF Reader — right-click menu (Electron main process).
//
// Electron shows no context menu by default.
//   - On the page the menu offers Copy (enabled only when there is a selection; it
//     runs Chromium's copy command, so the renderer's permission check still
//     applies) and Select All Text on Page (the same action as Ctrl+A).
//   - In a text field (the search box, the page-number box) it offers the standard
//     editing commands, so those fields behave as users expect.

/**
 * Menu template for a right-click.
 *
 * @param {object} params  Electron's `context-menu` event parameters.
 * @param {{ onSelectAll: () => void }} actions  Called for "Select All Text on Page".
 * @returns {object[]} A template for Menu.buildFromTemplate().
 */
function buildPageContextMenu(params, { onSelectAll }) {
  const selection = params && typeof params.selectionText === 'string' ? params.selectionText : '';
  const flags = (params && params.editFlags) || {};

  if (params && params.isEditable) {
    return [
      { label: 'Cut', role: 'cut', enabled: flags.canCut !== false },
      { label: 'Copy', role: 'copy', enabled: flags.canCopy !== false },
      { label: 'Paste', role: 'paste', enabled: flags.canPaste !== false },
      { type: 'separator' },
      { label: 'Select All', role: 'selectAll' },
    ];
  }

  const canCopy = selection.trim().length > 0 && flags.canCopy !== false;
  return [
    { label: 'Copy', role: 'copy', enabled: canCopy },
    { type: 'separator' },
    { label: 'Select All Text on Page', click: () => onSelectAll() },
  ];
}

module.exports = { buildPageContextMenu };
