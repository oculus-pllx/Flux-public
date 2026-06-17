; Flux Windows Installer
; Prerequisites: makensis 3.x, nssm.exe and node.exe in this directory,
;   dist-electron\Flux 1.0.0.exe, backend\ and frontend\dist\ built

!define APPNAME    "Flux"
!define SERVICENAME "FluxUPS"
!define SERVICEDISPLAY "Flux UPS Monitor"
!define SERVICEDESC "Flux UPS monitoring and alerting service by Parallax Group"
!define VERSION    "1.0.0"
!define PUBLISHER  "Parallax Group"
!define PORT       "5174"

Var DataDir

Name "${APPNAME} ${VERSION}"
OutFile "..\..\dist-installer\Flux-Setup.exe"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ── Install ──────────────────────────────────────────────────────────────────
Section "Install" SecInstall

  SetShellVarContext all
  ExpandEnvStrings $DataDir "%ProgramData%"
  StrCpy $DataDir "$DataDir\${APPNAME}"

  ; Stop the existing service before replacing backend files during upgrades.
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$svc = Get-Service -Name \"${SERVICENAME}\" -ErrorAction SilentlyContinue; if ($$svc -and $$svc.Status -ne \"Stopped\") { Stop-Service -Name \"${SERVICENAME}\" -Force -ErrorAction SilentlyContinue; $$svc.WaitForStatus(\"Stopped\", \"00:00:30\") }"'

  ; Backend source
  SetOutPath "$INSTDIR\backend"
  File /r "..\..\backend\*"

  ; Frontend static files
  SetOutPath "$INSTDIR\frontend\dist"
  File /r "..\..\frontend\dist\*"

  ; Runtimes + tools + tray
  SetOutPath "$INSTDIR"
  File "node.exe"
  File "nssm.exe"
  File /oname=FluxTray.exe "..\..\dist-electron\Flux ${VERSION}.exe"

  ; Create ProgramData config/log dir, preserve existing .env/flux.db, and harden ACLs.
  CreateDirectory "$DataDir"
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dataDir = Join-Path $$env:ProgramData \"${APPNAME}\"; New-Item -ItemType Directory -Force -Path $$dataDir | Out-Null; $$envFile = Join-Path $$dataDir \".env\"; $$dbPath = Join-Path $$dataDir \"flux.db\"; $$logPath = Join-Path $$dataDir \"flux-service.log\"; if (!(Test-Path -LiteralPath $$envFile)) { $$j = -join ((65..90)+(97..122)+(48..57) | Get-Random -Count 48 | ForEach-Object {[char]$$_}); @(\"NODE_ENV=production\",\"PORT=${PORT}\",\"DB_PATH=$$dbPath\",\"FRONTEND_URL=\",\"JWT_SECRET=$$j\") | Set-Content -LiteralPath $$envFile -Encoding UTF8 } elseif (-not (Select-String -LiteralPath $$envFile -Pattern \"^JWT_SECRET=\" -Quiet)) { $$j = -join ((65..90)+(97..122)+(48..57) | Get-Random -Count 48 | ForEach-Object {[char]$$_}); Add-Content -LiteralPath $$envFile -Value \"JWT_SECRET=$$j\" -Encoding UTF8 }; if (!(Test-Path -LiteralPath $$logPath)) { New-Item -ItemType File -Force -Path $$logPath | Out-Null }; & icacls $$dataDir /inheritance:r /grant:r \"*S-1-5-18:(OI)(CI)F\" \"*S-1-5-32-544:(OI)(CI)F\" /remove:g \"*S-1-5-32-545\" \"*S-1-5-11\" \"*S-1-1-0\" | Out-Null"'

  ; Register or update Windows Service (node.exe runs server.js directly)
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if (-not (Get-Service -Name \"${SERVICENAME}\" -ErrorAction SilentlyContinue)) { & \"$INSTDIR\nssm.exe\" install \"${SERVICENAME}\" \"$INSTDIR\node.exe\" }"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICENAME} AppParameters "$INSTDIR\backend\server.js"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICENAME} AppDirectory "$INSTDIR\backend"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICENAME} AppEnvironmentExtra "ENV_FILE=$DataDir\.env"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICENAME} DisplayName "${SERVICEDISPLAY}"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICENAME} Description "${SERVICEDESC}"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICENAME} Start SERVICE_AUTO_START'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICENAME} AppStdout "$DataDir\flux-service.log"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" set ${SERVICENAME} AppStderr "$DataDir\flux-service.log"'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" start ${SERVICENAME}'

  ; Tray app runs at login
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APPNAME}Tray" '"$INSTDIR\FluxTray.exe"'

  ; Start Menu
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"           "$INSTDIR\FluxTray.exe"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; Uninstaller + registry
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName"      "${APPNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString"  '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher"        "${PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion"   "${VERSION}"

  ; Open browser when done
  ExecShell "open" "http://localhost:${PORT}"

SectionEnd

; ── Uninstall ─────────────────────────────────────────────────────────────────
Section "Uninstall"

  SetShellVarContext all
  ExpandEnvStrings $DataDir "%ProgramData%"
  StrCpy $DataDir "$DataDir\${APPNAME}"

  nsExec::ExecToLog '"$INSTDIR\nssm.exe" stop    ${SERVICENAME}'
  nsExec::ExecToLog '"$INSTDIR\nssm.exe" remove  ${SERVICENAME} confirm'

  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APPNAME}Tray"
  DeleteRegKey   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  DeleteRegKey   HKLM "Software\${APPNAME}"

  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk"
  RMDir  "$SMPROGRAMS\${APPNAME}"

  RMDir /r "$INSTDIR\backend"
  RMDir /r "$INSTDIR\frontend"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\FluxTray.exe"
  Delete "$INSTDIR\nssm.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir  "$INSTDIR"

SectionEnd
