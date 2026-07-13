Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

appDir = FSO.GetParentFolderName(WScript.ScriptFullName)
python = appDir & "\whisper_env\Scripts\python.exe"
pythonw = appDir & "\whisper_env\Scripts\pythonw.exe"
guiScript = appDir & "\src\gui\WhisperPyQtGUI.py"
testScript = appDir & "\src\utils\test_env.py"
errorFile = appDir & "\test_error.txt"

If Not FSO.FileExists(python) Then
    MsgBox "python.exe not found!" & vbCrLf & python, vbCritical, "Launch Failed"
    WScript.Quit 1
End If

If Not FSO.FileExists(guiScript) Then
    MsgBox "GUI script not found!" & vbCrLf & guiScript, vbCritical, "Launch Failed"
    WScript.Quit 1
End If

' Delete old error file
If FSO.FileExists(errorFile) Then
    FSO.DeleteFile(errorFile)
End If

' Run test script (hidden window, wait for result)
Dim testCmd
testCmd = Chr(34) & python & Chr(34) & " " & Chr(34) & testScript & Chr(34) & " 2> " & Chr(34) & errorFile & Chr(34)
result = WshShell.Run(testCmd, 0, True)

If result <> 0 Then
    Dim errContent
    If FSO.FileExists(errorFile) Then
        Dim errFile
        Set errFile = FSO.OpenTextFile(errorFile, 1)
        errContent = errFile.ReadAll
        errFile.Close
    Else
        errContent = "Environment test failed."
    End If
    MsgBox "Launch failed:" & vbCrLf & vbCrLf & errContent, vbCritical, "Error"
    If FSO.FileExists(errorFile) Then FSO.DeleteFile(errorFile)
    WScript.Quit 1
End If

' Test passed, clean up and launch GUI
If FSO.FileExists(errorFile) Then FSO.DeleteFile(errorFile)
WshShell.Run Chr(34) & pythonw & Chr(34) & " " & Chr(34) & guiScript & Chr(34), 0, False

Set WshShell = Nothing
Set FSO = Nothing
