/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {
  LexicalCommand,
  LexicalNode,
  NodeKey,
  RangeSelection,
} from 'lexical';
import type {JSX} from 'react';

import './index.css';

import {useCollaborationContext} from '@lexical/react/LexicalCollaborationContext';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {mergeRegister} from '@lexical/utils';
import {
  $createLineBreakNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_EDITOR,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  createCommand,
  DELETE_CHARACTER_COMMAND,
  DELETE_WORD_COMMAND,
  PASTE_COMMAND,
  REMOVE_TEXT_COMMAND,
} from 'lexical';
import {useCallback, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

import {
  $createSuggestionNode,
  $isSuggestionNode,
  $unwrapSuggestionNode,
  $wrapSelectionInSuggestionNode,
} from '../../nodes/SuggestionNode';
import type {
  SuggestionData,
  SuggestionNode,
  SuggestionType,
} from '../../nodes/SuggestionNode';

export const TOGGLE_TRACK_CHANGES_COMMAND: LexicalCommand<void> = createCommand(
  'TOGGLE_TRACK_CHANGES_COMMAND',
);
export const ACCEPT_SUGGESTION_COMMAND: LexicalCommand<string> = createCommand(
  'ACCEPT_SUGGESTION_COMMAND',
);
export const REJECT_SUGGESTION_COMMAND: LexicalCommand<string> = createCommand(
  'REJECT_SUGGESTION_COMMAND',
);
export const UPDATE_SUGGESTION_COMMENT_COMMAND: LexicalCommand<{
  comment: string;
  suggestionId: string;
}> = createCommand('UPDATE_SUGGESTION_COMMENT_COMMAND');

type SuggestionRecord = SuggestionData & {
  keys: Set<NodeKey>;
  text: string;
};

function createSuggestionId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `suggestion-${crypto.randomUUID()}`;
  }
  return `suggestion-${Math.random().toString(36).slice(2)}`;
}

function createSuggestionData(
  suggestionType: SuggestionType,
  author: string,
): SuggestionData {
  return {
    author,
    comment: '',
    createdAt: Date.now(),
    suggestionId: createSuggestionId(),
    suggestionType,
  };
}

function getInputText(payload: InputEvent | string): string {
  if (typeof payload === 'string') {
    return payload;
  }
  return payload.data || '';
}

function isCompositionInput(payload: InputEvent | string): boolean {
  if (typeof payload === 'string') {
    return false;
  }
  return (
    payload.isComposing ||
    payload.inputType === 'insertCompositionText' ||
    payload.inputType === 'insertFromComposition'
  );
}

function $forEachSuggestionNode(visitor: (node: SuggestionNode) => void): void {
  const visit = (node: LexicalNode) => {
    if ($isSuggestionNode(node)) {
      visitor(node);
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child);
      }
    }
  };

  visit($getRoot());
}

function $getSuggestionAncestor(
  node: LexicalNode | null | undefined,
): SuggestionNode | null {
  let current = node;
  while (current !== null && current !== undefined) {
    if ($isSuggestionNode(current)) {
      return current;
    }
    current = current.getParent();
  }
  return null;
}

function getOwnInsertionDataFromNode(
  node: LexicalNode | null | undefined,
  author: string,
): SuggestionData | null {
  const suggestionNode = $isSuggestionNode(node)
    ? node
    : $getSuggestionAncestor(node);
  if (
    suggestionNode !== null &&
    suggestionNode.getSuggestionType() === 'insertion' &&
    suggestionNode.getAuthor() === author
  ) {
    return suggestionNode.getSuggestionData();
  }
  return null;
}

function $getAdjacentOwnInsertionData(
  selection: RangeSelection,
  author: string,
): SuggestionData | null {
  if (!selection.isCollapsed()) {
    return null;
  }
  const anchor = selection.anchor;
  if (anchor.type === 'text') {
    const anchorNode = anchor.getNode();
    if (!$isTextNode(anchorNode)) {
      return null;
    }
    const textSize = anchorNode.getTextContentSize();
    if (anchor.offset === 0) {
      return getOwnInsertionDataFromNode(
        anchorNode.getPreviousSibling(),
        author,
      );
    }
    if (anchor.offset === textSize) {
      return getOwnInsertionDataFromNode(anchorNode.getNextSibling(), author);
    }
    return null;
  }
  const elementNode = anchor.getNode();
  if (!$isElementNode(elementNode)) {
    return null;
  }
  const previousNode =
    anchor.offset > 0 ? elementNode.getChildAtIndex(anchor.offset - 1) : null;
  return (
    getOwnInsertionDataFromNode(previousNode, author) ||
    getOwnInsertionDataFromNode(
      elementNode.getChildAtIndex(anchor.offset),
      author,
    )
  );
}

