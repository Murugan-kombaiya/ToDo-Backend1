@echo off
echo 🚀 Starting Todo Task Application...
echo ===================================

echo.
echo 📡 Starting Express Server (Port 5000)...
echo ===================================
cd ToDo-backend && start "Express Server" cmd /k "node unified-server.js"

echo.
echo ⚛️ Starting React App (Port 3000)...
echo =================================
cd ToDo-frontend/frontend
start "React App" cmd /k "npm start"

echo.
echo ✅ Both servers starting...
echo.
echo 🔗 Access your app at:
echo    React App: http://localhost:3000
echo    API Server: http://localhost:5000
echo.
echo 🔐 Demo Login:
echo    Username: demo
echo    Password: demo123
echo.
echo 🧪 Test Pages:
echo    Login Test: file:///c:/Users/Hayatt/Desktop/ToDo%20task/LOGIN-TEST.html
echo    Route Test: file:///c:/Users/Hayatt/Desktop/ToDo%20task/ROUTE-TEST.html
echo.
echo Press any key to close this window...
pause >nul
