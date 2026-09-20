@echo off
REM Локальный запуск SmartupCMS директора БЕЗ Docker (проверено 09.09.2026)
REM PostgreSQL 18 portable: C:\tools\pgsql18, данные C:\tools\pgdata18
setlocal
cd /d "%~dp0"
set JAVA_HOME=C:\tools\jdk-25.0.4.1+1
set PATH=C:\tools\node-v24.20.0-win-x64;%PATH%
set DB_URL=jdbc:postgresql://127.0.0.1:5432/smartupcms
set DB_USER=smartupcms
set DB_PASSWORD=smartupcms_local_dev
set DWH_TYPESENSE_ENABLED=false
set DWH_STORAGE_LOCAL_PATH=C:/tools/smartupcms-storage
REM вторая база pg-dwh (основа fnd, app.dwh.*) — 10.09.2026
set APP_DWH_URL=jdbc:postgresql://127.0.0.1:5432/smartupcms_dwh
set APP_DWH_USERNAME=smartupcms
set APP_DWH_PASSWORD=smartupcms_local_dev
set APP_DWH_CONNECT_TIMEOUT=5s
set DWH_DB_URL=%DB_URL%
set DWH_DB_USER=%DB_USER%
set DWH_DB_PASSWORD=%DB_PASSWORD%
set DWH_DATA_DB_URL=%APP_DWH_URL%
set DWH_DATA_DB_USER=%APP_DWH_USERNAME%
set DWH_DATA_DB_PASSWORD=%APP_DWH_PASSWORD%

echo [1/4] PostgreSQL 18...
REM в скрытом окне: иначе Ctrl+C или закрытие этой консоли убивает postgres (10.09.2026)
netstat -ano | findstr ":5432 " | findstr LISTENING >nul || powershell -NoProfile -Command "Start-Process -WindowStyle Hidden -FilePath 'C:\tools\pgsql18\bin\pg_ctl.exe' -ArgumentList '-D \"C:\tools\pgdata18\" -l \"C:\tools\pg18.log\" -o \"-p 5432\" start'"
for /L %%i in (1,1,20) do (netstat -ano | findstr ":5432 " | findstr LISTENING >nul && goto pg_ok || timeout /t 1 >nul)
echo PostgreSQL не поднялся, см. C:\tools\pg18.log & exit /b 1
:pg_ok

echo [2/4] сборка (пропустить: SKIP_BUILD=1)...
if not "%SKIP_BUILD%"=="1" call "C:\tools\apache-maven-3.9.9\bin\mvn.cmd" -B -o -DskipTests -pl apps/server -am package

echo [2b] база pg-dwh (если нет)...
"C:\tools\pgsql18\bin\psql.exe" -h 127.0.0.1 -U postgres -Atc "select 1 from pg_database where datname='smartupcms_dwh'" | findstr 1 >nul || "C:\tools\pgsql18\bin\psql.exe" -h 127.0.0.1 -U postgres -c "create database smartupcms_dwh owner smartupcms"

echo [2c] веб-зависимости (если нет)...
if not exist apps\web\node_modules\.bin\ng (pushd apps\web && call npm ci && popd)

echo [3/4] миграции: сначала pg-dwh (db/dwh), затем OLTP (каркас + fnd V1xx) — страж версии dwh на пустой базе валит OLTP-миграции (14.09.2026)...
"%JAVA_HOME%\bin\java.exe" -cp apps\server\target\server-1.0.0-SNAPSHOT.jar -Dloader.main=com.greenwhite.dwh.instance.fnd.migration.MigrateMain org.springframework.boot.loader.launch.PropertiesLauncher
"%JAVA_HOME%\bin\java.exe" -jar apps\server\target\server-1.0.0-SNAPSHOT.jar --spring.profiles.active=migrate

echo [4/4] сервер 8080 + веб 4200...
start "cms-server" "%JAVA_HOME%\bin\java.exe" -jar apps\server\target\server-1.0.0-SNAPSHOT.jar --spring.profiles.active=dev
start "cms-web" cmd /c "cd apps\web && npm start"
echo Открыть http://localhost:4200  вход admin / DevOnly-ChangeMe-1
endlocal
