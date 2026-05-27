/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import {
  type Signal,
} from '@lexical/extension';
import {
  ClickableLinkExtension,
  LinkAttributes,
  LinkExtension,
} from '@lexical/link';
import {ListExtension} from '@lexical/list';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {useOptionalExtensionDependency} from '@lexical/react/useExtensionComponent';
import {useLexicalEditable} from '@lexical/react/useLexicalEditable';
import {CAN_USE_DOM} from '@lexical/utils';
import {OutputExtension} from 'lexical';
import {useEffect, useState} from 'react';

import {useSettings} from './context/SettingsContext';
import {useMockWorkflow} from './context/MockWorkflowContext';
import CommentPlugin from './plugins/CommentPlugin';
import FloatingLinkEditorPlugin from './plugins/FloatingLinkEditorPlugin';
import FloatingTextFormatToolbarPlugin from './plugins/FloatingTextFormatToolbarPlugin';
import ToolbarPlugin from './plugins/ToolbarPlugin';
import TrackChangesPlugin from './plugins/TrackChangesPlugin';
import ContentEditable from './ui/ContentEditable';

export function useSyncExtensionSignal<
  K extends string,
  V,
  Output extends {[Key in K]: Signal<V>},
>(extension: OutputExtension<Output>, prop: K, value: V) {
  const signal = useOptionalExtensionDependency(extension)?.output[prop];
  useEffect(() => {
    if (signal) {
      // eslint-disable-next-line react-hooks/immutability
      signal.value = value;
    }
  }, [signal, value]);
}

const DEFAULT_LINK_ATTRIBUTES: LinkAttributes = {
  rel: 'noopener noreferrer',
  target: '_blank',
};

function WorkflowStatusBar(): JSX.Element {
  const {currentUser, permissions, reviewSession} = useMockWorkflow();

  if (reviewSession !== null && currentUser.role === 'author') {
    return (
      <div className="workflow-status warning">
        编辑正在修订，正文暂不可编辑；你仍然可以阅读修订并回复批注。
      </div>
    );
  }

  if (reviewSession !== null) {
    return (
      <div className="workflow-status active">
        修订模式已开启。新增和删除会写入文档结构，不再生成独立修订记录区。
      </div>
    );
  }

  if (!permissions.canEditContent && currentUser.role === 'editor') {
    return (
      <div className="workflow-status">
        点击工具栏“开启修订”后，编辑可修改正文，作者端会自动只读。
      </div>
    );
  }

  return (
    <div className="workflow-status">
      当前为作者草稿编辑状态；编辑开启修订后会锁定正文。
    </div>
  );
}

export default function Editor(): JSX.Element {
  const {
    settings: {
      hasLinkAttributes,
      listStrictIndent,
    },
  } = useSettings();
  const isEditable = useLexicalEditable();
  const placeholder = '请输入正文...';
  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement | null>(null);
  const [isSmallWidthViewport, setIsSmallWidthViewport] =
    useState<boolean>(false);
  const [editor] = useLexicalComposerContext();
  const [activeEditor, setActiveEditor] = useState(editor);
  const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);
  const {
    currentUser,
    permissions,
    reviewSession,
    startReview,
    stopReview,
  } = useMockWorkflow();
  const isReviewActive = reviewSession !== null;
  const isTrackChangesEnabled =
    isReviewActive && currentUser.role === 'editor' && permissions.canEditContent;

  const onRef = (_floatingAnchorElem: HTMLDivElement) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem);
    }
  };

  useSyncExtensionSignal(
    LinkExtension,
    'attributes',
    hasLinkAttributes ? DEFAULT_LINK_ATTRIBUTES : undefined,
  );
  useSyncExtensionSignal(ListExtension, 'hasStrictIndent', listStrictIndent);
  useSyncExtensionSignal(ClickableLinkExtension, 'disabled', isEditable);

  useEffect(() => {
    editor.setEditable(permissions.canEditContent);
  }, [editor, permissions.canEditContent]);

  useEffect(() => {
    const updateViewPortWidth = () => {
      const isNextSmallWidthViewport =
        CAN_USE_DOM && window.matchMedia('(max-width: 1025px)').matches;

      if (isNextSmallWidthViewport !== isSmallWidthViewport) {
        setIsSmallWidthViewport(isNextSmallWidthViewport);
      }
    };
    updateViewPortWidth();
    window.addEventListener('resize', updateViewPortWidth);

    return () => {
      window.removeEventListener('resize', updateViewPortWidth);
    };
  }, [isSmallWidthViewport]);

  return (
    <>
      <ToolbarPlugin
        editor={editor}
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}
        isTrackChangesEnabled={isTrackChangesEnabled}
        isReviewActive={isReviewActive}
        canToggleTrackChanges={
          permissions.canStartReview || permissions.canStopReview
        }
        onToggleTrackChanges={() => {
          if (permissions.canStopReview) {
            stopReview();
          } else {
            startReview();
          }
        }}
      />
      <WorkflowStatusBar />
      <div className="editor-container">
        <CommentPlugin
          authorName={currentUser.name}
          canCreateComment={permissions.canCreateComment}
          canReplyComment={permissions.canReplyComment}
        />
        <TrackChangesPlugin
          isEnabled={isTrackChangesEnabled}
          authorName={currentUser.name}
        />
        <div className="editor-scroller">
          <div className="editor" ref={onRef}>
            <ContentEditable placeholder={placeholder} />
          </div>
        </div>
        {floatingAnchorElem && (
          <FloatingLinkEditorPlugin
            anchorElem={floatingAnchorElem}
            isLinkEditMode={isLinkEditMode}
            setIsLinkEditMode={setIsLinkEditMode}
          />
        )}
        {floatingAnchorElem && !isSmallWidthViewport && (
          <FloatingTextFormatToolbarPlugin
            anchorElem={floatingAnchorElem}
          />
        )}
      </div>
    </>
  );
}
