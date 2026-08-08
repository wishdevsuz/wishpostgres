export interface ShortcutGroup {
  title: string;
  items: { label: string; keys: string[] }[];
}

/**
 * Every entry here is bound somewhere in the app. Keep it that way: a listed
 * shortcut that does nothing is worse than one that is not listed at all.
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    items: [
      { label: 'New connection', keys: ['Ctrl', 'N'] },
      { label: 'Focus the filter in this view', keys: ['Ctrl', 'F'] },
      { label: 'Global object search', keys: ['Ctrl', 'Shift', 'F'] },
      { label: 'Global object search', keys: ['Ctrl', 'K'] },
      { label: 'Refresh everything', keys: ['Ctrl', 'R'] },
      { label: 'Show or hide the sidebar', keys: ['Ctrl', 'B'] },
      { label: 'Settings', keys: ['Ctrl', ','] },
      { label: 'This dialog', keys: ['?'] },
      { label: 'Close dialog', keys: ['Esc'] },
    ],
  },
  {
    title: 'SQL editor',
    items: [
      { label: 'Run the selection or the statement at the cursor', keys: ['Ctrl', 'Enter'] },
      { label: 'Run every statement in the tab', keys: ['Ctrl', 'Shift', 'Enter'] },
      { label: 'Save the query', keys: ['Ctrl', 'S'] },
      { label: 'Clear the editor', keys: ['Ctrl', 'L'] },
      { label: 'New tab', keys: ['Ctrl', 'T'] },
      { label: 'Close tab', keys: ['Ctrl', 'W'] },
      { label: 'Find in the editor', keys: ['Ctrl', 'F'] },
      { label: 'Undo and redo', keys: ['Ctrl', 'Z'] },
    ],
  },
  {
    title: 'Data grid',
    items: [
      { label: 'Move between cells', keys: ['←', '↑', '↓', '→'] },
      { label: 'Jump a page', keys: ['PgUp', 'PgDn'] },
      { label: 'First and last row', keys: ['Home', 'End'] },
      { label: 'Edit the active cell', keys: ['Enter'] },
      { label: 'Set the cell being edited to NULL', keys: ['Ctrl', 'N'] },
      { label: 'Cancel editing', keys: ['Esc'] },
      { label: 'Toggle row selection', keys: ['Space'] },
      { label: 'Extend the selection', keys: ['Shift', 'Click'] },
      { label: 'Select every row', keys: ['Ctrl', 'A'] },
      { label: 'Clear the selection', keys: ['Esc'] },
      { label: 'Copy cell or selection', keys: ['Ctrl', 'C'] },
      { label: 'Delete selected rows', keys: ['Delete'] },
    ],
  },
  {
    title: 'Objects',
    items: [
      { label: 'Rename the open table', keys: ['F2'] },
      { label: 'Open the context menu', keys: ['Right click'] },
      { label: 'Open a table', keys: ['Click'] },
      { label: 'Rename a SQL tab', keys: ['Double click'] },
    ],
  },
];
