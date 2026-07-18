schtasks /create /tn "RunStartBat" /tr "cmd.exe /c start \"\" \"C:\Projects\Contruction Quoting Application\start.bat\"" /sc once /st 00:00 /it /f
schtasks /run /tn "RunStartBat"
schtasks /delete /tn "RunStartBat" /f
