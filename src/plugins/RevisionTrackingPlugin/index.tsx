/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import './index.css';

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {mergeRegister} from '@lexical/utils';
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $hasUpdateTag,
  $getNodeByKey,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COLLABORATION_TAG,
  COMMAND_PRIORITY_CRITICAL,
  DELETE_CHARACTER_COMMAND,
  DELETE_WORD_COMMAND,
  HISTORIC_TAG,
  LexicalNode,
  RangeSelection,
  REMOVE_TEXT_COMMAND,
  TextNode,
} from 'lexical';
import {useEffect} from 'react';

import {
  $createRevisionNode,
  $isRevisionNode,
  type RevisionData,
  type RevisionNode,
  type RevisionType,
} from '../../nodes/RevisionNode';

type RevisionTrackingUser = {
  id: string;
  name: string;
};

function $getRevisionAncestor(
  node: LexicalNode | null | undefined,
): RevisionNode | null {
  let current = node;
  while (current !== null && current !== undefined) {
    if ($isRevisionNode(current)) {
      return current;
    }
    current = current.getParent();
  }
  return null;
}

function $selectionIsOwnInsertion(
  selection: RangeSelection,
  currentUser: RevisionTrackingUser,
): boolean {
  const nodes = selection.getNodes();
  const textNodes = nodes.filter($isTextNode);
  if (textNodes.length === 0) {
    return false;
  }
  return textNodes.every((node) => {
    const revisionNode = $getRevisionAncestor(node);
    return (
      revisionNode !== null &&
      revisionNode.getRevisionType() === 'insert' &&
      revisionNode.getAuthorId() === currentUser.id
    );
  });
}

function $wrapSelectionInRevisionNode(
  selection: RangeSelection,
  isBackward: boolean,
  data: RevisionData,
): void {
  const forwardSelection = $createRangeSelection();
  const [startPoint, endPoint] = selection.isBackward()
    ? [selection.focus, selection.anchor]
    : [selection.anchor, selection.focus];
  forwardSelection.anchor.set(
    startPoint.key,
    startPoint.offset,
    startPoint.type,
  );
  forwardSelection.focus.set(endPoint.key, endPoint.offset, endPoint.type);

  let currentNodeParent: LexicalNode | null | undefined;
  let lastCreatedRevisionNode: RevisionNode | undefined;
  const nodes = forwardSelection.extract();

  for (const node of nodes) {
    if (
      $isElementNode(lastCreatedRevisionNode) &&
      lastCreatedRevisionNode.isParentOf(node)
    ) {
      continue;
    }

    let targetNode: LexicalNode | null = null;
    if ($isTextNode(node)) {
      targetNode = node;
    } else if ($isRevisionNode(node)) {
      targetNode = node;
    } else if (
      ($isElementNode(node) || $isDecoratorNode(node)) &&
      node.isInline()
    ) {
      targetNode = node;
    }

    if (targetNode !== null) {
      const revisionAncestor = $getRevisionAncestor(targetNode);
      if (revisionAncestor !== null) {
        if (
          data.revisionType === 'delete' &&
          revisionAncestor.getRevisionType() === 'insert' &&
          revisionAncestor.getAuthorId() === data.authorId
        ) {
          if (targetNode.is(revisionAncestor)) {
            revisionAncestor.remove();
          } else {
            targetNode.remove();
            if (revisionAncestor.getChildren().length === 0) {
              revisionAncestor.remove();
            }
          }
          currentNodeParent = undefined;
          lastCreatedRevisionNode = undefined;
          continue;
        }
        if (data.revisionType !== 'delete') {
          currentNodeParent = undefined;
          lastCreatedRevisionNode = undefined;
          continue;
        }
      }
      if (targetNode.is(currentNodeParent)) {
        continue;
      }
      const parentNode = targetNode.getParent();
      if (parentNode == null || !parentNode.is(currentNodeParent)) {
        lastCreatedRevisionNode = undefined;
      }
      currentNodeParent = parentNode;

      if (lastCreatedRevisionNode === undefined) {
        lastCreatedRevisionNode = $createRevisionNode(data);
        targetNode.insertBefore(lastCreatedRevisionNode);
      }
      lastCreatedRevisionNode.append(targetNode);
    } else {
      currentNodeParent = undefined;
      lastCreatedRevisionNode = undefined;
    }
  }

  if ($isElementNode(lastCreatedRevisionNode)) {
    if (isBackward) {
      lastCreatedRevisionNode.selectStart();
    } else {
      lastCreatedRevisionNode.selectEnd();
    }
  }
}

