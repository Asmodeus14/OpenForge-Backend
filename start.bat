@echo off
echo ================================
echo OpenForge Deployment Starting
echo ================================

REM Run DB migrations
echo Running migrations...
call npm run migrate



REM Start application
echo Starting application...
call npm run dev

