/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {
  BaseSelection,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  LexicalUpdateJSON,
  NodeKey,
  RangeSelection,
  SerializedElementNode,
  Spread,
} from 'lexical';

import {
  $applyNodeReplacement,
  $createRangeSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  ElementNode,
} from 'lexical';

export type SuggestionType = 'insertion' | 'deletion';

export type SuggestionData = {
  author: string;
  comment: string;
  createdAt: number;
  suggestionId: string;
  suggestionType: SuggestionType;
};

export type SerializedSuggestionNode = Spread<
  SuggestionData,
  SerializedElementNode
>;

function applySuggestionAttributes(
  element: HTMLElement,
  data: SuggestionData,
): void {
  element.className =
    data.suggestionType === 'insertion'
      ? 'ck-suggestion-marker-insert'
      : 'ck-suggestion-marker-delete';
  element.dataset.suggestionId = data.suggestionId;
  element.dataset.suggestionType = data.suggestionType;
  element.dataset.suggestionAuthor = data.author;
  element.dataset.suggestionCreatedAt = String(data.createdAt);
  if (data.comment) {
    element.dataset.suggestionComment = data.comment;
  } else {
    delete element.dataset.suggestionComment;
  }
}

export class SuggestionNode extends ElementNode {
  __author: string;
  __comment: string;
  __createdAt: number;
  __suggestionId: string;
  __suggestionType: SuggestionType;

  static getType(): string {
    return 'suggestion';
  }

  static clone(node: SuggestionNode): SuggestionNode {
    return new SuggestionNode(node.getSuggestionData(), node.__key);
  }

  static importJSON(serializedNode: SerializedSuggestionNode): SuggestionNode {
    return $createSuggestionNode({
      author: serializedNode.author,
      comment: serializedNode.comment || '',
      createdAt: serializedNode.createdAt,
      suggestionId: serializedNode.suggestionId,
      suggestionType: serializedNode.suggestionType,
    }).updateFromJSON(serializedNode);
  }

  constructor(data: SuggestionData, key?: NodeKey) {
    super(key);
    this.__author = data.author;
    this.__comment = data.comment;
    this.__createdAt = data.createdAt;
    this.__suggestionId = data.suggestionId;
    this.__suggestionType = data.suggestionType;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__author = prevNode.__author;
    this.__comment = prevNode.__comment;
    this.__createdAt = prevNode.__createdAt;
    this.__suggestionId = prevNode.__suggestionId;
    this.__suggestionType = prevNode.__suggestionType;
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedSuggestionNode>,
  ): this {
    const self = super.updateFromJSON(serializedNode);
    return self
      .setAuthor(serializedNode.author)
      .setComment(serializedNode.comment || '')
      .setCreatedAt(serializedNode.createdAt)
      .setSuggestionId(serializedNode.suggestionId)
      .setSuggestionType(serializedNode.suggestionType);
  }

