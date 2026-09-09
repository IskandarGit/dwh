@echo off
REM Локальный запуск SmartupCMS директора БЕЗ Docker (проверено 09.09.2026)
REM PostgreSQL 18 portable: C:\tools\pgsql18, данные C:\tools\pgdata18
setlocal
set JAVA_HOME=C:\tools\jdk-25.0.4.1+1
set PATH=C:\tools\node-v24.20.0-win-x64;%PATH%
set DB_URL=jdbc:postgresql://127.0.0.1:5432/smartupcms
set DB_USER=smartupcms
set DB_PASSWORD=smartupcms_local_dev
set DWH_TYPESENSE_ENABLED=false
set DWH_STORAGE_LOCAL_PATH=C:/tools/smartupcms-storage

echo [1/4] PostgreSQL 18...
"C:\tools\pgsql18\bin\pg_ctl.exe" -D "C:\tools\pgdata18" -l "C:\tools\pg18.log" -o "-p 5432" start

echo [2/4] сборка (пропустить: SKIP_BUILD=1)...
if not "%SKIP_BUILD%"=="1" call "C:\tools\apache-maven-3.9.9\bin\mvn.cmd" -B -DskipTests package

echo [3/4] миграции...
"%JAVA_HOME%\bin\java.exe" -jar apps\server\target\server-1.0.0-SNAPSHOT.jar --spring.profiles.active=migrate

echo [4/4] сервер 8080 + веб 4200...
start "cms-server" "%JAVA_HOME%\bin\java.exe" -jar apps\server\target\server-1.0.0-SNAPSHOT.jar --spring.profiles.active=dev
start "cms-web" cmd /c "cd apps\web && npm start"
echo Открыть http://localhost:4200  вход admin / DevOnly-ChangeMe-1
endlocal
