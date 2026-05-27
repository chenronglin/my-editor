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
  const [isTrackChangesEnabled, setIsTrackChangesEnabled] =
    useState<boolean>(false);

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
      />
      <div className="editor-container">
        <CommentPlugin />
        <TrackChangesPlugin
          isEnabled={isTrackChangesEnabled}
          setIsEnabled={setIsTrackChangesEnabled}
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