function $deleteSelectionAsRevision(
  selection: RangeSelection,
  currentUser: RevisionTrackingUser,
): boolean {
  if (selection.getTextContent() === '') {
    return false;
  }
  if ($selectionIsOwnInsertion(selection, currentUser)) {
    selection.removeText();
    return true;
  }
  $wrapSelectionInRevisionNode(
    selection,
    selection.isBackward(),
    {
      authorId: currentUser.id,
      authorName: currentUser.name,
      revisionType: 'delete',
      timestamp: Date.now(),
    },
  );
  return true;
}

function isSameRevision(
  node: LexicalNode | null | undefined,
  user: RevisionTrackingUser,
  revisionType: RevisionType,
): node is RevisionNode {
  return (
    $isRevisionNode(node) &&
    node.getAuthorId() === user.id &&
    node.getRevisionType() === revisionType
  );
}

function getInsertedTextRange(
  previousText: string,
  nextText: string,
): {end: number; start: number} | null {
  if (previousText === nextText) {
    return null;
  }

  let start = 0;
  const previousLength = previousText.length;
  const nextLength = nextText.length;
  while (
    start < previousLength &&
    start < nextLength &&
    previousText[start] === nextText[start]
  ) {
    start++;
  }

  let previousEnd = previousLength;
  let nextEnd = nextLength;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }

  if (nextEnd <= start) {
    return null;
  }

  return {
    end: nextEnd,
    start,
  };
}

function $rememberTextNodes(
  node: LexicalNode,
  knownTextByKey: Map<string, string>,
): void {
  if ($isTextNode(node) && node.isSimpleText()) {
    knownTextByKey.set(node.getKey(), node.getTextContent());
    return;
  }
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      $rememberTextNodes(child, knownTextByKey);
    }
  }
}

function $getTextNodeForInsertedRange(
  textNode: TextNode,
  range: {end: number; start: number},
  knownTextByKey: Map<string, string>,
): TextNode | null {
  const textLength = textNode.getTextContentSize();
  let splitNodes: Array<TextNode>;
  let targetNode: TextNode | undefined;

  if (range.start === 0 && range.end === textLength) {
    knownTextByKey.set(textNode.getKey(), textNode.getTextContent());
    return textNode;
  }

  if (range.start === 0) {
    splitNodes = textNode.splitText(range.end);
    [targetNode] = splitNodes;
  } else if (range.end === textLength) {
    splitNodes = textNode.splitText(range.start, range.end);
    [, targetNode] = splitNodes;
  } else {
    splitNodes = textNode.splitText(range.start, range.end);
    [, targetNode] = splitNodes;
  }

  for (const node of splitNodes) {
    knownTextByKey.set(node.getKey(), node.getTextContent());
  }

  return targetNode ?? null;
}

function $wrapTextNodeInRevision(
  textNode: TextNode,
  currentUser: RevisionTrackingUser,
  knownTextByKey: Map<string, string>,
): void {
  if (!textNode.isSimpleText()) {
    return;
  }

  const textContent = textNode.getTextContent();
  if ($hasUpdateTag(COLLABORATION_TAG) || $hasUpdateTag(HISTORIC_TAG)) {
    if (textContent === '') {
      knownTextByKey.delete(textNode.getKey());
    } else {
      knownTextByKey.set(textNode.getKey(), textContent);
    }
    return;
  }

  if (textContent === '') {
    knownTextByKey.delete(textNode.getKey());
    return;
  }

  const parent = textNode.getParent();
  if (parent === null || $isRevisionNode(parent)) {
    return;
  }

  let targetNode: TextNode | null = textNode;
  const previousText = knownTextByKey.get(textNode.getKey());

  if (previousText !== undefined) {
    const insertedRange = getInsertedTextRange(previousText, textContent);
    knownTextByKey.set(textNode.getKey(), textContent);
    if (insertedRange === null) {
      return;
    }
    targetNode = $getTextNodeForInsertedRange(
      textNode,
      insertedRange,
      knownTextByKey,
    );
    if (targetNode === null) {
      return;
    }
  } else {
    knownTextByKey.set(textNode.getKey(), textContent);
  }

  const targetParent = targetNode.getParent();
  if (targetParent === null || $isRevisionNode(targetParent)) {
    return;
  }

  const revisionType: RevisionType = 'insert';
  const previousSibling = targetNode.getPreviousSibling();
  if (isSameRevision(previousSibling, currentUser, revisionType)) {
    previousSibling.append(targetNode);
    return;
  }

  const nextSibling = targetNode.getNextSibling();
  if (isSameRevision(nextSibling, currentUser, revisionType)) {
    nextSibling.splice(0, 0, [targetNode]);
    return;
  }

  const revisionNode = $createRevisionNode({
    authorId: currentUser.id,
    authorName: currentUser.name,
    revisionType,
    timestamp: Date.now(),
  });
  targetNode.replace(revisionNode);
  revisionNode.append(targetNode);
}

