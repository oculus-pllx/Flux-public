; ============================================================
; Flux Agent Windows Installer
; NSIS 3.x script
; Build: makensis flux-agent-setup.nsi
;        (or via Docker — see README-build.md)
; ============================================================

!define APP_NAME        "Flux Agent"
!define APP_VERSION     "1.0.0"
!define APP_PUBLISHER   "Parallax Group"
!define APP_URL         "https://github.com/oculus-pllx/Flux-public"
!define SERVICE_NAME    "FluxAgent"
!define SERVICE_DISPLAY "Flux Agent"
!define REG_UNINSTALL   "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SERVICE_NAME}"
!define REG_NODE        "SOFTWARE\Node.js"

Name            "${APP_NAME} ${APP_VERSION}"
OutFile         "flux-agent-setup.exe"
InstallDir      "$PROGRAMFILES64\Flux Agent"
InstallDirRegKey HKLM "Software\${APP_NAME}" "InstallDir"
RequestExecutionLevel admin
SetCompressor   /SOLID lzma
BrandingText    "Parallax Group · Flux Agent ${APP_VERSION}"

; ── Modern UI ────────────────────────────────────────────────
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var FluxUrl
Var EnrollToken
Var NodePath
Var DialogHandle

; ── Pages ─────────────────────────────────────────────────────
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom EnrollmentPage EnrollmentPageLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start Flux Agent service now"
!define MUI_FINISHPAGE_RUN_FUNCTION "StartFluxService"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── Custom enrollment page ────────────────────────────────────
Function EnrollmentPage
  nsDialogs::Create 1018
  Pop $DialogHandle

  ${NSD_CreateLabel} 0 0 100% 12u "Flux Server URL (e.g. http://192.168.1.10:5174):"
  Pop $0
  ${NSD_CreateText} 0 14u 100% 14u ""
  Pop $FluxUrl

  ${NSD_CreateLabel} 0 34u 100% 12u "Enrollment Token (from Flux → Machines → Enroll):"
  Pop $0
  ${NSD_CreateText} 0 48u 100% 14u ""
  Pop $EnrollToken

  ${NSD_CreateLabel} 0 70u 100% 24u "Both values are required. Generate the enrollment token in the Flux dashboard before running this installer."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function EnrollmentPageLeave
  ${NSD_GetText} $FluxUrl $FluxUrl
  ${NSD_GetText} $EnrollToken $EnrollToken

  StrLen $0 $FluxUrl
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Please enter the Flux Server URL."
    Abort
  ${EndIf}

  StrLen $0 $EnrollToken
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Please enter the enrollment token."
    Abort
  ${EndIf}
FunctionEnd

Function StartFluxService
  ExecWait '"$SYSDIR\sc.exe" start "${SERVICE_NAME}"'
FunctionEnd

; ── Pre-install: check for Node.js ───────────────────────────
Function .onInit
  ; Try 64-bit registry first, then 32-bit
  ReadRegStr $NodePath HKLM "SOFTWARE\Node.js" "InstallPath"
  ${If} $NodePath == ""
    ReadRegStr $NodePath HKLM "SOFTWARE\WOW6432Node\Node.js" "InstallPath"
  ${EndIf}
  ${If} $NodePath == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "Node.js 18 or later is required but was not found.$\n$\nDownload and install from:$\nhttps://nodejs.org/en/download$\n$\nThen re-run this installer."
    Abort
  ${EndIf}
FunctionEnd

; ── Install section ───────────────────────────────────────────
Section "Flux Agent" SecInstall
  SectionIn RO   ; required, cannot be deselected

  SetOutPath "$INSTDIR"

  ; Copy all agent files (pre-placed next to .nsi during build)
  File /r "dist\*"

  ; Create config directory and write config.json
  CreateDirectory "$PROGRAMDATA\flux-agent"
  FileOpen  $0 "$PROGRAMDATA\flux-agent\config.json" w
  FileWrite $0 '{"fluxUrl":"$FluxUrl","enrollmentToken":"$EnrollToken","installDir":"$INSTDIR"}'
  FileClose $0

  ; Restrict config directory to SYSTEM + Administrators only
  ExecWait '"$SYSDIR\icacls.exe" "$PROGRAMDATA\flux-agent" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" /grant:r "Administrators:(OI)(CI)F"'

  ; Create and start Windows service
  ; binPath must be quoted because it may contain spaces
  ExecWait '"$SYSDIR\sc.exe" create "${SERVICE_NAME}" binPath= "\"$NodePath\node.exe\" \"$INSTDIR\agent.js\"" start= auto DisplayName= "${SERVICE_DISPLAY}"' $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "Service creation returned code $0.$\nYou may need to run as Administrator.$\nTo create manually:$\nsc.exe create ${SERVICE_NAME} binPath= $\"node.exe $\"$INSTDIR\agent.js$\"$\" start= auto"
  ${EndIf}

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Add to Add/Remove Programs
  WriteRegStr   HKLM "${REG_UNINSTALL}" "DisplayName"    "${APP_NAME}"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "Publisher"      "${APP_PUBLISHER}"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "URLInfoAbout"   "${APP_URL}"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKLM "${REG_UNINSTALL}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegDWORD HKLM "${REG_UNINSTALL}" "NoModify"       1
  WriteRegDWORD HKLM "${REG_UNINSTALL}" "NoRepair"       1
SectionEnd

; ── Uninstall section ─────────────────────────────────────────
Section "Uninstall"
  ; Stop and delete service
  ExecWait '"$SYSDIR\sc.exe" stop "${SERVICE_NAME}"'
  Sleep 2000
  ExecWait '"$SYSDIR\sc.exe" delete "${SERVICE_NAME}"'

  ; Remove installed files
  RMDir /r "$INSTDIR"

  ; Remove Add/Remove Programs entry
  DeleteRegKey HKLM "${REG_UNINSTALL}"
  ; Remove install dir registry key written by InstallDirRegKey
  DeleteRegKey HKLM "Software\${APP_NAME}"

  ; NOTE: $PROGRAMDATA\flux-agent\ is intentionally preserved.
  ; It contains the enrolled machineKey — removing it would require re-enrollment.
  ; If you want a clean uninstall, delete C:\ProgramData\flux-agent\ manually.
SectionEnd
