@echo off
title Lanzador - Generador de Examenes IA
echo ===================================================
echo   Iniciando Servidor de Generador de Examenes IA
echo ===================================================
echo.

:: Cambiar al directorio del backend
cd /d "%~dp0\backend"

:: Verificar si la carpeta node_modules o sqlite3 existe, si no, instalar dependencias
if not exist "node_modules\sqlite3" (
  echo Detectadas nuevas dependencias (SQLite). Instalando paquetes...
  call npm install
  echo.
)

:: Iniciar el servidor de Node en una ventana nueva
start "Servidor Generador Examenes IA" cmd /k "node server.js"

:: Esperar 2 segundos para asegurar que el servidor levantó
echo Esperando a que el servidor se conecte...
timeout /t 2 >nul

:: Abrir la aplicación en el navegador predeterminado
echo Abriendo aplicacion en el navegador...
start http://localhost:3000

echo.
echo ¡Listo! El servidor esta corriendo de fondo en la otra ventana.
echo Puedes minimizar la ventana del servidor, pero no la cierres mientras usas la aplicacion.
echo.
pause
exit
