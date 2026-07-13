Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

appDir = FSO.GetParentFolderName(WScript.ScriptFullName)
errorFile = appDir & "\test_error.txt"
python = WshShell.ExpandEnvironmentStrings("%WHISPER_SUBTITLE_PYTHON%")

If python = "%WHISPER_SUBTITLE_PYTHON%" Or python = "" Then
    candidates = Array( _
        appDir & "\whisper_env\Scripts\python.exe", _
        appDir & "\.venv\Scripts\python.exe", _
        appDir & "\venv\Scripts\python.exe" _
    )
    python = ""
    For Each candidate In candidates
        If FSO.FileExists(candidate) Then
            python = candidate
            Exit For
        End If
    Next
End If

If python = "" Then python = "python"
pythonw = FSO.BuildPath(FSO.GetParentFolderName(python), "pythonw.exe")
If Not FSO.FileExists(pythonw) Then pythonw = python

If FSO.FileExists(errorFile) Then FSO.DeleteFile(errorFile)

comspec = WshShell.ExpandEnvironmentStrings("%COMSPEC%")
testCmd = Chr(34) & comspec & Chr(34) & " /d /c " & Chr(34) & Chr(34) & python & Chr(34) & " -m whisper_subtitle check 2> " & Chr(34) & errorFile & Chr(34) & Chr(34)
result = WshShell.Run(testCmd, 0, True)

If result <> 0 Then
    If FSO.FileExists(errorFile) Then
        Set errFile = FSO.OpenTextFile(errorFile, 1)
        errContent = errFile.ReadAll
        errFile.Close
    Else
        errContent = "Environment check failed. Set WHISPER_SUBTITLE_PYTHON to a valid interpreter."
    End If
    MsgBox "Launch failed:" & vbCrLf & vbCrLf & errContent, vbCritical, "Error"
    If FSO.FileExists(errorFile) Then FSO.DeleteFile(errorFile)
    WScript.Quit 1
End If

If FSO.FileExists(errorFile) Then FSO.DeleteFile(errorFile)
WshShell.Run Chr(34) & pythonw & Chr(34) & " -m whisper_subtitle gui", 0, False

Set WshShell = Nothing
Set FSO = Nothing
