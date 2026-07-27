# Atlas Mobile

Expo (React Native) app that talks to the Atlas backend API.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to point at your backend
(default is `http://localhost:3001/api`). Note that on a physical device or Android emulator,
`localhost` won't reach your computer's backend — use your machine's LAN IP, or
`10.0.2.2` for the Android emulator specifically.

## Run

```bash
npm start
```

Then press `i` for iOS simulator, `a` for Android emulator, or scan the QR code with
Expo Go on a physical device.

## Test

```bash
npm test
```

## Build

See the root [README.md](../README.md#mobile-app) for the EAS build command used to
produce an installable Android APK.
