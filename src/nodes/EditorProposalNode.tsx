/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 */

import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  LexicalUpdateJSON,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import type {JSX} from 'react';

import {DecoratorNode, $applyNodeReplacement, $getNodeByKey} from 'lexical';
import * as React from 'react';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {useMockWorkflow} from '../context/MockWorkflowContext';

export type SerializedEditorProposalNode = Spread<
  {
    content: string;
  },
  SerializedLexicalNode
>;

function EditorProposalComponent({
  nodeKey,
  content,
}: {
  nodeKey: NodeKey;
  content: string;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const {currentUser, displayMode} = useMockWorkflow();
  const [value, setValue] = React.useState(content);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const adjustHeight = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, []);

  React.useEffect(() => {
    setValue(content);
  }, [content]);

  // Adjust textarea height based on content size safely before paint
  React.useLayoutEffect(() => {
    adjustHeight();
    const id = requestAnimationFrame(() => {
      adjustHeight();
    });
    return () => cancelAnimationFrame(id);
  }, [value, adjustHeight]);

  if (displayMode === 'final') {
    return null;
  }

  const isEditor = currentUser.role === 'editor';

  const handleBlur = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isEditorProposalNode(node)) {
        node.setContent(value);
      }
    });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isEditorProposalNode(node)) {
        node.remove();
      }
    });
  };

  return (
    <div className="editorial-proposal-card">
      <div className="editorial-proposal-header">
        <div className="editorial-proposal-header-left">
          <span className="editorial-proposal-icon">🤝</span>
          <span className="editorial-proposal-title">编辑建议</span>
        </div>
        {isEditor && (
          <button
            className="editorial-proposal-delete-btn"
            onClick={handleDelete}
            type="button">
            删除建议
          </button>
        )}
      </div>
      <div className="editorial-proposal-body">
        {isEditor ? (
          <textarea
            ref={textareaRef}
            className="editorial-proposal-textarea"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            placeholder="请输入建议内容..."
            rows={1}
          />
        ) : (
          <div className="editorial-proposal-text-display">
            {value ? (
              value.split('\n').map((line, i) => (
                <p key={i} className="editorial-proposal-p">
                  {line}
                </p>
              ))
            ) : (
              <span className="editorial-proposal-placeholder">无建议内容</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export class EditorProposalNode extends DecoratorNode<JSX.Element> {
  __content: string;

  static getType(): string {
    return 'editor-proposal';
  }

  static clone(node: EditorProposalNode): EditorProposalNode {
    return new EditorProposalNode(node.__content, node.__key);
  }

  static importJSON(
    serializedNode: SerializedEditorProposalNode,
  ): EditorProposalNode {
    return $createEditorProposalNode(serializedNode.content).updateFromJSON(
      serializedNode,
    );
  }

  constructor(content: string, key?: NodeKey) {
    super(key);
    this.__content = content;
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedEditorProposalNode>,
  ): this {
    const node = super.updateFromJSON(serializedNode);
    return node.setContent(serializedNode.content);
  }

  exportJSON(): SerializedEditorProposalNode {
    return {
      ...super.exportJSON(),
      content: this.getContent(),
      type: 'editor-proposal',
      version: 1,
    };
  }

  getContent(): string {
    const latest = this.getLatest();
    return latest.__content;
  }

  setContent(content: string): this {
    const writable = this.getWritable();
    writable.__content = content;
    return writable;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement('div');
    div.className = 'editorial-proposal-wrapper';
    div.setAttribute('contenteditable', 'false');
    return div;
  }

  updateDOM(): false {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (domNode.classList.contains('editorial-proposal-wrapper')) {
          return {
            conversion: (element: HTMLElement) => {
              const content = element.getAttribute('data-content') || '';
              return {node: $createEditorProposalNode(content)};
            },
            priority: 2,
          };
        }
        return null;
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.className = 'editorial-proposal-wrapper';
    element.setAttribute('data-content', this.__content);
    return {element};
  }

  decorate(): JSX.Element {
    return (
      <EditorProposalComponent nodeKey={this.getKey()} content={this.__content} />
    );
  }
}

export function $createEditorProposalNode(content: string): EditorProposalNode {
  return $applyNodeReplacement(new EditorProposalNode(content));
}

export function $isEditorProposalNode(
  node: LexicalNode | null | undefined,
): node is EditorProposalNode {
  return node instanceof EditorProposalNode;
}
