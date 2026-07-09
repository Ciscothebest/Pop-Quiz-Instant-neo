@echo off
title Lanzador - Generador de Examenes IA
echo ===================================================
echo   Iniciando Servidor de Generador de Examenes IA
echo ===================================================
echo:

:: Buscar y liberar el puerto 3000 si esta ocupado
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
  echo Liberando puerto 3000...
  taskkill /f /pid %%a >nul 2>&1
)

:: Cambiar al directorio del backend
cd /d "%~dp0\backend"

:: Verificar si la carpeta node_modules o sqlite3 existe, si no, instalar dependencias
if not exist "node_modules\sqlite3" (
  echo Detectadas nuevas dependencias de SQLite. Instalando paquetes...
  call npm install
)

:: Iniciar el servidor de Node en una ventana nueva
start "Servidor Generador Examenes IA" cmd /k "node server.js"

:: Esperar 2 segundos para asegurar que el servidor levanto
echo Esperando a que el servidor se conecte...
timeout /t 2 >nul

:: Abrir la aplicacion en el navegador predeterminado
echo Abriendo aplicacion en el navegador...
start http://localhost:3000

echo:
echo Listo! El servidor esta corriendo de fondo en la otra ventana.
echo Puedes minimizar la ventana del servidor, pero no la cierres mientras usas la aplicacion.
echo:
pause
exit
