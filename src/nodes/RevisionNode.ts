/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {
  BaseSelection,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  ElementDOMSlot,
  LexicalNode,
  LexicalUpdateJSON,
  NodeKey,
  SerializedElementNode,
  Spread,
} from 'lexical';

import {
  $applyNodeReplacement,
  $isRangeSelection,
  ElementNode,
} from 'lexical';

export type RevisionType = 'insert' | 'delete';

export type RevisionData = {
  authorId: string;
  authorName: string;
  revisionType: RevisionType;
  timestamp: number;
};

export type SerializedRevisionNode = Spread<
  RevisionData,
  SerializedElementNode
>;

const REVISION_ATTR = 'data-lexical-revision';
const REVISION_AUTHOR_TAG_ATTR = 'data-lexical-revision-author-tag';
const REVISION_CONTENT_ATTR = 'data-lexical-revision-content';

function normalizeRevisionType(type: string | null | undefined): RevisionType {
  return type === 'delete' ? 'delete' : 'insert';
}

function getRevisionDataFromElement(element: HTMLElement): RevisionData {
  return {
    authorId: element.getAttribute('data-author-id') || '',
    authorName: element.getAttribute('data-author-name') || '',
    revisionType: normalizeRevisionType(
      element.getAttribute('data-revision-type'),
    ),
    timestamp: Number(element.getAttribute('data-revision-timestamp')) || 0,
  };
}

function applyRevisionAttributes(
  element: HTMLElement,
  data: RevisionData,
): void {
  element.className = `lexical-revision lexical-revision--${data.revisionType}`;
  element.setAttribute(REVISION_ATTR, 'true');
  element.setAttribute('data-author-id', data.authorId);
  element.setAttribute('data-author-name', data.authorName);
  element.setAttribute('data-revision-type', data.revisionType);
  element.setAttribute('data-revision-timestamp', String(data.timestamp));
}

function getRevisionContentElement(element: HTMLElement): HTMLElement {
  return (
    element.querySelector<HTMLElement>(`[${REVISION_CONTENT_ATTR}="true"]`) ||
    element
  );
}

function formatRevisionTimestamp(timestamp: number): string {
  if (!timestamp) {
    return '';
  }
  const date = new Date(timestamp);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${m}-${d} ${hh}:${mm}`;
}

function createRevisionElement(
  data: RevisionData,
  includeAuthorTag: boolean,
): HTMLElement {
  const element = document.createElement('span');
  applyRevisionAttributes(element, data);

  if (includeAuthorTag) {
    const tag = document.createElement('span');
    tag.className = 'lexical-revision__author-tag';
    tag.setAttribute(REVISION_AUTHOR_TAG_ATTR, 'true');
    tag.setAttribute('contenteditable', 'false');
    const timeStr = formatRevisionTimestamp(data.timestamp);
    tag.textContent = `[${data.authorName} ${timeStr}]`;
    element.appendChild(tag);
  }

  const content = document.createElement('span');
  content.className = 'lexical-revision__content';
  content.setAttribute(REVISION_CONTENT_ATTR, 'true');
  element.appendChild(content);

  return element;
}

function $convertRevisionElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  return {
    node: $createRevisionNode(getRevisionDataFromElement(domNode)),
  };
}

export class RevisionNode extends ElementNode {
  __authorId: string;
  __authorName: string;
  __revisionType: RevisionType;
  __timestamp: number;

  static getType(): string {
    return 'revision';
  }

  static clone(node: RevisionNode): RevisionNode {
    return new RevisionNode(node.getRevisionData(), node.__key);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute(REVISION_ATTR)) {
          return null;
        }
        return {
          conversion: $convertRevisionElement,
          priority: 2,
        };
      },
    };
  }

  static importJSON(serializedNode: SerializedRevisionNode): RevisionNode {
    return $createRevisionNode({
      authorId: serializedNode.authorId,
      authorName: serializedNode.authorName,
      revisionType: normalizeRevisionType(serializedNode.revisionType),
      timestamp: serializedNode.timestamp,
    }).updateFromJSON(serializedNode);
  }

  constructor(data: RevisionData, key?: NodeKey) {
    super(key);
    this.__authorId = data.authorId;
    this.__authorName = data.authorName;
    this.__revisionType = data.revisionType;
    this.__timestamp = data.timestamp;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__authorId = prevNode.__authorId;
    this.__authorName = prevNode.__authorName;
    this.__revisionType = prevNode.__revisionType;
    this.__timestamp = prevNode.__timestamp;
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedRevisionNode>,
  ): this {
    return super
      .updateFromJSON(serializedNode)
      .setAuthorId(serializedNode.authorId)
      .setAuthorName(serializedNode.authorName)
      .setRevisionType(normalizeRevisionType(serializedNode.revisionType))
      .setTimestamp(serializedNode.timestamp);
  }

  exportJSON(): SerializedRevisionNode {
    return {
      ...super.exportJSON(),
      authorId: this.getAuthorId(),
      authorName: this.getAuthorName(),
      revisionType: this.getRevisionType(),
      timestamp: this.getTimestamp(),
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return createRevisionElement(this.getRevisionData(), true);
  }

  updateDOM(prevNode: this, element: HTMLElement): boolean {
    if (
      prevNode.__authorId !== this.__authorId ||
      prevNode.__authorName !== this.__authorName ||
      prevNode.__revisionType !== this.__revisionType ||
      prevNode.__timestamp !== this.__timestamp
    ) {
      const data = this.getRevisionData();
      applyRevisionAttributes(element, data);
      const tag = element.querySelector<HTMLElement>(
        `[${REVISION_AUTHOR_TAG_ATTR}="true"]`,
      );
      if (tag !== null) {
        const timeStr = formatRevisionTimestamp(data.timestamp);
        tag.textContent = `[${data.authorName} ${timeStr}]`;
      }
    }
    return false;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    return super.getDOMSlot(element).withElement(
      getRevisionContentElement(element),
    );
  }

  exportDOM(): DOMExportOutput {
    return {
      element: createRevisionElement(this.getRevisionData(), false),
    };
  }

  getRevisionData(): RevisionData {
    const latest = this.getLatest();
    return {
      authorId: latest.__authorId,
      authorName: latest.__authorName,
      revisionType: latest.__revisionType,
      timestamp: latest.__timestamp,
    };
  }

  getAuthorId(): string {
    return this.getLatest().__authorId;
  }

  setAuthorId(authorId: string): this {
    const self = this.getWritable();
    self.__authorId = authorId;
    return self;
  }

  getAuthorName(): string {
    return this.getLatest().__authorName;
  }

  setAuthorName(authorName: string): this {
    const self = this.getWritable();
    self.__authorName = authorName;
    return self;
  }

  getTimestamp(): number {
    return this.getLatest().__timestamp;
  }

  setTimestamp(timestamp: number): this {
    const self = this.getWritable();
    self.__timestamp = timestamp;
    return self;
  }

  getRevisionType(): RevisionType {
    return this.getLatest().__revisionType;
  }

  setRevisionType(revisionType: RevisionType): this {
    const self = this.getWritable();
    self.__revisionType = revisionType;
    return self;
  }

  isInline(): true {
    return true;
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

export function $createRevisionNode(data: RevisionData): RevisionNode {
  return $applyNodeReplacement(new RevisionNode(data));
}

export function $isRevisionNode(
  node: LexicalNode | null | undefined,
): node is RevisionNode {
  return node instanceof RevisionNode;
}
