Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""D:\fzhlian\Code\CodexBridge\scripts\auto-sync.ps1"" -RepoPath ""D:\fzhlian\Code\CodexBridge"" -Branch main -Remote origin", 0, True
