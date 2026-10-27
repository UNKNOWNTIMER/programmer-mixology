"""Run ON THE TARGET COMPUTER. Does not install anything, download models or change settings."""
from __future__ import annotations
import argparse
import ctypes
import json
import os
import platform
import shutil
import subprocess
from pathlib import Path


def run(args):
    try:
        p=subprocess.run(args,capture_output=True,text=True,timeout=12,check=False)
        return {'exit_code':p.returncode,'stdout':p.stdout[:16000],'stderr':p.stderr[:2000]}
    except (OSError,subprocess.TimeoutExpired) as e:
        return {'error':str(e)}


def probe():
    info={'notice':'This reports the computer running this script, not another user device.',
          'os':platform.system(),'release':platform.release(),'arch':platform.machine(),
          'cpu_label':platform.processor(),'logical_cpus':os.cpu_count(),
          'memory':{},'gpu_probes':{},'model_selection':'requires_backend_and_model_benchmark',
          'privacy':'No serial number, IP address, account credentials or uploaded data are collected.'}
    if platform.system()=='Windows':
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_=[('dwLength',ctypes.c_ulong),('dwMemoryLoad',ctypes.c_ulong),
                      ('ullTotalPhys',ctypes.c_ulonglong),('ullAvailPhys',ctypes.c_ulonglong),
                      ('ullTotalPageFile',ctypes.c_ulonglong),('ullAvailPageFile',ctypes.c_ulonglong),
                      ('ullTotalVirtual',ctypes.c_ulonglong),('ullAvailVirtual',ctypes.c_ulonglong),
                      ('ullAvailExtendedVirtual',ctypes.c_ulonglong)]
        mem=MEMORYSTATUSEX();mem.dwLength=ctypes.sizeof(mem)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(mem)):
            info['memory']={'physical_total_bytes':mem.ullTotalPhys,'physical_available_bytes':mem.ullAvailPhys}
        if shutil.which('powershell'):
            info['gpu_probes']['windows_display']=run(['powershell','-NoProfile','-Command',
                'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress'])
    elif Path('/proc/meminfo').exists():
        vals={}
        for line in Path('/proc/meminfo').read_text().splitlines():
            k,rest=line.split(':',1)
            if k in ('MemTotal','MemAvailable'): vals[k]=int(rest.strip().split()[0])*1024
        info['memory']=vals
    elif platform.system()=='Darwin':
        info['memory']['sysctl_total']=run(['sysctl','-n','hw.memsize'])
        info['gpu_probes']['metal_display']=run(['system_profiler','SPDisplaysDataType','-json'])
        info['memory']['note']='Unified memory must not be counted as both RAM and additional VRAM.'
    if shutil.which('nvidia-smi'):
        info['gpu_probes']['nvidia']=run(['nvidia-smi','--query-gpu=name,memory.total,memory.free,driver_version','--format=csv,noheader'])
    if shutil.which('vulkaninfo'):
        info['gpu_probes']['vulkan']=run(['vulkaninfo','--summary'])
    if shutil.which('rocminfo'):
        info['gpu_probes']['rocm']=run(['rocminfo'])
    disk=shutil.disk_usage(Path.cwd())
    info['disk']={'workspace_volume_free_bytes':disk.free}
    info['unknowns']=['True llama.cpp backend execution','Runtime memory overhead','Model JSON quality','Quantized artifact checksums']
    return info

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',default='hardware_report.json');a=p.parse_args()
    Path(a.output).write_text(json.dumps(probe(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Wrote local-device report:',a.output)
