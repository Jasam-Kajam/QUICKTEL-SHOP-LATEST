require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { OAuth2Client } = require('google-auth-library');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(require('./firebase-service-account.json')),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const ALLOWED_ADMIN_EMAIL = process.env.ALLOWED_ADMIN_EMAIL;
const client = new OAuth2Client(CLIENT_ID);

// Authentication middleware
async function verifyGoogleToken(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).send('Unauthorized');

  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: CLIENT_ID,
  });
  const payload = ticket.getPayload();

  if (payload.email !== ALLOWED_ADMIN_EMAIL) {
    return res.status(403).send('Forbidden');
  }

  req.user = payload;
  next();
}

// Multer for file uploads (store locally before uploading to Firebase)
const upload = multer({ dest: 'uploads/' });

// Upload endpoint (protected)
app.post('/upload', verifyGoogleToken, upload.single('file'), async (req, res) => {
  const file = req.file;
  const { title, category, fileType } = req.body;

  const destination = `${category}/${file.originalname}`;
  await bucket.upload(file.path, { destination });

  const fileRef = bucket.file(destination);
  const [url] = await fileRef.getSignedUrl({
    action: 'read',
    expires: '03-01-2030',
  });

  await db.collection('materials').add({
    title,
    category,
    fileType,
    url,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  res.send('File uploaded successfully.');
});

// Public GET materials
app.get('/materials', async (req, res) => {
  const snapshot = await db.collection('materials').orderBy('createdAt', 'desc').get();
  const materials = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  res.json(materials);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));