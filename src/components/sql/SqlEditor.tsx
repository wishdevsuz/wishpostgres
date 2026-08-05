import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { PostgreSQL, sql, type SQLNamespace } from '@codemirror/lang-sql';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#a78bfa', fontWeight: '500' },
  { tag: tags.operator, color: '#8fa3bd' },
  { tag: [tags.string, tags.special(tags.string)], color: '#7ee787' },
  { tag: tags.number, color: '#ffd166' },
  { tag: tags.bool, color: '#ffd166' },
  { tag: tags.null, color: '#ffd166' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#5c6573', fontStyle: 'italic' },
  { tag: tags.typeName, color: '#5ea8ff' },
  { tag: tags.variableName, color: '#e7eaf0' },
  { tag: [tags.propertyName, tags.attributeName], color: '#7fd1e6' },
  { tag: tags.function(tags.variableName), color: '#5ea8ff' },
  { tag: tags.punctuation, color: '#8b93a1' },
  { tag: tags.invalid, color: '#f0645a' },
]);

const theme = EditorView.theme(
  {
    '&': { color: '#e7eaf0', backgroundColor: 'transparent' },
    '.cm-content': { caretColor: '#5ea8ff', padding: '10px 0' },
    '.cm-line': { padding: '0 12px' },
    '.cm-gutterElement': { padding: '0 10px 0 14px' },
    '.cm-foldPlaceholder': {
      backgroundColor: '#ffffff14',
      border: 'none',
      color: '#a3acbb',
      borderRadius: '3px',
      padding: '0 6px',
    },
  },
  { dark: true },
);

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Schema map used for table and column completion. */
  completions?: SQLNamespace;
  onRun?: (selection: string | null) => void;
  onRunAll?: () => void;
  autoFocus?: boolean;
}

export function SqlEditor({ value, onChange, completions, onRun, onRunAll, autoFocus }: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun, onRunAll });
  callbacks.current = { onChange, onRun, onRunAll };

  useEffect(() => {
    if (!host.current) return;

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter({ openText: '▾', closedText: '▸' }),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true, maxRenderedOptions: 40 }),
      rectangularSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(highlightStyle),
      theme,
      EditorView.lineWrapping,
      sql({ dialect: PostgreSQL, schema: completions, upperCaseKeywords: true }),
      keymap.of([
        {
          key: 'Mod-Enter',
          preventDefault: true,
          run: (editor) => {
            const { from, to } = editor.state.selection.main;
            const selected = from === to ? null : editor.state.sliceDoc(from, to);
            callbacks.current.onRun?.(selected);
            return true;
          },
        },
        {
          key: 'Mod-Shift-Enter',
          preventDefault: true,
          run: () => {
            callbacks.current.onRunAll?.();
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
      }),
    ];

    const editor = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current,
    });
    view.current = editor;
    if (autoFocus) editor.focus();

    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is created once per mount; `value` is synchronised below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completions]);

  // Push external value changes (tab switches, history replay) into the editor.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor: Math.min(value.length, editor.state.selection.main.anchor) },
    });
  }, [value]);

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}
