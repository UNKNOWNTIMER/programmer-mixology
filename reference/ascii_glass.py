"""Deterministic, offline ASCII source for a pixel renderer. No generated HTML or image model."""
from __future__ import annotations
import json
from pathlib import Path

TEMPLATES={
'highball': ['     __________     ','    |          |    ','    |          |    ','    |          |    ','    |          |    ','    |          |    ','    |__________|    '],
'rocks': ['    ____________    ','   |            |   ','   |            |   ','   |            |   ','   |____________|   '],
'martini': ['  ________________  ','   \\            /   ','    \\          /    ','     \\        /     ','      \\______/      ','         ||         ','         ||         ','      ___||___      '],
'coupe': ['   ______________   ','   \\            /   ','    \\__________/    ','         ||         ','         ||         ','      ___||___      '],
'flute': ['       ______       ','      |      |      ','      |      |      ','      |      |      ','       \\____/       ','         ||         ','         ||         ','       __||__       '],
'hurricane': ['      ________      ','     /        \\     ','     \\        /     ','      |      |      ','     /        \\     ','     \\________/     ','         ||         ','      ___||___      '],
'mug': ['    __________      ','   |          |__   ','   |          |  |  ','   |          |__|  ','   |__________|     '],
'goblet': ['     __________     ','    /          \\    ','    \\          /    ','     \\________/     ','         ||         ','      ___||___      ']}

def render(template: str, liquid: bool=True) -> str:
    if template not in TEMPLATES: raise ValueError('Unknown glass template.')
    out=[]
    for row in TEMPLATES[template]:
        # Mark interior spaces only between the first two enclosing glass walls.
        line=list(row)
        if liquid:
            start=next((i for i,c in enumerate(row) if c in '|/\\'),None)
            end=next((i for i in range((start or 0)+1,len(row)) if row[i] in '|/\\'),None)
            if start is not None and end is not None and end-start>3:
                for i in range(start+1,end):
                    if row[i]==' ': line[i]='.' if i%3 else ':'
        out.append(''.join(line).rstrip())
    return '\n'.join(out)

if __name__=='__main__':
    for key in TEMPLATES:
        print(key+'\n'+render(key)+'\n')
