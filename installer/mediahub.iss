; MediaHub Windows installer (Inno Setup 6). Compiled by the release workflow:
;   ISCC /DAppVersion=<x> /DSourceDir=<staging dir> /DOutputDir=<dir> installer\mediahub.iss

#ifndef AppVersion
  #error AppVersion is not defined. Pass /DAppVersion=<version>.
#endif
#ifndef SourceDir
  #error SourceDir is not defined. Pass /DSourceDir=<staging dir>.
#endif
#ifndef OutputDir
  #error OutputDir is not defined. Pass /DOutputDir=<dir>.
#endif

[Setup]
AppId={{912D9B59-5181-4F43-98C9-087D0F128CEC}
AppName=MediaHub
AppVersion={#AppVersion}
AppPublisher=Gary Winstanley
DefaultDirName={autopf}\MediaHub
DisableProgramGroupPage=yes
; Always Program Files: only admins can write there, and the service runs node.exe and WinSW from it.
DisableDirPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=MediaHub-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=MediaHub
CloseApplications=no

[Files]
Source: "{#SourceDir}\node.exe"; DestDir: "{app}"; Flags: ignoreversion
; Same file again, extracted to {tmp} so the wizard can ask node for the Windows time zone.
Source: "{#SourceDir}\node.exe"; Flags: dontcopy
; Run from {tmp} before Setup trusts an existing data folder. Not installed.
Source: "check-data-owners.ps1"; Flags: dontcopy
Source: "{#SourceDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\service\MediaHub.exe"; DestDir: "{app}\service"; Flags: ignoreversion
; Template: rewritten with the real paths in [Code] after the files are copied.
Source: "{#SourceDir}\service\MediaHub.xml"; DestDir: "{app}\service"; Flags: ignoreversion
; Template for the MediaHub\Updater scheduled task: filled in like MediaHub.xml and registered in CurStepChanged.
Source: "{#SourceDir}\service\MediaHub-Updater.xml"; DestDir: "{app}\service"; Flags: ignoreversion
; Template for the MediaHub\UpdateInstall task (started by the updater to install a verified update).
Source: "{#SourceDir}\service\MediaHub-UpdateInstall.xml"; DestDir: "{app}\service"; Flags: ignoreversion
Source: "{#SourceDir}\mediahub-tool.cmd"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "{code:GetAppUrl}"; Description: "Open MediaHub"; Flags: postinstall shellexec skipifsilent nowait

[Code]
const
  ServiceName = 'MediaHub';
  AllowedTimeZoneChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+-/';

var
  AddressPage: TInputQueryWizardPage;
  // Set when a step after the file copy fails, so Setup exits non-zero even when it is silent.
  PostInstallError: String;

// Data folder (settings, database, logs). Never touched by [Files]; only the uninstaller's optional prompt deletes it.
function DataDir(): String;
begin
  Result := ExpandConstant('{commonappdata}\MediaHub');
end;

function EnvFile(): String;
begin
  Result := DataDir() + '\mediahub.env';
end;

// System tools from System32. Setup runs in 64-bit install mode, so {sys} and Exec use the 64-bit System32.
function SysTool(const Name: String): String;
begin
  Result := ExpandConstant('{sys}') + '\' + Name;
end;

// Runs a command hidden, waits for it, and logs the command and exit code. Never logs file contents.
function RunStep(const Description, Filename, Params: String; var Rc: Integer): Boolean;
begin
  Log(Description + ': ' + Filename + ' ' + Params);
  Result := Exec(Filename, Params, '', SW_HIDE, ewWaitUntilTerminated, Rc);
  Log(Description + ': exit code ' + IntToStr(Rc));
  Result := Result and (Rc = 0);
end;

function ServiceExists(): Boolean;
var
  Rc: Integer;
  Ok: Boolean;
begin
  Ok := Exec(SysTool('sc.exe'), 'query ' + ServiceName, '', SW_HIDE, ewWaitUntilTerminated, Rc);
  Result := Ok and (Rc = 0);
end;

// True when "sc query" reports the STOPPED state.
function ServiceIsStopped(): Boolean;
var
  Rc, I: Integer;
  Captured: TExecOutput;
  Ok: Boolean;
begin
  Result := False;
  Ok := ExecAndCaptureOutput(SysTool('sc.exe'), 'query ' + ServiceName, '', SW_HIDE, ewWaitUntilTerminated, Rc, Captured);
  if not Ok then Exit;
  for I := 0 to GetArrayLength(Captured.StdOut) - 1 do
    // The state line reads e.g. "STATE : 1  STOPPED". Only that line counts, and both the code and the name must match.
    if (Pos('STATE', Captured.StdOut[I]) > 0) and (Pos(': 1 ', Captured.StdOut[I]) > 0) and (Pos('STOPPED', Captured.StdOut[I]) > 0) then Result := True;
end;

// The account the installed service runs as, e.g. "NT SERVICE\MediaHub" or "LocalSystem". Empty on failure.
function ServiceAccount(): String;
begin
  // Read from the service's registry key rather than through PowerShell: no process, no modules to load.
  if not RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Services\' + ServiceName, 'ObjectName', Result) then Result := '';
  Result := Trim(Result);
end;

// Reads KEY=value from mediahub.env. Empty when the file or key is missing. Comment lines are skipped.
function ReadEnvValue(const Key: String): String;
var
  Lines: TArrayOfString;
  I: Integer;
  Line: String;
begin
  Result := '';
  if not FileExists(EnvFile()) then Exit;
  if not LoadStringsFromFile(EnvFile(), Lines) then Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    Line := Trim(Lines[I]);
    if (Length(Line) > 0) and (Line[1] <> '#') and (Pos(Key + '=', Line) = 1) then
    begin
      Result := Trim(Copy(Line, Length(Key) + 2, Length(Line)));
      Exit;
    end;
  end;
end;

// True when every character is printable ASCII and none of: space, double quote, single quote, #.
function IsPlainAscii(const S: String): Boolean;
var
  I, C: Integer;
begin
  Result := True;
  for I := 1 to Length(S) do
  begin
    C := Ord(S[I]);
    if (C <= 32) or (C >= 127) or (C = 34) or (C = 39) or (C = 35) then
    begin
      Result := False;
      Exit;
    end;
  end;
end;

function IsValidZone(const S: String): Boolean;
var
  I: Integer;
begin
  Result := Length(S) > 0;
  for I := 1 to Length(S) do
    if Pos(Copy(S, I, 1), AllowedTimeZoneChars) = 0 then Result := False;
end;

// The port as a number, or -1 when it is not a whole number from 1 to 65535.
function ParsePort(const S: String): Integer;
var
  P: Integer;
begin
  P := StrToIntDef(S, -1);
  if (P < 1) or (P > 65535) or (IntToStr(P) <> S) then
    Result := -1
  else
    Result := P;
end;

// True when something is listening on the port. Exit code 1 from the PowerShell check means in use.
function PortInUse(const Port: Integer): Boolean;
var
  Rc: Integer;
  Ok: Boolean;
  Cmd: String;
begin
  // .NET only, no PowerShell modules (see check-data-owners.ps1). Exit code 5 means in use, so a PowerShell
  // failure (exit code 1) is not mistaken for a busy port.
  Cmd := '-NoProfile -NonInteractive -Command "foreach ($l in [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()) { if ($l.Port -eq ' + IntToStr(Port) + ') { exit 5 } }; exit 0"';
  // A check that can't run counts as in use, so Setup never installs onto a port it couldn't check.
  Ok := Exec(SysTool('WindowsPowerShell\v1.0\powershell.exe'), Cmd, '', SW_HIDE, ewWaitUntilTerminated, Rc);
  if not Ok then
  begin
    Log('Port check for ' + IntToStr(Port) + ': PowerShell did not start.');
    Result := True;
    Exit;
  end;
  Log('Port check for ' + IntToStr(Port) + ': exit code ' + IntToStr(Rc));
  // 5 means in use. Any other non-zero code means the check failed, which also counts as in use.
  Result := Rc <> 0;
end;

// Time zone from Windows, via the bundled node.exe. Falls back to Europe/London.
function DetectTimeZone(): String;
var
  Rc: Integer;
  Captured: TExecOutput;
  Zone: String;
  Ok: Boolean;
begin
  Result := 'Europe/London';
  try
    ExtractTemporaryFile('node.exe');
    Ok := ExecAndCaptureOutput(ExpandConstant('{tmp}\node.exe'), '-p "Intl.DateTimeFormat().resolvedOptions().timeZone"', '', SW_HIDE, ewWaitUntilTerminated, Rc, Captured);
    if Ok and (Rc = 0) and (GetArrayLength(Captured.StdOut) > 0) then
    begin
      Zone := Trim(Captured.StdOut[0]);
      if IsValidZone(Zone) then Result := Zone;
    end;
  except
    Log('Time zone detection failed: ' + GetExceptionMessage);
  end;
end;

// The account as icacls and PowerShell accept it. WMI reports the built-in service accounts by names that
// account lookups may not resolve, so those become SIDs.
function AccountPrincipal(const Account: String): String;
begin
  // The Services app stores a local account as .\name, which account lookups don't accept.
  if Copy(Account, 1, 2) = '.\' then Result := GetComputerNameString() + '\' + Copy(Account, 3, Length(Account))
  else if SameText(Account, 'NT AUTHORITY\LocalService') then Result := '*S-1-5-19'
  else if SameText(Account, 'NT AUTHORITY\NetworkService') then Result := '*S-1-5-20'
  else Result := Account;
end;

// Refuses a data folder that holds anything not owned by an administrator, SYSTEM or a service (see
// check-data-owners.ps1). Returns an error message, or '' when the folder is missing or trusted.
function CheckDataOwners(): String;
var
  Rc, I: Integer;
  Captured: TExecOutput;
  Account, Params, Detail: String;
begin
  Result := '';
  if not DirExists(DataDir()) then Exit;
  Account := '';
  if ServiceExists() then Account := AccountPrincipal(ServiceAccount());
  if Copy(Account, 1, 1) = '*' then Account := '';
  ExtractTemporaryFile('check-data-owners.ps1');
  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\check-data-owners.ps1') + '" -Path "' + DataDir() + '"';
  if Account <> '' then Params := Params + ' -ServiceAccount "' + Account + '"';
  Log('Check data folder owners: ' + Params);
  if not ExecAndCaptureOutput(SysTool('WindowsPowerShell\v1.0\powershell.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, Rc, Captured) then
    Rc := -1;
  Log('Check data folder owners: exit code ' + IntToStr(Rc));
  // PowerShell errors name paths and accounts only; the script never reads file contents.
  for I := 0 to GetArrayLength(Captured.StdErr) - 1 do
    if Trim(Captured.StdErr[I]) <> '' then Log('Check data folder owners: ' + Captured.StdErr[I]);
  if Rc = 0 then Exit;
  Detail := '';
  for I := 0 to GetArrayLength(Captured.StdOut) - 1 do
    if Trim(Captured.StdOut[I]) <> '' then Detail := Trim(Captured.StdOut[I]);
  if Rc = 3 then
    Result := DataDir() + ' contains something that was not created by an administrator or a service (' + Detail + '). ' +
      'Someone without admin rights may have created it. Check it, delete or move the folder, then run this installer again.'
  else
    Result := 'Could not check the owners of the files in ' + DataDir() + ' (exit code ' + IntToStr(Rc) + ').';
end;

// Lets only SYSTEM and Administrators into the data folder. The service account is added in CurStepChanged.
function LockDataDir(): Boolean;
var
  Rc: Integer;
begin
  Result := RunStep('Lock the data folder', SysTool('icacls.exe'),
    '"' + DataDir() + '" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"', Rc);
end;

// Checks the wizard values for a fresh install. Returns an error message, or '' when they are fine.
function ValidateNewConfig(): String;
var
  Address, PortText, Zone: String;
  Port: Integer;
begin
  Result := '';
  Address := Trim(AddressPage.Values[0]);
  PortText := Trim(AddressPage.Values[1]);
  Zone := Trim(AddressPage.Values[2]);
  Port := ParsePort(PortText);
  if not ((Pos('http://', LowerCase(Address)) = 1) or (Pos('https://', LowerCase(Address)) = 1)) then
    Result := 'The app address must start with http:// or https://.'
  else if not IsPlainAscii(Address) then
    Result := 'The app address must not contain spaces, quotes or # characters.'
  else if Port < 0 then
    Result := 'The port must be a whole number from 1 to 65535.'
  else if not IsValidZone(Zone) then
    Result := 'The time zone must be an IANA name such as Europe/London.'
  // A repair with a missing settings file finds our own service on the port, so the check is skipped when it exists.
  else if (not ServiceExists()) and PortInUse(Port) then
    Result := 'Port ' + IntToStr(Port) + ' is already in use. Choose another port.';
end;

// Stops the existing service and leaves it stopped. The service is kept (not uninstalled), so its account stays.
function StopExistingService(var Err: String): Boolean;
var
  Rc: Integer;
  Exe: String;
  Ok: Boolean;
begin
  if ServiceIsStopped() then
  begin
    Result := True;
    Exit;
  end;
  Exe := ExpandConstant('{app}\service\MediaHub.exe');
  if FileExists(Exe) then
    Ok := RunStep('Stop the existing service', Exe, 'stopwait', Rc)
  else
    Ok := RunStep('Stop the existing service', SysTool('sc.exe'), 'stop ' + ServiceName, Rc);
  Result := ServiceIsStopped();
  if not Result then
    Err := 'Could not stop the MediaHub service. Stop it in services.msc and run this installer again.';
end;

procedure InitializeWizard();
begin
  AddressPage := CreateInputQueryPage(wpSelectDir, 'MediaHub settings',
    'Where MediaHub listens and which time zone it uses.',
    'These are saved to C:\ProgramData\MediaHub\mediahub.env. You can change them later.');
  AddressPage.Add('App address (the URL you type in your browser, e.g. http://mypc:7979):', False);
  AddressPage.Add('Port (1 to 65535):', False);
  AddressPage.Add('Time zone (IANA name, e.g. Europe/London):', False);
  AddressPage.Values[0] := 'http://' + LowerCase(GetComputerNameString()) + ':7979';
  AddressPage.Values[1] := '7979';
  AddressPage.Values[2] := DetectTimeZone();
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  // The settings page is only for a fresh install. An existing mediahub.env is never rewritten.
  Result := (PageID = AddressPage.ID) and FileExists(EnvFile());
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Msg: String;
begin
  Result := True;
  if CurPageID = AddressPage.ID then
  begin
    Msg := ValidateNewConfig();
    if Msg <> '' then
    begin
      MsgBox(Msg, mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Err: String;
  AppDir: String;
begin
  Result := '';
  // Before anything in an existing data folder is trusted (the settings file decides whether the wizard runs).
  Result := CheckDataOwners();
  if Result <> '' then
  begin
    Log('Refused: ' + Result);
    Exit;
  end;
  // Silent installs skip the wizard page, so the same checks run here.
  if not FileExists(EnvFile()) then
  begin
    Result := ValidateNewConfig();
    if Result <> '' then Exit;
  end;
  // Upgrade or repair: stop the service (keeping it installed), then clear the old program files.
  if ServiceExists() then
  begin
    if not StopExistingService(Err) then
    begin
      Result := Err;
      Exit;
    end;
  end;
  AppDir := ExpandConstant('{app}\app');
  if DirExists(AppDir) then
  begin
    if not DelTree(AppDir, True, True, True) then
      Result := 'Could not remove the old program files in ' + AppDir + '. Stop anything using them and try again.';
  end;
end;

function XmlEscape(const S: String): String;
begin
  Result := S;
  StringChangeEx(Result, '&', '&amp;', True);
end;

// Replaces @APP@ and @DATA@ in a template in {app}\service and writes it back as UTF-8 without a byte order mark.
function FillTemplate(const Path: String): Boolean;
var
  Text: AnsiString;
  Body: String;
  Lines: TArrayOfString;
begin
  Result := False;
  if not LoadStringFromFile(Path, Text) then Exit;
  Body := Text;
  // Paths may contain & (see XmlEscape) and non-ASCII letters. The templates are ASCII, so reading them as ANSI is safe.
  StringChangeEx(Body, '@APP@', XmlEscape(ExpandConstant('{app}')), True);
  StringChangeEx(Body, '@DATA@', XmlEscape(DataDir()), True);
  SetArrayLength(Lines, 1);
  Lines[0] := Body;
  Result := SaveStringsToUTF8FileWithoutBOM(Path, Lines, False);
end;

// True when Setup was started by the updater (with /UPDATER). The updater then registers the update task itself.
function IsUpdaterRun(): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if SameText(ParamStr(I), '/UPDATER') then Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Rc: Integer;
  Lines: TArrayOfString;
  XmlPath, Account, Grant, Port, Exe, Params: String;
  PortNumber: Integer;
  FindRec: TFindRec;
  Zone, Address, PortText: String;
begin
  if CurStep <> ssPostInstall then Exit;
  Exe := ExpandConstant('{app}\service\MediaHub.exe');
  XmlPath := ExpandConstant('{app}\service\MediaHub.xml');

  // 1. Folders. Permissions are set in step 5.
  if not ForceDirectories(DataDir()) then RaiseException('Could not create ' + DataDir() + '.');
  if not ForceDirectories(DataDir() + '\data') then RaiseException('Could not create the data folder.');
  if not ForceDirectories(DataDir() + '\logs') then RaiseException('Could not create the logs folder.');
  // The auto-updater keeps its state here. Only the requests folder is writable by the service (step 5).
  if not ForceDirectories(DataDir() + '\updates') then RaiseException('Could not create the updates folder.');
  if not ForceDirectories(DataDir() + '\updates\requests') then RaiseException('Could not create the update requests folder.');
  // Locked before the settings file is written, so nobody else can add files to the folder from here on.
  if not LockDataDir() then RaiseException('Could not set permissions on ' + DataDir() + '.');
  // Checked again now that only SYSTEM and Administrators can add to it: the folder may not have existed when
  // PrepareToInstall checked, and a standard user could have created it during the file copy.
  PostInstallError := CheckDataOwners();
  if PostInstallError <> '' then
  begin
    Log('Error: ' + PostInstallError);
    // Plain MsgBox is not suppressed by /SUPPRESSMSGBOXES and would hang a silent install (including the updater's).
    SuppressibleMsgBox(PostInstallError, mbError, MB_OK, IDOK);
    Exit;
  end;

  // 2. Settings file: fresh install only. A repair or upgrade keeps the existing file.
  if not FileExists(EnvFile()) then
  begin
    Address := Trim(AddressPage.Values[0]);
    PortText := Trim(AddressPage.Values[1]);
    Zone := Trim(AddressPage.Values[2]);
    SetArrayLength(Lines, 8);
    Lines[0] := '# MediaHub settings, written by the installer.';
    Lines[1] := '# BETTER_AUTH_SECRET is not set here: MediaHub generates one and stores it in its database.';
    Lines[2] := '# After you edit this file, restart the MediaHub service.';
    Lines[3] := 'BETTER_AUTH_URL=' + Address;
    Lines[4] := 'DATABASE_PATH=' + DataDir() + '\data\mediahub.db';
    Lines[5] := 'DISPLAY_TIMEZONE=' + Zone;
    Lines[6] := 'MEDIAHUB_HOST=0.0.0.0';
    Lines[7] := 'MEDIAHUB_PORT=' + PortText;
    // UTF-8 without a byte order mark. The values are plain ASCII, so this matches what Node reads.
    if not SaveStringsToUTF8FileWithoutBOM(EnvFile(), Lines, False) then
      RaiseException('Could not write ' + EnvFile() + '.');
    Log('Wrote the settings file.');
  end;

  // 3. Fill the placeholders in the WinSW config and the updater task template with the real paths.
  if not FillTemplate(XmlPath) then RaiseException('Could not write ' + XmlPath + '.');
  if not FillTemplate(ExpandConstant('{app}\service\MediaHub-Updater.xml')) then RaiseException('Could not write the update task template.');
  if not FillTemplate(ExpandConstant('{app}\service\MediaHub-UpdateInstall.xml')) then RaiseException('Could not write the update install task template.');

  // 4. Install the service on a fresh install only. An existing service keeps its account and settings.
  if not ServiceExists() then
  begin
    if not RunStep('Install the service', Exe, 'install', Rc) then
      RaiseException('Could not install the MediaHub service (exit code ' + IntToStr(Rc) + '). See the Setup log.');
  end
  else
    Log('The service already exists: keeping its account.');

  // 5. Permissions on the data folder: SYSTEM, Administrators and whatever account the service runs as.
  // Read after step 4, because a fresh install's account only exists once the service does.
  Account := ServiceAccount();
  if Account = '' then RaiseException('Could not read the MediaHub service account.');
  Log('Service account: ' + Account);
  // Everything inside inherits from the folder, which drops any permission set on a single file or subfolder.
  // The service can read the folder and the settings file, and change only data\ and logs\. It never writes
  // mediahub.env, and admin tools load that file, so the service must not be able to change it.
  if not RunStep('Reset permissions inside the data folder', SysTool('icacls.exe'), '"' + DataDir() + '\*" /reset /T /C /Q', Rc) then
    RaiseException('Could not reset permissions inside ' + DataDir() + ' (exit code ' + IntToStr(Rc) + ').');
  Grant := '';
  if not SameText(Account, 'LocalSystem') then Grant := ' "' + AccountPrincipal(Account) + ':(OI)(CI)RX"';
  Params := '"' + DataDir() + '" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"' + Grant;
  if not RunStep('Set data folder permissions', SysTool('icacls.exe'), Params, Rc) then
    RaiseException('Could not set permissions on ' + DataDir() + ' (exit code ' + IntToStr(Rc) + ').');
  if not SameText(Account, 'LocalSystem') then
  begin
    if not RunStep('Let the service write data', SysTool('icacls.exe'), '"' + DataDir() + '\data" /grant:r "' + AccountPrincipal(Account) + ':(OI)(CI)M"', Rc) then
      RaiseException('Could not set permissions on the data folder (exit code ' + IntToStr(Rc) + ').');
    if not RunStep('Let the service write logs', SysTool('icacls.exe'), '"' + DataDir() + '\logs" /grant:r "' + AccountPrincipal(Account) + ':(OI)(CI)M"', Rc) then
      RaiseException('Could not set permissions on the logs folder (exit code ' + IntToStr(Rc) + ').');
    // The only part of updates\ the service can change: "check now" requests are files dropped here.
    // updates\ itself stays read-only for the service (it inherits RX from the data folder).
    if not RunStep('Let the service write update requests', SysTool('icacls.exe'), '"' + DataDir() + '\updates\requests" /grant:r "' + AccountPrincipal(Account) + ':(OI)(CI)M"', Rc) then
      RaiseException('Could not set permissions on the update requests folder (exit code ' + IntToStr(Rc) + ').');
  end;

  // 6. Firewall: private networks only. The old rule is removed first, so a changed port is picked up.
  // The port is checked like the wizard's, because an upgrade keeps a settings file that may have been edited by hand.
  Port := ReadEnvValue('MEDIAHUB_PORT');
  if Port = '' then Port := '7979';
  PortNumber := ParsePort(Port);
  if PortNumber < 0 then
    PostInstallError := 'MEDIAHUB_PORT in ' + EnvFile() + ' is not a whole number from 1 to 65535. Fix it, then run this installer again.'
  else
  begin
    RunStep('Remove the old firewall rule', SysTool('netsh.exe'), 'advfirewall firewall delete rule name="MediaHub"', Rc);
    if not RunStep('Add the firewall rule', SysTool('netsh.exe'), 'advfirewall firewall add rule name="MediaHub" dir=in action=allow protocol=TCP localport=' + IntToStr(PortNumber) + ' profile=private', Rc) then
      PostInstallError := 'Could not add the firewall rule (exit code ' + IntToStr(Rc) + ').';
  end;

  // 7. Start. WinSW reads MediaHub.xml each time the service starts, so this also picks up the rewritten config.
  if (PostInstallError = '') and not RunStep('Start the service', Exe, 'start', Rc) then
    PostInstallError := 'MediaHub is installed but did not start (exit code ' + IntToStr(Rc) + '). See the logs in ' + DataDir() + '\logs.';

  // 8. Update tasks: MediaHub\Updater (every minute: checks and downloads) and MediaHub\UpdateInstall (started
  // by the updater: installs). Not registered when the updater runs this installer (/UPDATER): the updater, which
  // runs inside MediaHub\UpdateInstall, registers both itself afterwards, last of all. It is not known whether
  // re-registering a task stops a running instance of it.
  if (PostInstallError = '') and not IsUpdaterRun() then
  begin
    if not RunStep('Register the update task', SysTool('schtasks.exe'), '/create /tn "MediaHub\Updater" /xml "' + ExpandConstant('{app}') + '\service\MediaHub-Updater.xml" /f', Rc) then
      PostInstallError := 'MediaHub is running, but the update task could not be created (exit code ' + IntToStr(Rc) + ').'
    else if not RunStep('Register the update install task', SysTool('schtasks.exe'), '/create /tn "MediaHub\UpdateInstall" /xml "' + ExpandConstant('{app}') + '\service\MediaHub-UpdateInstall.xml" /f', Rc) then
      PostInstallError := 'MediaHub is running, but the update install task could not be created (exit code ' + IntToStr(Rc) + ').';
  end;

  // 9. A copy of this installer, kept for rollback: the updater runs it if an update fails to start. Only after a
  // successful install. A failure here is only logged, because a missing copy must not fail the install.
  if PostInstallError = '' then
  begin
    if not ForceDirectories(DataDir() + '\updates\installers') then
      Log('Could not create the rollback installer folder.')
    else
    begin
      if FindFirst(DataDir() + '\updates\installers\*.exe', FindRec) then
      begin
        repeat
          DeleteFile(DataDir() + '\updates\installers\' + FindRec.Name);
        until not FindNext(FindRec);
        FindClose(FindRec);
      end;
      if not FileCopy(ExpandConstant('{srcexe}'), DataDir() + '\updates\installers\MediaHub-Setup-{#AppVersion}.exe', False) then
        Log('Could not keep a copy of this installer for rollback.');
    end;
  end;
  if PostInstallError <> '' then
  begin
    Log('Error: ' + PostInstallError);
    SuppressibleMsgBox(PostInstallError, mbError, MB_OK, IDOK);
  end;
end;

// Setup exits with 1 when a step after the file copy failed, so a silent install never reports a broken install as success.
function GetCustomSetupExitCode(): Integer;
begin
  if PostInstallError <> '' then Result := 1 else Result := 0;
end;

// Address for the "Open MediaHub" button on the finish page.
function GetAppUrl(Param: String): String;
begin
  // Only a plain http(s) address is opened, whatever the settings file says.
  Result := ReadEnvValue('BETTER_AUTH_URL');
  if not (((Pos('http://', LowerCase(Result)) = 1) or (Pos('https://', LowerCase(Result)) = 1)) and IsPlainAscii(Result)) then
    Result := 'http://localhost:7979';
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    if PostInstallError <> '' then
    begin
      WizardForm.FinishedLabel.Caption := 'MediaHub was installed, but setup did not finish: ' + PostInstallError;
      Exit;
    end;
    WizardForm.FinishedLabel.Caption :=
      'MediaHub is installed and running as a Windows service.' + #13#10#13#10 +
      'Next: open MediaHub and finish setup by signing in with Plex and choosing your Plex server. Do it now: until setup is finished, the first person to complete it becomes the admin.' + #13#10#13#10 +
      'Admin tools: run mediahub-tool.cmd in ' + ExpandConstant('{app}') + ' from an administrator Command Prompt.';
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Rc: Integer;
  Exe: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    // The update task goes first, so nothing starts the updater while the service is being removed. Result ignored.
    RunStep('Remove the update task', SysTool('schtasks.exe'), '/delete /tn "MediaHub\Updater" /f', Rc);
    RunStep('Remove the update install task', SysTool('schtasks.exe'), '/delete /tn "MediaHub\UpdateInstall" /f', Rc);
    // Program files the updater keeps in the data folder. Removed even on a silent uninstall, because they are not
    // user data. status.json and updater.log stay.
    DelTree(DataDir() + '\updates\installers', True, True, True);
    DelTree(DataDir() + '\updates\downloads', True, True, True);
    DelTree(DataDir() + '\updates\run', True, True, True);
    Exe := ExpandConstant('{app}\service\MediaHub.exe');
    if ServiceExists() and FileExists(Exe) then
    begin
      RunStep('Stop the service', Exe, 'stopwait', Rc);
      if not RunStep('Remove the service', Exe, 'uninstall', Rc) then
        Log('The service could not be removed. Remove it manually with sc delete MediaHub.');
    end;
    RunStep('Remove the firewall rule', SysTool('netsh.exe'), 'advfirewall firewall delete rule name="MediaHub"', Rc);
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    // Data is kept on a silent uninstall. Otherwise ask, with No as the default.
    if not UninstallSilent() then
    begin
      if MsgBox('Also delete your MediaHub data (database, settings, logs, image cache) in ' + DataDir() + '? This cannot be undone.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir(), True, True, True);
    end;
  end;
end;
