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
import {useEffect} from 'react';

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

function $getSuggestionType(suggestionId: string): SuggestionType | null {
  let suggestionType: SuggestionType | null = null;
  $forEachSuggestionNode((node) => {
    if (node.getSuggestionId() === suggestionId) {
      suggestionType = node.getSuggestionType();
    }
  });
  return suggestionType;
}

export default function TrackChangesPlugin({
  authorName,
  isEnabled,
}: {
  authorName: string;
  isEnabled: boolean;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const author = authorName;

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        TOGGLE_TRACK_CHANGES_COMMAND,
        () => {
          return false;
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
          const suggestionType = $getSuggestionType(suggestionId);
          if (suggestionType === null) {
            return false;
          }
          if (suggestionType === 'insertion') {
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
          const suggestionType = $getSuggestionType(suggestionId);
          if (suggestionType === null) {
            return false;
          }
          if (suggestionType === 'insertion') {
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
  }, [author, editor, isEnabled]);

  return null;
}
