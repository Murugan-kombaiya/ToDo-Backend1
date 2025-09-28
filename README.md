# 📝 ToDo Task Management Application

A modern, full-stack task management application built with React and Node.js, featuring real-time updates, user authentication, and a beautiful Kanban board interface.

## 🚀 Features

- **User Authentication**: Secure login/register with JWT tokens
- **Task Management**: Create, update, delete, and organize tasks
- **Kanban Board**: Visual task organization with drag-and-drop
- **Real-time Updates**: Socket.IO powered live updates
- **Project Organization**: Group tasks by projects
- **Dashboard Analytics**: Track productivity and task completion
- **Dark Mode**: Toggle between light and dark themes
- **Responsive Design**: Works on desktop and mobile devices

## 📋 Prerequisites

- Node.js (v16 or higher)
- PostgreSQL database
- npm or yarn package manager

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone <repository-url>
cd "ToDo task"
```

### 2. Backend Setup

```bash
# Navigate to backend directory
cd ToDo-backend

# Install dependencies
npm install

# Create .env file from example
cp .env.example .env

# Edit .env file with your database credentials
# Make sure PostgreSQL is running

# Start the backend server
npm start
# Or for development with auto-reload
npm run dev
```

### 3. Frontend Setup

```bash
# Navigate to frontend directory
cd ../ToDo-frontend/frontend

# Install dependencies
npm install

# Start the frontend development server
npm start
```

The application will open at `http://localhost:3000`

## 🔧 Configuration

### Backend Environment Variables (.env)
```env
PORT=5000
PGUSER=your_postgres_user
PGHOST=localhost
PGDATABASE=todo_demo
PGPASSWORD=your_password
PGPORT=5432
JWT_SECRET=your_secret_key
FRONTEND_URL=http://localhost:3000
```

### Frontend Environment Variables (.env)
```env
REACT_APP_BACKEND_URL=http://localhost:5000
```

## 📁 Project Structure

```
ToDo task/
├── ToDo-backend/
│   ├── index.js          # Main server file
│   ├── package.json      # Backend dependencies
│   └── .env             # Environment variables
├── ToDo-frontend/
│   └── frontend/
│       ├── src/
│       │   ├── pages/    # React page components
│       │   ├── components/ # Reusable components
│       │   ├── App.js    # Main App component
│       │   └── index.js  # Entry point
│       └── package.json  # Frontend dependencies
└── README.md
```

## 🚦 Available Scripts

### Backend
- `npm start` - Start the server
- `npm run dev` - Start with nodemon (auto-reload)
- `npm test` - Run tests

### Frontend
- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run tests

## 🔒 Security Notes

- Never commit `.env` files to version control
- Generate strong JWT secrets for production
- Use HTTPS in production
- Implement rate limiting for API endpoints
- Sanitize user inputs

## 🐛 Troubleshooting

### Database Connection Issues
- Ensure PostgreSQL is running
- Check database credentials in .env
- Verify database exists: `CREATE DATABASE todo_demo;`

### Port Already in Use
- Backend: Change PORT in .env
- Frontend: Use `PORT=3001 npm start`

### Module Not Found Errors
- Delete node_modules and package-lock.json
- Run `npm install` again

## 📝 License

This project is licensed under the ISC License.

## 👥 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 Support

For support, please create an issue in the GitHub repository.

---

Built with ❤️ using React, Node.js, Express, PostgreSQL, and Socket.IO
