Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
Set procEnv = shell.Environment("PROCESS")
On Error Resume Next
procEnv.Remove "ELECTRON_RUN_AS_NODE"
On Error GoTo 0
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
electronExe = dir & "\node_modules\electron\dist\electron.exe"
shell.Run Chr(34) & electronExe & Chr(34) & " " & Chr(34) & dir & Chr(34), 0, False
