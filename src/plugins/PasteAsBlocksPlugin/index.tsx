import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
} from 'lexical';
import {useEffect} from 'react';

function splitPastedLines(text: string): Array<string> {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function hasLineBreak(text: string): boolean {
  return /\r\n?|\n/.test(text);
}

export default function PasteAsBlocksPlugin({
  disabled,
}: {
  disabled: boolean;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (disabled || !(event instanceof ClipboardEvent)) {
          return false;
        }
        const text = event.clipboardData?.getData('text/plain') || '';
        if (text === '' || !hasLineBreak(text)) {
          return false;
        }
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }
        event.preventDefault();
        const paragraphs = splitPastedLines(text).map(line => {
          const paragraph = $createParagraphNode();
          if (line !== '') {
            paragraph.append($createTextNode(line));
          }
          return paragraph;
        });
        selection.insertNodes(paragraphs);
        paragraphs[paragraphs.length - 1]?.selectEnd();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [disabled, editor]);

  return null;
}
