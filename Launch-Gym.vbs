Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

strDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strDir

' التأكد من تشغيل السيرفر
isRunning = False
On Error Resume Next
Set oHTTP = CreateObject("MSXML2.ServerXMLHTTP.6.0")
oHTTP.setTimeouts 500, 500, 500, 500
oHTTP.open "GET", "http://localhost:3000/api/public/card/1001", False
oHTTP.send ""
If Err.Number = 0 Then
    If oHTTP.status = 200 Or oHTTP.status = 404 Or oHTTP.status = 401 Then
        isRunning = True
    End If
End If
On Error Goto 0

' إذا لم يكن السيرفر يعمل، نقوم بتشغيله في الخلفية بدون أي شاشة سوداء
If Not isRunning Then
    WshShell.Run "node server.js", 0, False
    WScript.Sleep 1000
End If

' فتح التطبيق في نافذة مستقلة كأنه برنامج ديسك توب (App Mode)
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If fso.FileExists(edgePath) Then
    WshShell.Run """" & edgePath & """ --app=http://localhost:3000 --window-size=1300,850", 1, False
Else
    WshShell.Run "http://localhost:3000", 1, False
End If
