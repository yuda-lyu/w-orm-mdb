@echo off
rem Build connMDB.exe with Windows built-in csc (no SDK needed)
rem Output: ..\bin\connMDB.exe (x86 required: Jet 4.0 provider is 32-bit only)
rem After a rebuild: commit bin\connMDB.exe, then run: node toolg\genBinManifest.mjs --commit ^<that commit^>
%windir%\Microsoft.NET\Framework\v4.0.30319\csc.exe -nologo -optimize+ -platform:x86 -out:..\bin\connMDB.exe -r:System.Web.Extensions.dll MdbBridge.cs
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo BUILD OK: ..\bin\connMDB.exe
