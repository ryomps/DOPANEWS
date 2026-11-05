@echo off
netsh advfirewall firewall add rule name="DOPANEWS Phone 3001 Local Network" dir=in action=allow protocol=TCP localport=3001 remoteip=localsubnet profile=any
pause
