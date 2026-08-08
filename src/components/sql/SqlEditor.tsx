import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
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
import { Compartment, EditorState, type Extension } from '@codemirror/state';
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
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

import { statementRanges } from './statements';

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#a78bfa', fontWeight: '500' },
  { tag: tags.operator, color: '#8fa3bd' },
  { tag: [tags.string, tags.special(tags.string)], color: '#7ee787' },
  { tag: tags.number, color: '#ffd166' },
  { tag: tags.bool, color: '#ffd166' },
  { tag: tags.null, color: '#ffd166' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: '#5c6573',
    fontStyle: 'italic',
  },
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

export interface SqlEditorHandle {
  /** The selection, or the statement the cursor sits in, or the whole document. */
  currentStatement: () => string;
  focus: () => void;
  insert: (text: string) => void;
}

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Schema map used for table and column completion. */
  completions?: SQLNamespace;
  onRun?: (selection: string | null) => void;
  onRunAll?: () => void;
  onSave?: () => void;
  autoFocus?: boolean;
  handle?: Ref<SqlEditorHandle>;
}

export function SqlEditor({
  value,
  onChange,
  completions,
  onRun,
  onRunAll,
  onSave,
  autoFocus,
  handle,
}: SqlEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  const callbacks = useRef({ onChange, onRun, onRunAll, onSave });
  callbacks.current = { onChange, onRun, onRunAll, onSave };

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
      language.current.of(sql({ dialect: PostgreSQL, upperCaseKeywords: true })),
      keymap.of([
        {
          key: 'Mod-Enter',
          preventDefault: true,
          run: (editor) => {
            callbacks.current.onRun?.(statementAt(editor));
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
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            callbacks.current.onSave?.();
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
    // The editor is created once per mount; the document and the completion
    // schema are pushed in through the effects below rather than by rebuilding
    // it, which used to throw away the undo history and the cursor mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconfigure completions in place as the catalog loads.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      effects: language.current.reconfigure(
        sql({ dialect: PostgreSQL, schema: completions, upperCaseKeywords: true }),
      ),
    });
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

  useImperativeHandle(
    handle,
    () => ({
      currentStatement: () => {
        const editor = view.current;
        if (!editor) return '';
        return statementAt(editor) ?? editor.state.doc.toString();
      },
      focus: () => view.current?.focus(),
      insert: (text: string) => {
        const editor = view.current;
        if (!editor) return;
        const { from, to } = editor.state.selection.main;
        editor.dispatch({ changes: { from, to, insert: text } });
        editor.focus();
      },
    }),
    [],
  );

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}

/**
 * What "Run" should execute: the selection when there is one, otherwise the
 * statement the cursor is inside. `null` means the caller should fall back to
 * the whole document, which happens when the cursor is not inside a statement.
 */
function statementAt(editor: EditorView): string | null {
  const { from, to } = editor.state.selection.main;
  if (from !== to) return editor.state.sliceDoc(from, to);

  const doc = editor.state.doc.toString();
  const boundaries = statementRanges(doc);
  const found = boundaries.find((range) => from >= range.from && from <= range.to);
  if (!found) return null;

  const text = doc.slice(found.from, found.to).trim();
  return text || null;
}
