/** Main-workbench file shortcuts leave editing and deliberate text copying alone. */
export function archiveShortcut(event:Pick<KeyboardEvent,'key'|'ctrlKey'|'altKey'|'metaKey'|'shiftKey'|'repeat'|'isComposing'|'defaultPrevented'>,editing:boolean,selectedText:boolean):'copy'|'paste'|null {
  if(editing||event.defaultPrevented||event.repeat||event.isComposing||!event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return null;
  const key=event.key.toLowerCase();
  if(key==='c'&&!selectedText)return 'copy';
  if(key==='v')return 'paste';
  return null;
}
