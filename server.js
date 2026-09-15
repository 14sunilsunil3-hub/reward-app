const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB Connection
const MONGO_URI = 'mongodb+srv://14sunilsunil3_db_user:ylciicYHlYQI17Az@cluster0.xaubrn2.mongodb.net/rewardapp?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Cloud Connected!'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// User Schema & Model
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, unique: true, sparse: true }, // Optional/Unique
  phone: { type: String, unique: true, sparse: true }, // Optional/Unique
  password: { type: String, required: true },
  points: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// 1. Home Route
app.get('/', (req, res) => {
  res.send('Reward App Backend is Running!');
});

// 2. User Signup Endpoint (Email ya Phone me se koi ek ya dono)
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;

    if (!email && !phone) {
      return res.status(400).json({ success: false, message: 'Please provide either Email or Phone number' });
    }

    // Check if already registered
    const query = [];
    if (email) query.push({ email });
    if (phone) query.push({ phone });

    const existingUser = await User.findOne({ $or: query });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email or Phone already registered' });
    }

    const newUser = new User({ username, email: email || undefined, phone: phone || undefined, password });
    await newUser.save();

    res.status(201).json({ success: true, message: 'User created successfully', user: newUser });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. User Login Endpoint (Email ya Phone dono se login ho sakega)
app.post('/api/login', async (req, res) => {
  try {
    const { loginId, password } = req.body; // loginId matlab email ya phone

    const user = await User.findOne({
      $or: [{ email: loginId }, { phone: loginId }],
      password: password
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    res.json({ success: true, message: 'Login successful', user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Update Reward Points
app.post('/api/update-points', async (req, res) => {
  try {
    const { userId, pointsToAdd } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.points += pointsToAdd;
    await user.save();

    res.json({ success: true, message: 'Points updated', newPoints: user.points });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
