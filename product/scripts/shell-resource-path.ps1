# Read-only physical file resolution for resources consumed outside a packaged
# launcher. Resolve-Path expands the name but can leave MSIX LocalAppData aliases.
function Get-PixelMixShellResourcePath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    if (-not ('PixelMix.ShellResourcePath' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace PixelMix {
    public static class ShellResourcePath {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint length, uint flags);
    }
}
'@
    }
    $pixelStream = [IO.File]::Open($LiteralPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    try {
        $pixelBuffer = [Text.StringBuilder]::new(32768)
        $pixelLength = [PixelMix.ShellResourcePath]::GetFinalPathNameByHandle($pixelStream.SafeFileHandle, $pixelBuffer, 32768, 0)
        if ($pixelLength -eq 0 -or $pixelLength -ge 32768) { throw 'Cannot resolve the physical Shell resource path' }
        $pixelPhysicalPath = $pixelBuffer.ToString()
        if ($pixelPhysicalPath.StartsWith('\\?\')) { $pixelPhysicalPath = $pixelPhysicalPath.Substring(4) }
        if ($pixelPhysicalPath -notmatch '^[A-Za-z]:\\' -or $pixelPhysicalPath -match '[\x00-\x1f]') { throw 'Shell resource must resolve to a local disk file' }
        return $pixelPhysicalPath
    } finally { $pixelStream.Dispose() }
}
