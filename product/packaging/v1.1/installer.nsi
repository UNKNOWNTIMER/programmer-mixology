Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh
!include x64.nsh
!include WordFunc.nsh
!include "${BUILD_DIR}\payload.nsh"

Name "程序员调酒台 V1.2"
Caption "程序员调酒台 V1.2"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\PIXEL MIX"
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"
VIProductVersion "1.2.0.0"
VIAddVersionKey "ProductName" "程序员调酒台"
VIAddVersionKey "FileDescription" "程序员调酒台 V1.2 安装程序"
VIAddVersionKey "CompanyName" "UNKNOWNTIMER"
VIAddVersionKey "LegalCopyright" "UNKNOWNTIMER"
VIAddVersionKey "FileVersion" "1.2.0"
VIAddVersionKey "ProductVersion" "1.2.0"
BrandingText " "
ShowInstDetails nevershow
ShowUninstDetails nevershow
AutoCloseWindow false
WindowIcon on
XPStyle off
InstProgressFlags smooth colored
InstallColors B3CCD3 03090D

Var Dialog
Var Label
Var Location
Var Browse
Var Launch
Var Isolated
Var UninstallKey
Var Parameters
Var OldExe

Page custom Welcome WelcomeLeave
Page instfiles InstallPage InstallShow
Page custom Finish FinishLeave
UninstPage custom un.Welcome
UninstPage instfiles un.InstallPage un.InstallShow

!macro InitSkin
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=TimerInstallerSkin.dll "${SKIN_DLL}"
  File /oname=pixel.woff2 "${PIXEL_FONT}"
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::LoadPixelFont(w "$PLUGINSDIR\pixel.woff2") i .r0'
!macroend

Function .onInit
  SetShellVarContext current
  SetRegView 64
  StrCpy $Isolated 0
  StrCpy $UninstallKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIXEL MIX"
  ${GetParameters} $Parameters
  ${GetOptions} $Parameters "/ISOLATED=" $0
  ${If} $0 == "1"
    StrCpy $Isolated 1
    StrCpy $UninstallKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\TIMER-V11-TEST"
  ${EndIf}
  ReadRegStr $1 HKCU "$UninstallKey" "InstallLocation"
  ReadRegStr $2 HKCU "$UninstallKey" "DisplayVersion"
  ${If} $1 == $INSTDIR
  ${AndIf} $2 != ""
    ${VersionCompare} $2 "1.2.0" $3
    ${If} $3 == 1
      MessageBox MB_ICONSTOP "已安装更新版本。" /SD IDOK
      SetErrorLevel 22
      Abort
    ${EndIf}
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "需要 Windows 10/11 x64。" /SD IDOK
    SetErrorLevel 20
    Abort
  ${EndIf}
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
    MessageBox MB_ICONSTOP "请先安装 Microsoft Edge WebView2 Runtime。" /SD IDOK
    SetErrorLevel 21
    Abort
  ${EndIf}
  !insertmacro InitSkin
FunctionEnd

Function .onGUIInit
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::Attach(p $HWNDPARENT)'
FunctionEnd

Function Welcome
  nsDialogs::Create 1018
  Pop $Dialog
  SetCtlColors $Dialog B3CCD3 03090D
  ${NSD_CreateLabel} 0 8u 100% 20u "安装位置"
  Pop $Label
  SetCtlColors $Label B3CCD3 03090D
  ${NSD_CreateText} 0 39u 100% 34u "$INSTDIR"
  Pop $Location
  SetCtlColors $Location B3CCD3 081319
  ${NSD_CreateButton} 0 86u 62u 19u "更改"
  Pop $Browse
  ${NSD_OnClick} $Browse ChooseDirectory
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:安装"
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::SetPhase(i 0)'
  nsDialogs::Show
FunctionEnd

Function ChooseDirectory
  nsDialogs::SelectFolderDialog "安装位置" "$INSTDIR"
  Pop $0
  ${If} $0 != "error"
    StrCpy $INSTDIR $0
    ${NSD_SetText} $Location $INSTDIR
  ${EndIf}
FunctionEnd

Function WelcomeLeave
  ${NSD_GetText} $Location $INSTDIR
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::CheckTarget(w "$INSTDIR") i .r0'
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "请关闭此位置的调酒台，或更换安装位置。"
    Abort
  ${EndIf}
FunctionEnd

Function InstallPage
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::SetPhase(i 1)'
FunctionEnd
Function InstallShow
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::Refresh()'
FunctionEnd