function $markDeletion(
  currentUser: RevisionTrackingUser,
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
  return $deleteSelectionAsRevision(deletionSelection, currentUser);
}

export default function RevisionTrackingPlugin({
  currentUser,
  isEnabled,
}: {
  currentUser: RevisionTrackingUser;
  isEnabled: boolean;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    const dirtyTextNodes = new Set<string>();
    const knownTextByKey = new Map<string, string>();

    editor.getEditorState().read(() => {
      $rememberTextNodes($getRoot(), knownTextByKey);
    });

    const $commitDirtyTextNodes = () => {
      if (dirtyTextNodes.size === 0) {
        return;
      }

      for (const key of dirtyTextNodes) {
        const node = $getNodeByKey(key);
        if ($isTextNode(node) && node.isAttached()) {
          $wrapTextNodeInRevision(node, currentUser, knownTextByKey);
        } else {
          knownTextByKey.delete(key);
        }
      }
      dirtyTextNodes.clear();
    };

    const commitDirtyTextNodes = () => {
      if (dirtyTextNodes.size === 0) {
        return;
      }
      editor.update(() => {
        $commitDirtyTextNodes();
      });
    };

    const unregisterMutation = editor.registerMutationListener(
      TextNode,
      (mutations) => {
        for (const [key, mutation] of mutations) {
          if (mutation === 'destroyed') {
            dirtyTextNodes.delete(key);
            knownTextByKey.delete(key);
          }
        }
      },
    );

    const unregisterTransform = editor.registerNodeTransform(
      TextNode,
      (textNode) => {
        if (!textNode.isSimpleText()) {
          return;
        }
        const parent = textNode.getParent();
        if (parent === null || $isRevisionNode(parent)) {
          return;
        }
        if ($hasUpdateTag(COLLABORATION_TAG) || $hasUpdateTag(HISTORIC_TAG)) {
          return;
        }

        dirtyTextNodes.add(textNode.getKey());
      },
    );

    const onFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget;
      const rootElement = editor.getRootElement();
      if (
        rootElement !== null &&
        nextTarget instanceof Node &&
        rootElement.contains(nextTarget)
      ) {
        return;
      }
      commitDirtyTextNodes();
    };

    const unregisterFocusOut = editor.registerRootListener(
      (rootElement, prevRootElement) => {
        if (prevRootElement !== null) {
          prevRootElement.removeEventListener('focusout', onFocusOut);
        }

        if (rootElement !== null) {
          rootElement.addEventListener('focusout', onFocusOut);
        }
      },
    );

    const unregisterCommands = mergeRegister(
      editor.registerCommand(
        DELETE_CHARACTER_COMMAND,
        (isBackward) => {
          $commitDirtyTextNodes();
          return $markDeletion(currentUser, isBackward, 'character');
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        DELETE_WORD_COMMAND,
        (isBackward) => {
          $commitDirtyTextNodes();
          return $markDeletion(currentUser, isBackward, 'word');
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        REMOVE_TEXT_COMMAND,
        () => {
          $commitDirtyTextNodes();
          const selection = $getSelection();
          return (
            $isRangeSelection(selection) &&
            !selection.isCollapsed() &&
            $deleteSelectionAsRevision(selection, currentUser)
          );
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );

    return () => {
      commitDirtyTextNodes();
      const rootElement = editor.getRootElement();
      if (rootElement !== null) {
        rootElement.removeEventListener('focusout', onFocusOut);
      }
      unregisterMutation();
      unregisterTransform();
      unregisterFocusOut();
      unregisterCommands();
    };
  }, [currentUser, editor, isEnabled]);

  return null;
}
