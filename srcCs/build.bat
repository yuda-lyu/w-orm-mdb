@echo off
rem Build connMDB.exe with Windows built-in csc (no SDK needed)
rem Output: ..\src\connMDB.exe (x86 required: Jet 4.0 provider is 32-bit only)
%windir%\Microsoft.NET\Framework\v4.0.30319\csc.exe -nologo -optimize+ -platform:x86 -out:..\src\connMDB.exe -r:System.Web.Extensions.dll MdbBridge.cs
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo BUILD OK: ..\src\connMDB.exe
