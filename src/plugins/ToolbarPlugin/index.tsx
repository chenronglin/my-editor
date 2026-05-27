/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import {$isHeadingNode} from '@lexical/rich-text';
import {$findMatchingParent, mergeRegister} from '@lexical/utils';
import {
  $addUpdateTag,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  CommandPayloadType,
  FORMAT_TEXT_COMMAND,
  LexicalCommand,
  LexicalEditor,
  LexicalNode,
  SELECTION_CHANGE_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  TextFormatType,
} from 'lexical';
import {Dispatch, useCallback, useEffect, useState} from 'react';

import {
  blockTypeToBlockName,
  useToolbarState,
} from '../../context/ToolbarContext';
import DropDown, {DropDownItem} from '../../ui/DropDown';
import {isKeyboardInput} from '../../utils/focusUtils';
import {formatHeading, formatParagraph} from './utils';

type BasicBlockType = 'paragraph' | 'h1' | 'h2' | 'h3';

const BASIC_BLOCK_TYPES = new Set(['paragraph', 'h1', 'h2', 'h3']);

function getBasicBlockType(type: string): BasicBlockType {
  return BASIC_BLOCK_TYPES.has(type) ? (type as BasicBlockType) : 'paragraph';
}

function dropDownActiveClass(active: boolean) {
  if (active) {
    return 'active dropdown-item-active';
  } else {
    return '';
  }
}

function BlockFormatDropDown({
  editor,
  blockType,
  disabled = false,
}: {
  blockType: BasicBlockType;
  editor: LexicalEditor;
  disabled?: boolean;
}): JSX.Element {
  return (
    <DropDown
      disabled={disabled}
      buttonClassName="toolbar-item block-controls"
      buttonIconClassName={'icon block-type ' + blockType}
      buttonLabel={blockTypeToBlockName[blockType] || '正文'}
      buttonAriaLabel="选择段落格式">
      <DropDownItem
        className={
          'item wide ' + dropDownActiveClass(blockType === 'paragraph')
        }
        onClick={() => formatParagraph(editor)}>
        <div className="icon-text-container">
          <i className="icon paragraph" />
          <span className="text">正文</span>
        </div>
      </DropDownItem>
      <DropDownItem
        className={'item wide ' + dropDownActiveClass(blockType === 'h1')}
        onClick={() => formatHeading(editor, blockType, 'h1')}>
        <div className="icon-text-container">
          <i className="icon h1" />
          <span className="text">一级标题</span>
        </div>
      </DropDownItem>
      <DropDownItem
        className={'item wide ' + dropDownActiveClass(blockType === 'h2')}
        onClick={() => formatHeading(editor, blockType, 'h2')}>
        <div className="icon-text-container">
          <i className="icon h2" />
          <span className="text">二级标题</span>
        </div>
      </DropDownItem>
      <DropDownItem
        className={'item wide ' + dropDownActiveClass(blockType === 'h3')}
        onClick={() => formatHeading(editor, blockType, 'h3')}>
        <div className="icon-text-container">
          <i className="icon h3" />
          <span className="text">三级标题</span>
        </div>
      </DropDownItem>
    </DropDown>
  );
}

function Divider(): JSX.Element {
  return <div className="divider" />;
}

function $findTopLevelElement(node: LexicalNode) {
  let topLevelElement =
    node.getKey() === 'root'
      ? node
      : $findMatchingParent(node, e => {
          const parent = e.getParent();
          return parent !== null && parent.getKey() === 'root';
        });

  if (topLevelElement === null) {
    topLevelElement = node.getTopLevelElementOrThrow();
  }
  return topLevelElement;
}