Function Finish
  nsDialogs::Create 1018
  Pop $Dialog
  SetCtlColors $Dialog B3CCD3 03090D
  ${NSD_CreateLabel} 0 8u 100% 24u "安装完成"
  Pop $Label
  SetCtlColors $Label B3CCD3 03090D
  ${NSD_CreateCheckbox} 0 51u 100% 18u "打开调酒台"
  Pop $Launch
  SetCtlColors $Launch B3CCD3 03090D
  ${NSD_Check} $Launch
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:完成"
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::SetPhase(i 2)'
  nsDialogs::Show
FunctionEnd
Function FinishLeave
  ${NSD_GetState} $Launch $0
  ${If} $0 == ${BST_CHECKED}
    Exec '"$INSTDIR\pixel-mix.exe"'
  ${EndIf}
FunctionEnd

Section "TIMER" Main
  !ifdef PREVIEW_ONLY
    MessageBox MB_OK "安装界面预览：不会安装文件。" /SD IDOK
    SetErrorLevel 99
    Quit
  !endif
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::CheckTarget(w "$INSTDIR") i .r0'
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "请关闭此位置的调酒台，或更换安装位置。" /SD IDOK
    SetErrorLevel 32
    Abort
  ${EndIf}
  SetOutPath "$PLUGINSDIR"
  File /oname=payload.exe "${PAYLOAD}"
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::VerifyPayload(w "$PLUGINSDIR\payload.exe", w "${PAYLOAD_SHA256}") i .r0'
  ${If} $0 != 1
    MessageBox MB_ICONSTOP "安装文件校验失败。" /SD IDOK
    SetErrorLevel 23
    Abort
  ${EndIf}
  CreateDirectory "$INSTDIR"
  IfFileExists "$INSTDIR\.timer-update.exe" Collision
  IfFileExists "$INSTDIR\.timer-previous.exe" Collision
  ClearErrors
  CopyFiles /SILENT "$PLUGINSDIR\payload.exe" "$INSTDIR\.timer-update.exe"
  IfErrors InstallFailed
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::VerifyPayload(w "$INSTDIR\.timer-update.exe", w "${PAYLOAD_SHA256}") i .r0'
  ${If} $0 != 1
    Delete "$INSTDIR\.timer-update.exe"
    SetErrorLevel 23
    Abort
  ${EndIf}
  StrCpy $OldExe 0
  IfFileExists "$INSTDIR\pixel-mix.exe" 0 +5
    ClearErrors
    Rename "$INSTDIR\pixel-mix.exe" "$INSTDIR\.timer-previous.exe"
    IfErrors InstallFailed
    StrCpy $OldExe 1
  ClearErrors
  Rename "$INSTDIR\.timer-update.exe" "$INSTDIR\pixel-mix.exe"
  IfErrors Rollback
  ClearErrors
  SetOutPath "$INSTDIR"
  File /oname=TIMER.ico "${APP_ICON}"
  File /oname=install-manifest.json "${BUILD_DIR}\install-manifest.json"
  !include "${BUILD_DIR}\install-resources.nsh"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  IfErrors Rollback
  WriteINIStr "$INSTDIR\timer-install.ini" "TIMER" "Owner" "local.pixelmix.workbench/1.1"
  WriteINIStr "$INSTDIR\timer-install.ini" "TIMER" "Isolated" "$Isolated"
  WriteRegStr HKCU "$UninstallKey" "DisplayName" "程序员调酒台"
  WriteRegStr HKCU "$UninstallKey" "DisplayVersion" "1.2.0"
  WriteRegStr HKCU "$UninstallKey" "Publisher" "UNKNOWNTIMER"
  WriteRegStr HKCU "$UninstallKey" "URLInfoAbout" "https://github.com/UNKNOWNTIMER/programmer-mixology"
  WriteRegStr HKCU "$UninstallKey" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "$UninstallKey" "DisplayIcon" "$INSTDIR\TIMER.ico"
  WriteRegStr HKCU "$UninstallKey" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "$UninstallKey" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "$UninstallKey" "EstimatedSize" ${ESTIMATED_KIB}
  WriteRegDWORD HKCU "$UninstallKey" "NoModify" 1
  WriteRegDWORD HKCU "$UninstallKey" "NoRepair" 1
  ${If} $Isolated == 0
    ; Remove only old-brand shortcuts owned by this exact installation.
    System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::RemoveShortcutIfOwned(w "$DESKTOP\TIMER调酒台.lnk", w "$INSTDIR\pixel-mix.exe") i .r0'
    System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::RemoveShortcutIfOwned(w "$SMPROGRAMS\TIMER调酒台\TIMER调酒台.lnk", w "$INSTDIR\pixel-mix.exe") i .r0'
    RMDir "$SMPROGRAMS\TIMER调酒台"
    CreateShortCut "$DESKTOP\程序员调酒台.lnk" "$INSTDIR\pixel-mix.exe" "" "$INSTDIR\TIMER.ico" 0 SW_SHOWNORMAL "" "程序员调酒台"
    CreateDirectory "$SMPROGRAMS\程序员调酒台"
    CreateShortCut "$SMPROGRAMS\程序员调酒台\程序员调酒台.lnk" "$INSTDIR\pixel-mix.exe" "" "$INSTDIR\TIMER.ico" 0
  ${EndIf}
  IfErrors MetadataFailed
  Delete "$INSTDIR\.timer-previous.exe"
  SetErrorLevel 0
  Goto Done