  exportJSON(): SerializedSuggestionNode {
    return {
      ...super.exportJSON(),
      author: this.getAuthor(),
      comment: this.getComment(),
      createdAt: this.getCreatedAt(),
      suggestionId: this.getSuggestionId(),
      suggestionType: this.getSuggestionType(),
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    applySuggestionAttributes(element, this.getSuggestionData());
    return element;
  }

  updateDOM(prevNode: this, element: HTMLElement): boolean {
    if (
      prevNode.__suggestionType !== this.__suggestionType ||
      prevNode.__suggestionId !== this.__suggestionId ||
      prevNode.__author !== this.__author ||
      prevNode.__createdAt !== this.__createdAt ||
      prevNode.__comment !== this.__comment
    ) {
      applySuggestionAttributes(element, this.getSuggestionData());
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    applySuggestionAttributes(element, this.getSuggestionData());
    return {element};
  }

  getSuggestionData(): SuggestionData {
    const latest = this.getLatest();
    return {
      author: latest.__author,
      comment: latest.__comment,
      createdAt: latest.__createdAt,
      suggestionId: latest.__suggestionId,
      suggestionType: latest.__suggestionType,
    };
  }

  getSuggestionId(): string {
    return this.getLatest().__suggestionId;
  }

  setSuggestionId(suggestionId: string): this {
    const self = this.getWritable();
    self.__suggestionId = suggestionId;
    return self;
  }

  getSuggestionType(): SuggestionType {
    return this.getLatest().__suggestionType;
  }

  setSuggestionType(suggestionType: SuggestionType): this {
    const self = this.getWritable();
    self.__suggestionType = suggestionType;
    return self;
  }

  getAuthor(): string {
    return this.getLatest().__author;
  }

  setAuthor(author: string): this {
    const self = this.getWritable();
    self.__author = author;
    return self;
  }

  getCreatedAt(): number {
    return this.getLatest().__createdAt;
  }

  setCreatedAt(createdAt: number): this {
    const self = this.getWritable();
    self.__createdAt = createdAt;
    return self;
  }

  getComment(): string {
    return this.getLatest().__comment;
  }

  setComment(comment: string): this {
    const self = this.getWritable();
    self.__comment = comment;
    return self;
  }

  canInsertTextBefore(): false {
    return false;
  }

  canInsertTextAfter(): false {
    return false;
  }

  canBeEmpty(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  extractWithChild(
    _child: LexicalNode,
    selection: BaseSelection,
    destination: 'clone' | 'html',
  ): boolean {
    if (!$isRangeSelection(selection) || destination === 'html') {
      return false;
    }
    const anchor = selection.anchor;
    const focus = selection.focus;
    const anchorNode = anchor.getNode();
    const focusNode = focus.getNode();
    const selectionLength = selection.isBackward()
      ? anchor.offset - focus.offset
      : focus.offset - anchor.offset;

    return (
      this.isParentOf(anchorNode) &&
      this.isParentOf(focusNode) &&
      this.getTextContent().length === selectionLength
    );
  }
}

export function $createSuggestionNode(data: SuggestionData): SuggestionNode {
  return $applyNodeReplacement(new SuggestionNode(data));
}

export function $isSuggestionNode(
  node: LexicalNode | null | undefined,
): node is SuggestionNode {
  return node instanceof SuggestionNode;
}

function $getSuggestionAncestor(node: LexicalNode): SuggestionNode | null {
  let current = node.getParent();
  while (current !== null) {
    if ($isSuggestionNode(current)) {
      return current;
    }
    current = current.getParent();
  }
  return null;
}

export function $unwrapSuggestionNode(node: SuggestionNode): void {
  const children = node.getChildren();
  let target: LexicalNode | null = null;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (target === null) {
      node.insertBefore(child);
    } else {
      target.insertAfter(child);
    }
    target = child;
  }
  node.remove();
}

export function $wrapSelectionInSuggestionNode(
  selection: RangeSelection,
  isBackward: boolean,
  data: SuggestionData,
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
  let lastCreatedSuggestionNode: SuggestionNode | undefined;
  const nodes = forwardSelection.extract();

  for (const node of nodes) {
    if (
      $isElementNode(lastCreatedSuggestionNode) &&
      lastCreatedSuggestionNode.isParentOf(node)
    ) {
      continue;
    }

    let targetNode: LexicalNode | null = null;
    if ($isTextNode(node)) {
      targetNode = node;
    } else if ($isSuggestionNode(node)) {
      if (
        data.suggestionType === 'deletion' &&
        node.getSuggestionType() === 'insertion' &&
        node.getAuthor() === data.author
      ) {
        node.remove();
      }
      continue;
    } else if (
      ($isElementNode(node) || $isDecoratorNode(node)) &&
      node.isInline()
    ) {
      targetNode = node;
    }

    if (targetNode !== null) {
      const suggestionAncestor = $getSuggestionAncestor(targetNode);
      if (suggestionAncestor !== null) {
        if (
          data.suggestionType === 'deletion' &&
          suggestionAncestor.getSuggestionType() === 'insertion' &&
          suggestionAncestor.getAuthor() === data.author
        ) {
          targetNode.remove();
          if (suggestionAncestor.getChildren().length === 0) {
            suggestionAncestor.remove();
          }
        }
        currentNodeParent = undefined;
        lastCreatedSuggestionNode = undefined;
        continue;
      }
      if (targetNode.is(currentNodeParent)) {
        continue;
      }
      const parentNode = targetNode.getParent();
      if (parentNode == null || !parentNode.is(currentNodeParent)) {
        lastCreatedSuggestionNode = undefined;
      }
      currentNodeParent = parentNode;

      if (lastCreatedSuggestionNode === undefined) {
        lastCreatedSuggestionNode = $createSuggestionNode(data);
        targetNode.insertBefore(lastCreatedSuggestionNode);
      }
      lastCreatedSuggestionNode.append(targetNode);
    } else {
      currentNodeParent = undefined;
      lastCreatedSuggestionNode = undefined;
    }
  }

  if ($isElementNode(lastCreatedSuggestionNode)) {
    if (isBackward) {
      lastCreatedSuggestionNode.selectStart();
    } else {
      lastCreatedSuggestionNode.selectEnd();
    }
  }
}
