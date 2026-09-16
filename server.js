const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dns = require('dns');

// Fixes Render DNS ENOTFOUND issue permanently by using Google DNS
dns.setServers(['8.8.8.8', '1.1.1.1']);

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('.'));

const MONGO_URI = 'mongodb+srv://14sunilsunil3_db_user:G2tvsEmVz3A8QCo7@cluster0.xawhra2.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI, { family: 4 })
  .then(() => console.log('MongoDB Cloud Connected!'))
  .catch(err => console.log('MongoDB Connection Error:', err));

// Unique ID generator helper
function generateUID() {
  return 'UID' + Math.floor(100000 + Math.random() * 900000);
}

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  uid: { type: String, unique: true, default: generateUID },
  username: { type: String, default: 'User' },
  profilePic: { type: String, default: 'https://api.dicebear.com/7.x/bottts/svg?seed=avatar1' },
  password: { type: String, default: '' },
  points: { type: Number, default: 10 },
  otp: { type: String, default: '' },
  lastDailyLogin: { type: String, default: '' },
  referredBy: { type: String, default: '' },
  withdrawals: [
    {
      method: String,
      details: Object,
      amount: Number,
      status: { type: String, default: 'Pending' },
      date: { type: Date, default: Date.now }
    }
  ]
});

const User = mongoose.model('User', userSchema);

// Send OTP
app.post('/api/send-otp', async (req, res) => {
  try {
    const { phone, isSignup } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    let user = await User.findOne({ phone });
    if (isSignup && user) {
      return res.status(400).json({ error: 'This mobile number is already registered!' });
    }
    if (!isSignup && !user) {
      return res.status(404).json({ error: 'Mobile number not found. Please register first.' });
    }

    const mockOtp = Math.floor(100000 + Math.random() * 900000).toString();
    if (!user) {
      user = new User({ phone, otp: mockOtp, username: 'User_' + phone.slice(-4) });
    } else {
      user.otp = mockOtp;
    }
    await user.save();
    res.status(200).json({ message: 'OTP sent successfully!', otp: mockOtp });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send OTP', details: err.message });
  }
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { phone, password, otp, refCode } = req.body;
    let user = await User.findOne({ phone });
    if (!user || user.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP or phone number' });
    }

    user.password = password;
    user.otp = undefined;
    user.points = 10;

    if (refCode) {
      const referrer = await User.findOne({ uid: refCode });
      if (referrer && referrer.phone !== phone) {
        referrer.points += 1000; 
        await referrer.save();
        user.referredBy = refCode;
      }
    }

    await user.save();
    res.status(201).json({ message: 'Registered successfully!', user });
  } catch (err) {
    res.status(400).json({ error: 'Registration failed', details: err.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid mobile number or password' });
    }
    res.status(200).json({ message: 'Login successful!', user });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Reset Password
app.post('/api/reset-password', async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;
    const user = await User.findOne({ phone });
    if (!user || user.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP or mobile number' });
    }
    user.password = newPassword;
    user.otp = undefined;
    await user.save();
    res.status(200).json({ message: 'Password reset successful!' });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Update Profile
app.post('/api/update-profile', async (req, res) => {
  try {
    const { userId, username, profilePic } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (username) user.username = username;
    if (profilePic) user.profilePic = profilePic;
    await user.save();

    res.status(200).json({ message: 'Profile updated', user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile', details: err.message });
  }
});

// Daily Login
app.post('/api/daily-login', async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const today = new Date().toISOString().slice(0, 10);
    if (user.lastDailyLogin === today) {
      return res.status(400).json({ error: 'Already claimed today!' });
    }

    user.lastDailyLogin = today;
    user.points += 20;
    await user.save();
    res.status(200).json({ message: 'Daily bonus claimed!', points: user.points });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Points Update
app.post('/api/points', async (req, res) => {
  try {
    const { userId, pointsToAdd } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.points += Number(pointsToAdd) || 0;
    await user.save();
    res.status(200).json({ message: 'Points updated', points: user.points });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update points', details: err.message });
  }
});

// Withdrawal
app.post('/api/withdraw', async (req, res) => {
  try {
    const { userId, method, details, amount } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (amount < 10000) return res.status(400).json({ error: 'Minimum withdrawal is 10,000 Coins!' });
    if (amount > 1000000) return res.status(400).json({ error: 'Maximum withdrawal is 1,000,000 Coins!' });
    if (user.points < amount) return res.status(400).json({ error: 'Insufficient coin balance!' });

    const newHolderName = (details.holderName || '').trim().toLowerCase();
    if (!newHolderName) return res.status(400).json({ error: 'Account holder name is required!' });

    if (user.withdrawals.length > 0) {
      const firstWithdrawal = user.withdrawals[0];
      const existingHolderName = (firstWithdrawal.details.holderName || '').trim().toLowerCase();
      if (existingHolderName && existingHolderName !== newHolderName) {
        return res.status(400).json({ error: `Security Error: Name mismatch with first withdrawal!` });
      }
    }

    user.points -= amount;
    user.withdrawals.push({ method, details, amount, status: 'Pending' });
    await user.save();

    res.status(200).json({ message: 'Withdrawal requested successfully!', user });
  } catch (err) {
    res.status(500).json({ error: 'Withdrawal failed', details: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