Collision:
  MessageBox MB_ICONSTOP "安装位置存在待处理的更新文件。请更换位置。" /SD IDOK
  SetErrorLevel 24
  Abort
Rollback:
  Delete "$INSTDIR\pixel-mix.exe"
  ${If} $OldExe == 1
    Rename "$INSTDIR\.timer-previous.exe" "$INSTDIR\pixel-mix.exe"
  ${EndIf}
InstallFailed:
  Delete "$INSTDIR\.timer-update.exe"
  MessageBox MB_ICONSTOP "安装失败。请检查位置权限与占用。" /SD IDOK
  SetErrorLevel 25
  Abort
MetadataFailed:
  Delete "$INSTDIR\.timer-previous.exe"
  MessageBox MB_ICONSTOP "程序已写入，快捷方式或安装记录未完成。请重新运行安装器。" /SD IDOK
  SetErrorLevel 26
  Abort
Done:
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  ReadINIStr $0 "$INSTDIR\timer-install.ini" "TIMER" "Owner"
  ${If} $0 != "local.pixelmix.workbench/1.1"
    SetErrorLevel 31
    Abort
  ${EndIf}
  ReadINIStr $Isolated "$INSTDIR\timer-install.ini" "TIMER" "Isolated"
  StrCpy $UninstallKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\PIXEL MIX"
  ${If} $Isolated == 1
    StrCpy $UninstallKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\TIMER-V11-TEST"
  ${EndIf}
  !insertmacro InitSkin
FunctionEnd
Function un.onGUIInit
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::Attach(p $HWNDPARENT)'
FunctionEnd
Function un.Welcome
  nsDialogs::Create 1018
  Pop $Dialog
  SetCtlColors $Dialog B3CCD3 03090D
  ${NSD_CreateLabel} 0 8u 100% 24u "卸载调酒台"
  Pop $Label
  SetCtlColors $Label B3CCD3 03090D
  ${NSD_CreateLabel} 0 47u 100% 25u "保留酒谱、队列与设置"
  Pop $Label
  SetCtlColors $Label B3CCD3 03090D
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:卸载"
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::SetPhase(i 3)'
  nsDialogs::Show
FunctionEnd
Function un.InstallPage
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::SetPhase(i 4)'
FunctionEnd
Function un.InstallShow
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::Refresh()'
FunctionEnd
Section "Uninstall"
  System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::CheckTarget(w "$INSTDIR") i .r0'
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "请先关闭调酒台。" /SD IDOK
    SetErrorLevel 32
    Abort
  ${EndIf}
  Delete "$INSTDIR\pixel-mix.exe"
  IfErrors UninstallFailed
  Delete "$INSTDIR\TIMER.ico"
  Delete "$INSTDIR\install-manifest.json"
  Delete "$INSTDIR\timer-install.ini"
  !include "${BUILD_DIR}\uninstall-resources.nsh"
  ${If} $Isolated == 0
    System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::RemoveShortcutIfOwned(w "$DESKTOP\程序员调酒台.lnk", w "$INSTDIR\pixel-mix.exe") i .r0'
    System::Call '$PLUGINSDIR\TimerInstallerSkin.dll::RemoveShortcutIfOwned(w "$SMPROGRAMS\程序员调酒台\程序员调酒台.lnk", w "$INSTDIR\pixel-mix.exe") i .r0'
    RMDir "$SMPROGRAMS\程序员调酒台"
  ${EndIf}
  ReadRegStr $0 HKCU "$UninstallKey" "InstallLocation"
  ${If} $0 == "$INSTDIR"
    DeleteRegKey HKCU "$UninstallKey"
  ${EndIf}
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  SetErrorLevel 0
  Goto UninstallDone
UninstallFailed:
  MessageBox MB_ICONSTOP "卸载失败。请关闭调酒台后重试。" /SD IDOK
  SetErrorLevel 33
  Abort
UninstallDone:
SectionEnd