function $getAdjacentOwnInsertionDataForTextRange(
  node: LexicalNode,
  startOffset: number,
  endOffset: number,
  author: string,
): SuggestionData | null {
  if (!$isTextNode(node)) {
    return null;
  }
  if (startOffset === 0) {
    const data = getOwnInsertionDataFromNode(node.getPreviousSibling(), author);
    if (data !== null) {
      return data;
    }
  }
  if (endOffset === node.getTextContentSize()) {
    return getOwnInsertionDataFromNode(node.getNextSibling(), author);
  }
  return null;
}

function $isCollapsedInsideOwnInsertion(
  selection: RangeSelection,
  author: string,
): boolean {
  if (!selection.isCollapsed()) {
    return false;
  }
  const suggestionNode = $getSuggestionAncestor(selection.anchor.getNode());
  return (
    suggestionNode !== null &&
    suggestionNode.getSuggestionType() === 'insertion' &&
    suggestionNode.getAuthor() === author
  );
}

function $selectionIsOwnInsertion(
  selection: RangeSelection,
  author: string,
): boolean {
  const nodes = selection.getNodes();
  const textNodes = nodes.filter($isTextNode);
  if (textNodes.length === 0) {
    return false;
  }
  return textNodes.every((node) => {
    const suggestionNode = $getSuggestionAncestor(node);
    return (
      suggestionNode !== null &&
      suggestionNode.getSuggestionType() === 'insertion' &&
      suggestionNode.getAuthor() === author
    );
  });
}

function appendTextToSuggestionNode(
  suggestionNode: SuggestionNode,
  text: string,
): void {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, index) => {
    if (line !== '') {
      suggestionNode.append($createTextNode(line));
    }
    if (index < lines.length - 1) {
      suggestionNode.append($createLineBreakNode());
    }
  });
}

function $deleteSelectionAsSuggestion(
  selection: RangeSelection,
  author: string,
): boolean {
  if (selection.getTextContent() === '') {
    return false;
  }
  if ($selectionIsOwnInsertion(selection, author)) {
    selection.removeText();
    return true;
  }
  $wrapSelectionInSuggestionNode(
    selection,
    selection.isBackward(),
    createSuggestionData('deletion', author),
  );
  return true;
}

function $insertSuggestionText(text: string, author: string): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || text === '') {
    return false;
  }
  if ($isCollapsedInsideOwnInsertion(selection, author)) {
    return false;
  }
  if (!selection.isCollapsed()) {
    $deleteSelectionAsSuggestion(selection, author);
  }

  const nextSelection = $getSelection();
  if (!$isRangeSelection(nextSelection)) {
    return false;
  }

  const suggestionNode = $createSuggestionNode(
    $getAdjacentOwnInsertionData(nextSelection, author) ||
      createSuggestionData('insertion', author),
  );
  appendTextToSuggestionNode(suggestionNode, text);
  nextSelection.insertNodes([suggestionNode]);
  suggestionNode.selectEnd();
  return true;
}

function $wrapCommittedCompositionText(text: string, author: string): void {
  const selection = $getSelection();
  if (
    !$isRangeSelection(selection) ||
    !selection.isCollapsed() ||
    text === ''
  ) {
    return;
  }
  const anchor = selection.anchor;
  if (anchor.type !== 'text') {
    return;
  }
  const anchorNode = anchor.getNode();
  if (!$isTextNode(anchorNode)) {
    return;
  }
  const suggestionNode = $getSuggestionAncestor(anchorNode);
  if (
    suggestionNode !== null &&
    suggestionNode.getSuggestionType() === 'insertion' &&
    suggestionNode.getAuthor() === author
  ) {
    return;
  }
  const endOffset = anchor.offset;
  const startOffset = endOffset - text.length;
  if (
    startOffset < 0 ||
    anchorNode.getTextContent().slice(startOffset, endOffset) !== text
  ) {
    return;
  }
  const suggestionSelection = selection.clone();
  suggestionSelection.anchor.set(anchor.key, startOffset, 'text');
  suggestionSelection.focus.set(anchor.key, endOffset, 'text');
  $wrapSelectionInSuggestionNode(
    suggestionSelection,
    false,
    $getAdjacentOwnInsertionDataForTextRange(
      anchorNode,
      startOffset,
      endOffset,
      author,
    ) || createSuggestionData('insertion', author),
  );
}

