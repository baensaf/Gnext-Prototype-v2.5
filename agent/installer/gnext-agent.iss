; Gnext Branch Agent installer (Inno Setup 6).
; Build: iscc /DAppVersion=1.0.1 /DSourceExe=..\dist\gnext-agent.exe /DSamanDir=..\dist\saman gnext-agent.iss
;
; The wizard asks for the Gnext server and an enrolment code, checks the code with the server
; before installing anything, then installs the GnextAgent service and starts it. Running a
; newer installer over an enrolled agent keeps its identity; the code is then optional.

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef SourceExe
  #define SourceExe "..\dist\gnext-agent.exe"
#endif
#define DefaultServer "https://gnextdev.ir"

[Setup]
AppId={{8E3C5B2A-6F1D-4C8B-9A7E-2D4F6B1C0E93}
AppName=Gnext Branch Agent
AppVersion={#AppVersion}
AppVerName=Gnext Branch Agent {#AppVersion}
AppPublisher=Gnext
DefaultDirName={autopf}\Gnext\Agent
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=gnext-agent-setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
UninstallDisplayName=Gnext Branch Agent
UninstallDisplayIcon={app}\gnext-agent.exe
SetupIconFile=gnext.ico
SetupLogging=yes

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; Flags: ignoreversion
#ifdef SamanDir
; The Saman PC-POS bridge and Saman's SDK, used by terminals with the sep driver.
Source: "{#SamanDir}\*"; DestDir: "{app}\saman"; Flags: ignoreversion recursesubdirs
#endif

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut to Gnext Agent"

[Icons]
Name: "{autoprograms}\Gnext Agent"; Filename: "{app}\gnext-agent.exe"; Parameters: "open"; Comment: "Gnext branch agent settings"
Name: "{autodesktop}\Gnext Agent"; Filename: "{app}\gnext-agent.exe"; Parameters: "open"; Comment: "Gnext branch agent settings"; Tasks: desktopicon
Name: "{autoprograms}\Gnext Offline Till"; Filename: "{app}\gnext-agent.exe"; Parameters: "till"; Comment: "Sell while the internet is down"
Name: "{autodesktop}\Gnext Offline Till"; Filename: "{app}\gnext-agent.exe"; Parameters: "till"; Comment: "Sell while the internet is down"; Tasks: desktopicon

[Run]
Filename: "{app}\gnext-agent.exe"; Parameters: "open"; Description: "Open Gnext Agent"; Flags: postinstall nowait skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{app}\gnext-agent.exe"; Parameters: "service uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"
; The tray icons run from the same exe in users' sessions; end them so it can be deleted.
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM gnext-agent.exe /FI ""SESSION ne 0"""; Flags: runhidden waituntilterminated; RunOnceId: "EndTrays"

[Messages]
FinishedLabel=The Gnext agent is installed and running. Its settings page (the Gnext Agent shortcut, or http://127.0.0.1:47800) shows the connection and lets a branch manager add printers and card terminals.%n%nLogs: C:\ProgramData\Gnext\Agent\logs\agent.log

[Code]
var
  EnrolPage: TInputQueryWizardPage;
  Enrolled: Boolean;

function DataDir: String;
begin
  Result := ExpandConstant('{commonappdata}\Gnext\Agent');
end;

// Runs gnext-agent.exe with the given arguments, capturing its output.
function RunAgent(const Exe, Params: String; var Output: String): Integer;
var
  LogFile: String;
  Text: AnsiString;
begin
  LogFile := ExpandConstant('{tmp}\agent-output.txt');
  DeleteFile(LogFile);
  if not Exec(ExpandConstant('{cmd}'), '/C ""' + Exe + '" ' + Params + ' > "' + LogFile + '" 2>&1"',
    '', SW_HIDE, ewWaitUntilTerminated, Result) then
    Result := -1;
  Output := '';
  if LoadStringFromFile(LogFile, Text) then
    Output := Trim(String(Text));
end;

function SavedServer: String;
var
  Text: AnsiString;
  S: String;
  P: Integer;
begin
  Result := '{#DefaultServer}';
  if not LoadStringFromFile(DataDir + '\config.json', Text) then
    Exit;
  S := String(Text);
  P := Pos('"server"', S);
  if P = 0 then
    Exit;
  Delete(S, 1, P + 7);
  P := Pos('"', S);
  if P = 0 then
    Exit;
  Delete(S, 1, P);
  P := Pos('"', S);
  if P > 1 then
    Result := Copy(S, 1, P - 1);
end;

procedure InitializeWizard;
var
  Hint: String;
begin
  Enrolled := FileExists(DataDir + '\identity.json');
  if Enrolled then
    Hint := 'This PC already has an enrolled agent. Leave the code empty to keep it, or enter a new code to enrol again (the old agent is then revoked).'
  else
    Hint := 'On the Gnext Branch Agents screen, choose New enrolment code for this branch and type the code here. A code works once and expires after 24 hours. You can also leave it empty and enrol later on the agent settings page.';
  EnrolPage := CreateInputQueryPage(wpWelcome, 'Connect to Gnext',
    'Which Gnext server should this branch agent connect to?', Hint);
  EnrolPage.Add('Server address:', False);
  EnrolPage.Add('Enrolment code (XXXX-XXXX):', False);
  EnrolPage.Values[0] := SavedServer;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Server, Code, Exe, Output: String;
begin
  Result := True;
  if CurPageID <> EnrolPage.ID then
    Exit;

  Server := Trim(EnrolPage.Values[0]);
  Code := Trim(EnrolPage.Values[1]);
  while (Length(Server) > 0) and (Server[Length(Server)] = '/') do
    Delete(Server, Length(Server), 1);
  if (Pos('https://', Lowercase(Server)) <> 1) and (Pos('http://', Lowercase(Server)) <> 1) then
  begin
    MsgBox('Enter the server address starting with https://, for example {#DefaultServer}.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  EnrolPage.Values[0] := Server;
  if (Code = '') and Enrolled then
    Exit;
  if Code = '' then
  begin
    // The settings page can enrol later, so a missing code is allowed after a warning.
    Result := MsgBox('No enrolment code was entered. The agent will be installed but will not connect until it is enrolled on its settings page (Gnext Agent shortcut).' + #13#10#13#10 + 'Continue without a code?', mbConfirmation, MB_YESNO) = IDYES;
    Exit;
  end;

  // Enrol now with the bundled binary, so a wrong or expired code can be fixed on this page.
  ExtractTemporaryFile('gnext-agent.exe');
  Exe := ExpandConstant('{tmp}\gnext-agent.exe');
  WizardForm.NextButton.Enabled := False;
  try
    if RunAgent(Exe, 'enrol --server "' + Server + '" --code "' + Code + '"', Output) <> 0 then
    begin
      MsgBox('Enrolment failed:' + #13#10#13#10 + Output + #13#10#13#10 +
        'Check the server address and the code. You may need a new code from head office.', mbError, MB_OK);
      Result := False;
    end
    else
      Enrolled := True;
  finally
    WizardForm.NextButton.Enabled := True;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Output: String;
  Code: Integer;
begin
  Result := '';
  // Stop a running agent so its binary can be replaced.
  if FileExists(ExpandConstant('{app}\gnext-agent.exe')) then
    RunAgent(ExpandConstant('{app}\gnext-agent.exe'), 'service stop', Output)
  else
    Exec(ExpandConstant('{sys}\net.exe'), 'stop GnextAgent', '', SW_HIDE, ewWaitUntilTerminated, Code);
  // The tray icons run the same binary in users' sessions; the service starts them again.
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM gnext-agent.exe /FI "SESSION ne 0"', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Exe, Output: String;
begin
  if CurStep <> ssPostInstall then
    Exit;
  Exe := ExpandConstant('{app}\gnext-agent.exe');
  if RunAgent(Exe, 'service install', Output) <> 0 then
  begin
    MsgBox('Could not register the GnextAgent service:' + #13#10#13#10 + Output, mbError, MB_OK);
    Exit;
  end;
  if RunAgent(Exe, 'service start', Output) <> 0 then
    MsgBox('The service is installed but did not start:' + #13#10#13#10 + Output, mbError, MB_OK);
end;
