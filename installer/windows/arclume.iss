; ARCLUME - Windows installer (Inno Setup 6)
;
; Compiled by scripts\windows\build-distribution.ps1, which passes:
;   /DArclumeVersion=<version from package.json>
;   /DPortableRoot=<assembled portable layout>
;   /DRepoRoot=<repository root>
;
; The installer only lays down an already-built payload. It never runs npm,
; never downloads Node.js and never downloads Chromium.

#ifndef ArclumeVersion
  #error ArclumeVersion must be passed with /DArclumeVersion=...
#endif
#ifndef PortableRoot
  #error PortableRoot must be passed with /DPortableRoot=...
#endif
#ifndef RepoRoot
  #error RepoRoot must be passed with /DRepoRoot=...
#endif

#define ArclumeName "ARCLUME"
#define ArclumePublisher "Kerwil Gil"
#define ArclumeURL "https://github.com/kerwilgil/arclume"
#define ArclumeExe "ARCLUME.exe"

[Setup]
; A stable AppId keeps upgrades and uninstall entries coherent across versions.
AppId={{7C3F1B26-4C4A-4F0E-9F1B-3E5C9A6D2A11}
AppName={#ArclumeName}
AppVersion={#ArclumeVersion}
AppVerName={#ArclumeName} {#ArclumeVersion}
AppPublisher={#ArclumePublisher}
AppPublisherURL={#ArclumeURL}
AppSupportURL={#ArclumeURL}/issues
AppUpdatesURL={#ArclumeURL}/releases
VersionInfoVersion={#ArclumeVersion}
VersionInfoProductName={#ArclumeName}
VersionInfoDescription={#ArclumeName} - Local Visual Narrative Workspace

; Per-user installation: no administrator rights, no Program Files, no UAC.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={localappdata}\Programs\{#ArclumeName}
DisableDirPage=no
DefaultGroupName={#ArclumeName}
DisableProgramGroupPage=yes
AllowNoIcons=yes

LicenseFile={#RepoRoot}\LICENSE
SetupIconFile={#RepoRoot}\docs\assets\brand\arclume.ico
; Technical derivatives of the official Lume Glyph for Inno Setup's fixed-size panels.
WizardImageFile={#RepoRoot}\installer\windows\arclume-wizard.bmp
WizardSmallImageFile={#RepoRoot}\installer\windows\arclume-wizard-small.bmp
UninstallDisplayName={#ArclumeName} {#ArclumeVersion}
UninstallDisplayIcon={app}\{#ArclumeExe}

OutputDir=.
OutputBaseFilename=ARCLUME-Setup-{#ArclumeVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#PortableRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#ArclumeName}"; Filename: "{app}\{#ArclumeExe}"; WorkingDir: "{app}"; IconFilename: "{app}\arclume.ico"; Comment: "{#ArclumeName} - Local Visual Narrative Workspace"
Name: "{group}\Uninstall {#ArclumeName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#ArclumeName}"; Filename: "{app}\{#ArclumeExe}"; WorkingDir: "{app}"; IconFilename: "{app}\arclume.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#ArclumeExe}"; Description: "Launch {#ArclumeName} now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Remove the installed payload wholesale: the bundled runtime and the bundled
; browser leave directories behind that a plain file list would miss. User
; documents and projects never live here - they stay wherever the user saved
; them, and %LOCALAPPDATA%\ARCLUME (logs and runtime state) is deliberately
; left alone.
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\browsers"
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\licenses"
Type: dirifempty; Name: "{app}"
