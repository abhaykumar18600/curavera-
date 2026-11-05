# Curavera appointment form integration

## What is included

- `frontend/index.html`, `frontend/curavera.css`, `frontend/curavera.js`
  - HTML/CSS design retained.
  - The existing form now POSTs to the Express API.
  - Current form field names and radio/select values are mapped as-is.
- `backend/`
  - Express API, Mongoose model, MongoDB connection, validation, CORS and rate limiting.

## 1. Copy frontend files

Copy the three files from `frontend/` over the corresponding files in your existing Curavera frontend folder.
Keep your existing `images/` folder and any other assets in place.

The HTML loads `curavera.css` and `curavera.js` from the same directory, matching the uploaded files.

## 2. Configure backend

Open a terminal in `backend/` and run:

```powershell
Copy-Item .env.example .env
npm install
```

Edit `backend/.env`:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/curavera
CLIENT_URL=https://curavera-frontend.vercel.app,http://127.0.0.1:5500,http://localhost:5500
ADMIN_EMAIL=your-clinic-admin-email
ADMIN_PASSWORD=use-a-unique-password-with-at-least-12-characters
PASSWORD_RESET_SECRET=generate-a-random-secret-at-least-32-characters
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
SMTP_FROM=no-reply@your-domain.example
```

Make sure the local MongoDB Server service is running. Compass is a GUI client; it does not start the database server.

For MongoDB Atlas, replace `MONGO_URI` with your Atlas connection string. Do not share or commit `.env`.
The backend will not start until the initial admin email and a unique password (12 or more characters) are configured. The admin account is created once and can approve doctor registrations from Medicare Settings. New doctor signups remain pending until approved; approved doctors can access the clinic dashboard.

Password reset sends a one-time 6-digit code by email. Configure SMTP using the values supplied by your email provider and set `PASSWORD_RESET_SECRET` to a new random value (at least 32 characters). For example, generate one locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste it into your private `backend/.env`; never commit or share the generated secret or SMTP password. Codes expire in 10 minutes, are limited to five guesses, and successful password changes revoke active sessions. Reset requests return a generic response to avoid exposing whether an account exists.

## 2a. Appointment form behavior

The public appointment form accepts 10-digit Indian mobile numbers beginning with 6–9, requires an email address for the approved appointment slip, and rejects past dates. For today's date, Morning becomes unavailable after 12:00 IST and Afternoon after 17:00 IST; Evening remains available because exact clinic hours have not been configured. Patients can optionally attach one PDF or image report up to 10 MB. Reports are uploaded to Cloudinary as authenticated assets, and doctors obtain short-lived download links only after signing into the dashboard. The clinic still reviews each request before confirming it. On approval, the backend emails the appointment details using the configured SMTP account.

Doctors can also open an appointment's details, enter or verify the patient's email address, choose a PDF/JPG/PNG/WEBP report up to 10 MB, and email it as an attachment to that address. This send action requires working SMTP configuration; the uploaded report is held in memory only for the email and is not saved by this action.

The Settings profile form saves the account's name, email, Indian mobile number, specialization and profile-photo URL to MongoDB. Appointment requests can be filtered by preferred date and reversibly hidden/restored from the default list; hidden requests remain in MongoDB.

## 3. Start the backend

```powershell
npm run dev
```

Check:

`http://localhost:5000/api/health`

## 4. Start the frontend

Open the existing frontend folder in VS Code and use Live Server on `index.html`. Open `medicare.html` to reach the doctor dashboard; unauthenticated users are redirected to `login.html`.
The example allowed origins are `http://127.0.0.1:5500` and `http://localhost:5500`.
If Live Server uses another port, add that exact origin to `CLIENT_URL`, then restart the backend.
For deployment, set `CLIENT_URL` in the backend host's environment to include the exact Vercel origin, `https://curavera-frontend.vercel.app`.

Use the same host consistently for the frontend and API (both `localhost` or both `127.0.0.1`) so the browser sends the session cookie. Login sessions expire after eight hours.

## 5. Verify a submission

Submit a test appointment using non-real test details. In MongoDB Compass, refresh the `curavera` database and open the `appointments` collection.

New requests are saved with status `pending`. This does not confirm a booking; the clinic must contact the requester and confirm availability.

## Notes before accepting real patient requests

This is a starter integration, not a production-ready clinical booking platform. Do not collect sensitive health details in the free-text note. Before public launch, add a clear privacy notice and retention policy, protect admin access, use HTTPS, restrict database access, and review applicable Indian data-protection and healthcare requirements. Never expose MongoDB credentials or SMTP passwords in frontend JavaScript.
