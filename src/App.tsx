/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {
  AutoFocusExtension,
  ClearEditorExtension,
  DecoratorTextExtension,
  SelectionAlwaysOnDisplayExtension,
} from '@lexical/extension';
import {HistoryExtension} from '@lexical/history';
import {
  ClickableLinkExtension,
  LinkExtension,
} from '@lexical/link';
import {
  ListExtension,
} from '@lexical/list';
import {LexicalCollaboration} from '@lexical/react/LexicalCollaborationContext';
import {LexicalExtensionComposer} from '@lexical/react/LexicalExtensionComposer';
import {
  RichTextExtension,
} from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  configExtension,
  defineExtension,
} from 'lexical';
import {type JSX, useMemo} from 'react';

import {buildHTMLConfig} from './buildHTMLConfig';
import {FlashMessageContext} from './context/FlashMessageContext';
import {
  MockWorkflowProvider,
  useMockWorkflow,
} from './context/MockWorkflowContext';
import {SettingsContext} from './context/SettingsContext';
import {ToolbarContext} from './context/ToolbarContext';
import Editor from './Editor';
import PlaygroundNodes from './nodes/PlaygroundNodes';
import PlaygroundEditorTheme from './themes/PlaygroundEditorTheme';
import {validateUrl} from './utils/url';

function $prepopulatedRichText() {
  const root = $getRoot();
  if (root.getFirstChild() === null) {
    const paragraph = $createParagraphNode();
    paragraph.append(
      $createTextNode(
        '这是一个精简版小说编辑器。您可以在这里输入文本，并测试划词批注与修订模式。',
      ),
    );
    root.append(paragraph);
  }
}

// These are only enabled for rich-text mode
const PlaygroundRichTextExtension = defineExtension({
  dependencies: [
    configExtension(RichTextExtension, {
      escapeFormatTriggers: {
        code: {arrow: true, click: true, enter: true, onlyAtBoundary: true},
      },
    }),
    configExtension(ListExtension, {shouldPreserveNumbering: false}),
  ],
  name: '@lexical/playground/RichText',
});

const AppExtension = defineExtension({
  dependencies: [
    AutoFocusExtension,
    ClearEditorExtension,
    DecoratorTextExtension,
    HistoryExtension,
    configExtension(LinkExtension, {validateUrl}),
    ClickableLinkExtension,
    SelectionAlwaysOnDisplayExtension,
  ],
  html: buildHTMLConfig(),
  name: '@lexical/playground',
  namespace: 'Playground',
  nodes: PlaygroundNodes,
  theme: PlaygroundEditorTheme,
});

function WorkflowHeader(): JSX.Element {
  const {currentUser, reviewSession, setRole, users} = useMockWorkflow();

  return (
    <header className="app-header">
      <div className="site-title">小说编辑器</div>
      <div className="workflow-controls" aria-label="Mock 用户身份">
        <span className="workflow-controls-label">身份</span>
        <button
          className={currentUser.role === 'editor' ? 'active' : ''}
          onClick={() => setRole('editor')}
          type="button">
          {users.editor.name}
        </button>
        <button
          className={currentUser.role === 'author' ? 'active' : ''}
          onClick={() => setRole('author')}
          type="button">
          {users.author.name}
        </button>
        <span className="workflow-review-pill">
          {reviewSession === null ? '未修订' : '编辑修订中'}
        </span>
      </div>
    </header>
  );
}

function App(): JSX.Element {
  const app = useMemo(
    () =>
      defineExtension({
        $initialEditorState: $prepopulatedRichText,
        dependencies: [
          AppExtension,
          PlaygroundRichTextExtension,
        ],
        name: '@lexical/playground/dynamic-config',
      }),
    [],
  );

  return (
    <MockWorkflowProvider>
      <LexicalCollaboration>
        <LexicalExtensionComposer extension={app} contentEditable={null}>
          <ToolbarContext>
            <WorkflowHeader />
            <div className="editor-shell">
              <Editor />
            </div>
          </ToolbarContext>
        </LexicalExtensionComposer>
      </LexicalCollaboration>
    </MockWorkflowProvider>
  );
}

export default function PlaygroundApp(): JSX.Element {
  return (
    <SettingsContext>
      <FlashMessageContext>
        <App />
      </FlashMessageContext>
    </SettingsContext>
  );
}