function $markDeletion(
  author: string,
  isBackward: boolean,
  granularity: 'character' | 'word',
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }
  const deletionSelection = selection.clone();
  if (deletionSelection.isCollapsed()) {
    deletionSelection.modify('extend', isBackward, granularity);
  }
  return $deleteSelectionAsSuggestion(deletionSelection, author);
}

function $removeSuggestion(suggestionId: string): void {
  const keys: Array<NodeKey> = [];
  $forEachSuggestionNode((node) => {
    if (node.getSuggestionId() === suggestionId) {
      keys.push(node.getKey());
    }
  });
  for (const key of keys) {
    const node = $getNodeByKey<SuggestionNode>(key);
    if ($isSuggestionNode(node)) {
      node.remove();
    }
  }
}

function $unwrapSuggestion(suggestionId: string): void {
  const keys: Array<NodeKey> = [];
  $forEachSuggestionNode((node) => {
    if (node.getSuggestionId() === suggestionId) {
      keys.push(node.getKey());
    }
  });
  for (const key of keys) {
    const node = $getNodeByKey<SuggestionNode>(key);
    if ($isSuggestionNode(node)) {
      $unwrapSuggestionNode(node);
    }
  }
}

function $updateSuggestionComment(suggestionId: string, comment: string): void {
  $forEachSuggestionNode((node) => {
    if (node.getSuggestionId() === suggestionId) {
      node.setComment(comment);
    }
  });
}

function $collectSuggestions(): Array<SuggestionRecord> {
  const suggestions = new Map<string, SuggestionRecord>();
  $forEachSuggestionNode((node) => {
    const data = node.getSuggestionData();
    const existing = suggestions.get(data.suggestionId);
    if (existing === undefined) {
      suggestions.set(data.suggestionId, {
        ...data,
        keys: new Set([node.getKey()]),
        text: node.getTextContent(),
      });
    } else {
      existing.keys.add(node.getKey());
      existing.text += node.getTextContent();
      if (data.comment !== existing.comment) {
        existing.comment = data.comment;
      }
    }
  });
  return Array.from(suggestions.values()).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}

function formatTime(createdAt: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(new Date(createdAt));
}

