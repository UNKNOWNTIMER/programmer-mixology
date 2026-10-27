import {describe,it,expect} from 'vitest';
import {archiveShortcut} from './archive-shortcuts';
const event={key:'c',ctrlKey:true,altKey:false,metaKey:false,shiftKey:false,repeat:false,isComposing:false,defaultPrevented:false};
describe('workbench file shortcuts',()=>{
  it('copies a file and pastes files only on deliberate Ctrl+C/V',()=>{expect(archiveShortcut(event,false,false)).toBe('copy');expect(archiveShortcut({...event,key:'V'},false,false)).toBe('paste');expect(archiveShortcut({...event,key:'x'},false,false)).toBeNull();});
  it('does not hijack editing, selected text, modifiers, IME, repeated or handled keys',()=>{expect(archiveShortcut(event,true,false)).toBeNull();expect(archiveShortcut(event,false,true)).toBeNull();for(const delta of [{ctrlKey:false},{altKey:true},{metaKey:true},{shiftKey:true},{repeat:true},{isComposing:true},{defaultPrevented:true}])expect(archiveShortcut({...event,...delta},false,false)).toBeNull();});
});
