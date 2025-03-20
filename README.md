# Locker Rental App Backend

This is the backend server for the Locker Rental Mobile Application.

## Tech Stack

- **Express.js**: Backend framework
- **PostgreSQL + PostGIS**: Database with geospatial capabilities
- **TypeScript**: Type-safe JavaScript
- **Socket.IO**: Real-time communication with mobile app
- **MQTT**: IoT communication with locker hardware
- **JWT**: Authentication 
- **Twilio**: SMS OTP verification

## Features

- User authentication with phone OTP verification
- Locker reservation and management
- Location-based locker search
- Real-time status updates
- Payment integration
- User profile management

## Getting Started

### Prerequisites

- Node.js 16+ 
- PostgreSQL 12+ with PostGIS extension
- MQTT broker (Mosquitto, HiveMQ, etc.)

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd <repository-directory>
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

Copy the `.env.example` file to `.env` and fill out the required configuration.

4. Set up database:

Ensure PostgreSQL is running and create a database with the name specified in your `.env` file.

5. Run database migrations:

The database schema will be automatically applied when running in development mode.

6. Start the development server:

```bash
npm run dev
```

## API Documentation

### Authentication Endpoints

- `POST /api/auth/request-verification`: Request OTP for phone verification
- `POST /api/auth/verify-phone`: Verify phone with OTP
- `POST /api/auth/signup`: Register a new user
- `POST /api/auth/login`: Login with phone and password
- `POST /api/auth/request-login-otp`: Request OTP for passwordless login
- `POST /api/auth/login-with-otp`: Login with OTP

### User Endpoints

- `GET /api/user/profile`: Get user profile
- `PUT /api/user/profile`: Update user profile
- `PUT /api/user/password`: Change password
- `PUT /api/user/preferences`: Update user preferences
- `POST /api/user/profile-image`: Upload profile image
- `GET /api/user/reservation-history`: Get reservation history

### Locker Endpoints

- `GET /api/lockers/locations`: Get all locker locations
- `GET /api/lockers/nearby`: Get nearby locker locations
- `GET /api/lockers/location/:locationId`: Get location details
- `POST /api/lockers/reserve`: Reserve a locker
- `GET /api/lockers/reservations`: Get user's active reservations
- `POST /api/lockers/extend`: Extend a reservation
- `POST /api/lockers/release/:reservationId`: Release a locker

## Development

### Project Structure

```
├── src
│   ├── config          # Configuration files
│   ├── controllers     # API controllers
│   ├── middleware      # Express middleware
│   ├── models          # Database models
│   ├── routes          # API routes
│   ├── services        # Business logic
│   ├── utils           # Utility functions
│   ├── index.ts        # Entry point
├── dist                # Compiled JavaScript
├── node_modules
├── .env
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
```

### Database Schema

The database schema includes tables for:

- Users
- Authentication methods
- Locations
- Locker sizes
- Lockers
- Reservations
- Payments
- User preferences

See `src/config/database.sql` for the complete schema.

## Production Deployment

### Building for Production

```bash
npm run build
```

This will compile TypeScript to JavaScript in the `dist` directory.

### Running in Production

```bash
npm start
```

## License

[MIT License](LICENSE) 

note here {
  "phone": "+1234567890",
  "otp": "123456"
}
works not {
  "phone": "+1234567890",
  "code": "123456"
}