function SuggestionsPanel({
  isEnabled,
  suggestions,
}: {
  isEnabled: boolean;
  suggestions: Array<SuggestionRecord>;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();

  return (
    <div className="TrackChangesPlugin_Panel">
      <div className="TrackChangesPlugin_Header">
        <h2>修订记录</h2>
        <span className="TrackChangesPlugin_Status">
          {isEnabled ? '已开启' : '已关闭'}
        </span>
      </div>
      {suggestions.length === 0 ? (
        <div className="TrackChangesPlugin_Empty">暂无修订</div>
      ) : (
        <ul className="TrackChangesPlugin_List">
          {suggestions.map((suggestion) => (
            <li
              className="TrackChangesPlugin_Item"
              key={suggestion.suggestionId}>
              <div className="TrackChangesPlugin_ItemHeader">
                <span
                  className={`TrackChangesPlugin_Type ${suggestion.suggestionType}`}>
                  {suggestion.suggestionType === 'insertion' ? '新增' : '删除'}
                </span>
                <span className="TrackChangesPlugin_Meta">
                  {suggestion.author} · {formatTime(suggestion.createdAt)}
                </span>
              </div>
              <div className="TrackChangesPlugin_Quote">
                {suggestion.text || '（空）'}
              </div>
              <textarea
                className="TrackChangesPlugin_Comment"
                value={suggestion.comment}
                placeholder="添加备注..."
                onChange={(event) => {
                  editor.dispatchCommand(UPDATE_SUGGESTION_COMMENT_COMMAND, {
                    comment: event.target.value,
                    suggestionId: suggestion.suggestionId,
                  });
                }}
              />
              <div className="TrackChangesPlugin_Actions">
                <button
                  className="TrackChangesPlugin_Button"
                  type="button"
                  onClick={() => {
                    editor.dispatchCommand(
                      REJECT_SUGGESTION_COMMAND,
                      suggestion.suggestionId,
                    );
                  }}>
                  拒绝
                </button>
                <button
                  className="TrackChangesPlugin_Button primary"
                  type="button"
                  onClick={() => {
                    editor.dispatchCommand(
                      ACCEPT_SUGGESTION_COMMAND,
                      suggestion.suggestionId,
                    );
                  }}>
                  接受
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TrackChangesPlugin({
  isEnabled,
  setIsEnabled,
}: {
  isEnabled: boolean;
  setIsEnabled: (isEnabled: boolean) => void;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const {name, yjsDocMap} = useCollaborationContext();
  const author = yjsDocMap.has('comments') ? name : '小说作者';
  const [suggestions, setSuggestions] = useState<Array<SuggestionRecord>>([]);
  const suggestionsRef = useRef<Array<SuggestionRecord>>([]);

  const syncSuggestions = useCallback(
    (nextSuggestions: Array<SuggestionRecord>) => {
      suggestionsRef.current = nextSuggestions;
      setSuggestions(nextSuggestions);
    },
    [],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({editorState}) => {
        editorState.read(() => {
          syncSuggestions($collectSuggestions());
        });
      }),
      editor.registerCommand(
        TOGGLE_TRACK_CHANGES_COMMAND,
        () => {
          setIsEnabled(!isEnabled);
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        (payload) => {
          if (!isEnabled) {
            return false;
          }
          if (editor.isComposing() || isCompositionInput(payload)) {
            return false;
          }
          return $insertSuggestionText(getInputText(payload), author);
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        COMPOSITION_START_COMMAND,
        () => {
          if (!isEnabled) {
            return false;
          }
          const selection = $getSelection();
          if ($isRangeSelection(selection) && !selection.isCollapsed()) {
            $deleteSelectionAsSuggestion(selection, author);
          }
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        COMPOSITION_END_COMMAND,
        (event) => {
          if (!isEnabled || !(event instanceof CompositionEvent)) {
            return false;
          }
          const text = event.data;
          if (text === '') {
            return false;
          }
          queueMicrotask(() => {
            editor.update(() => {
              $wrapCommittedCompositionText(text, author);
            });
          });
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!isEnabled || !(event instanceof ClipboardEvent)) {
            return false;
          }
          const text = event.clipboardData?.getData('text/plain') || '';
          if (text === '') {
            return false;
          }
          event.preventDefault();
          return $insertSuggestionText(text, author);
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        DELETE_CHARACTER_COMMAND,
        (isBackward) => {
          return isEnabled && $markDeletion(author, isBackward, 'character');
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        DELETE_WORD_COMMAND,
        (isBackward) => {
          return isEnabled && $markDeletion(author, isBackward, 'word');
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        REMOVE_TEXT_COMMAND,
        () => {
          const selection = $getSelection();
          return (
            isEnabled &&
            $isRangeSelection(selection) &&
            !selection.isCollapsed() &&
            $deleteSelectionAsSuggestion(selection, author)
          );
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        ACCEPT_SUGGESTION_COMMAND,
        (suggestionId) => {
          const suggestion = suggestionsRef.current.find(
            (item) => item.suggestionId === suggestionId,
          );
          if (suggestion === undefined) {
            return false;
          }
          if (suggestion.suggestionType === 'insertion') {
            $unwrapSuggestion(suggestionId);
          } else {
            $removeSuggestion(suggestionId);
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        REJECT_SUGGESTION_COMMAND,
        (suggestionId) => {
          const suggestion = suggestionsRef.current.find(
            (item) => item.suggestionId === suggestionId,
          );
          if (suggestion === undefined) {
            return false;
          }
          if (suggestion.suggestionType === 'insertion') {
            $removeSuggestion(suggestionId);
          } else {
            $unwrapSuggestion(suggestionId);
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        UPDATE_SUGGESTION_COMMENT_COMMAND,
        (payload) => {
          $updateSuggestionComment(payload.suggestionId, payload.comment);
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [author, editor, isEnabled, setIsEnabled, syncSuggestions]);

  useEffect(() => {
    editor.getEditorState().read(() => {
      syncSuggestions($collectSuggestions());
    });
  }, [editor, syncSuggestions]);

  if (!isEnabled && suggestions.length === 0) {
    return null;
  }

  return createPortal(
    <SuggestionsPanel isEnabled={isEnabled} suggestions={suggestions} />,
    document.body,
  );
}
