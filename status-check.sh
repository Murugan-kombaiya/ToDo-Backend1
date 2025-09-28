#!/bin/bash

echo "🔍 Checking Server Status..."
echo "=========================="

# Check Express server
echo "📡 Express Server (Port 5000):"
if curl -s http://localhost:5000/health > /dev/null; then
    echo "✅ RUNNING - http://localhost:5000"
    echo "📋 Available endpoints:"
    curl -s http://localhost:5000/health | grep -o '"[^"]*"' | tr ',' '\n' | sed 's/"/  - /' | head -5
else
    echo "❌ NOT RUNNING"
    echo "💡 Start with: node simple-server.js"
fi

echo ""
echo "⚛️ React App (Port 3000):"
if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ RUNNING - http://localhost:3000"
    echo "📋 Available routes:"
    echo "  - / (Dashboard)"
    echo "  - /login (Login Page)"
    echo "  - /register (Register Page)"
    echo "  - /tasks (Tasks)"
    echo "  - /board (Kanban Board)"
    echo "  - /pomodoro (Pomodoro Timer)"
    echo "  - /learning (Learning Progress)"
else
    echo "❌ NOT RUNNING"
    echo "💡 Start with: cd ToDo-frontend/frontend && npm start"
fi

echo ""
echo "🔧 Quick Actions:"
echo "================"
echo "1. Start Express Server:"
echo "   node simple-server.js"
echo ""
echo "2. Start React App:"
echo "   cd ToDo-frontend/frontend && npm start"
echo ""
echo "3. Test Login:"
echo "   Open: file:///c:/Users/Hayatt/Desktop/ToDo%20task/LOGIN-TEST.html"
echo ""
echo "4. Test Routes:"
echo "   Open: file:///c:/Users/Hayatt/Desktop/ToDo%20task/ROUTE-TEST.html"
echo ""
echo "🔐 Demo Login Credentials:"
echo "   Username: demo"
echo "   Password: demo123"
