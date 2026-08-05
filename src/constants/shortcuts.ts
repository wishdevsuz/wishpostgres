export interface ShortcutGroup {
  title: string;
  items: { label: string; keys: string[] }[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    items: [
      { label: 'New connection', keys: ['Ctrl', 'N'] },
      { label: 'Search in the current view', keys: ['Ctrl', 'F'] },
      { label: 'Global object search', keys: ['Ctrl', 'Shift', 'F'] },
      { label: 'Refresh everything', keys: ['Ctrl', 'R'] },
      { label: 'Settings', keys: ['Ctrl', ','] },
      { label: 'This dialog', keys: ['?'] },
      { label: 'Close dialog', keys: ['Esc'] },
    ],
  },
  {
    title: 'SQL editor',
    items: [
      { label: 'Run selection or tab', keys: ['Ctrl', 'Enter'] },
      { label: 'Run every statement', keys: ['Ctrl', 'Shift', 'Enter'] },
      { label: 'Clear the editor', keys: ['Ctrl', 'L'] },
      { label: 'Save the query', keys: ['Ctrl', 'S'] },
      { label: 'New tab', keys: ['Ctrl', 'T'] },
      { label: 'Close tab', keys: ['Ctrl', 'W'] },
      { label: 'Find in editor', keys: ['Ctrl', 'F'] },
    ],
  },
  {
    title: 'Data grid',
    items: [
      { label: 'Move between cells', keys: ['←', '↑', '↓', '→'] },
      { label: 'Jump a page', keys: ['PgUp', 'PgDn'] },
      { label: 'Edit the active cell', keys: ['Enter'] },
      { label: 'Cancel editing', keys: ['Esc'] },
      { label: 'Toggle row selection', keys: ['Space'] },
      { label: 'Extend the selection', keys: ['Shift', 'Click'] },
      { label: 'Select every row', keys: ['Ctrl', 'A'] },
      { label: 'Copy cell or selection', keys: ['Ctrl', 'C'] },
      { label: 'Delete selected rows', keys: ['Delete'] },
    ],
  },
  {
    title: 'Objects',
    items: [
      { label: 'Rename the selected object', keys: ['F2'] },
      { label: 'Open the context menu', keys: ['Right click'] },
      { label: 'Open a table', keys: ['Click'] },
    ],
  },
];