export default function ToolbarPlugin({
  editor,
  activeEditor,
  canToggleTrackChanges,
  setActiveEditor,
  isReviewActive,
  isTrackChangesEnabled,
  onToggleTrackChanges,
}: {
  editor: LexicalEditor;
  activeEditor: LexicalEditor;
  canToggleTrackChanges: boolean;
  isReviewActive: boolean;
  isTrackChangesEnabled: boolean;
  onToggleTrackChanges: () => void;
  setActiveEditor: Dispatch<LexicalEditor>;
}): JSX.Element {
  const [isEditable, setIsEditable] = useState(() => editor.isEditable());
  const {toolbarState, updateToolbarState} = useToolbarState();

  const dispatchToolbarCommand = <T extends LexicalCommand<unknown>>(
    command: T,
    payload: CommandPayloadType<T> | undefined = undefined,
    skipRefocus: boolean = false,
  ) => {
    activeEditor.update(() => {
      if (skipRefocus) {
        $addUpdateTag(SKIP_DOM_SELECTION_TAG);
      }
      activeEditor.dispatchCommand(command, payload as CommandPayloadType<T>);
    });
  };

  const dispatchFormatTextCommand = (
    payload: TextFormatType,
    skipRefocus: boolean = false,
  ) => dispatchToolbarCommand(FORMAT_TEXT_COMMAND, payload, skipRefocus);

  const $handleHeadingNode = useCallback(
    (selectedElement: LexicalNode) => {
      const type = $isHeadingNode(selectedElement)
        ? selectedElement.getTag()
        : selectedElement.getType();

      updateToolbarState('blockType', getBasicBlockType(type));
    },
    [updateToolbarState],
  );

  const $updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode();
      const element = $findTopLevelElement(anchorNode);

      $handleHeadingNode(element);
    }
    if ($isRangeSelection(selection)) {
      // Update text format
      updateToolbarState('isBold', selection.hasFormat('bold'));
      updateToolbarState('isItalic', selection.hasFormat('italic'));
      updateToolbarState('isUnderline', selection.hasFormat('underline'));
      updateToolbarState(
        'isStrikethrough',
        selection.hasFormat('strikethrough'),
      );
    }
  }, [
    updateToolbarState,
    $handleHeadingNode,
  ]);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      (_payload, newEditor) => {
        setActiveEditor(newEditor);
        $updateToolbar();
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor, $updateToolbar, setActiveEditor]);

  useEffect(() => {
    activeEditor.getEditorState().read(
      () => {
        $updateToolbar();
      },
      {editor: activeEditor},
    );
  }, [activeEditor, $updateToolbar]);

  useEffect(() => {
    return mergeRegister(
      editor.registerEditableListener(editable => {
        setIsEditable(editable);
      }),
      activeEditor.registerUpdateListener(({editorState}) => {
        editorState.read(
          () => {
            $updateToolbar();
          },
          {editor: activeEditor},
        );
      }),
    );
  }, [$updateToolbar, activeEditor, editor]);

  return (
    <div className="toolbar">
      {activeEditor === editor && (
        <>
          <BlockFormatDropDown
            disabled={!isEditable}
            blockType={getBasicBlockType(toolbarState.blockType)}
            editor={activeEditor}
          />
          <Divider />
        </>
      )}
      <>
        <button
          disabled={!isEditable}
          onClick={e => dispatchFormatTextCommand('bold', isKeyboardInput(e))}
          className={
            'toolbar-item spaced ' + (toolbarState.isBold ? 'active' : '')
          }
          title="加粗（Cmd+B）"
          type="button"
          aria-label="加粗">
          <i className="format bold" />
        </button>
        <button
          disabled={!isEditable}
          onClick={e =>
            dispatchFormatTextCommand('italic', isKeyboardInput(e))
          }
          className={
            'toolbar-item spaced ' + (toolbarState.isItalic ? 'active' : '')
          }
          title="斜体（Cmd+I）"
          type="button"
          aria-label="斜体">
          <i className="format italic" />
        </button>
        <button
          disabled={!isEditable}
          onClick={e =>
            dispatchFormatTextCommand('underline', isKeyboardInput(e))
          }
          className={
            'toolbar-item spaced ' +
            (toolbarState.isUnderline ? 'active' : '')
          }
          title="下划线（Cmd+U）"
          type="button"
          aria-label="下划线">
          <i className="format underline" />
        </button>
        <button
          disabled={!isEditable}
          onClick={e =>
            dispatchFormatTextCommand('strikethrough', isKeyboardInput(e))
          }
          className={
            'toolbar-item spaced ' +
            (toolbarState.isStrikethrough ? 'active' : '')
          }
          title="删除线"
          type="button"
          aria-label="删除线">
          <i className="format strikethrough" />
        </button>
      </>
      <Divider />
      <button
        disabled={!canToggleTrackChanges}
        onClick={onToggleTrackChanges}
        className={
          'toolbar-item spaced track-changes ' +
          (isReviewActive ? 'active' : '')
        }
        title={
          !canToggleTrackChanges && isReviewActive
            ? '编辑正在修订'
            : isReviewActive
              ? '结束修订模式'
              : '开启修订模式'
        }
        type="button"
        aria-pressed={isReviewActive}
        aria-label="切换修订模式">
        {isReviewActive
          ? isTrackChangesEnabled
            ? '结束修订'
            : '修订中'
          : '开启修订'}
      </button>
    </div>
  );
}
