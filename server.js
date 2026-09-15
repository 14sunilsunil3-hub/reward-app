const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('.')); // Yeh line static HTML file serve karne ke liye hai

// MongoDB Connection String
const MONGO_URI = "mongodb+srv://14sunilsunil3_db_user:YYKnpJ6cUOxedvyW@cluster0.xawbrm2.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
.then(() => console.log('MongoDB Cloud Connected!'))
.catch((err) => console.log('MongoDB Connection Error:', err));

// Updated User Schema (Mobile, Password, OTP, Points, Referrals, Withdrawals)
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    points: { type: Number, default: 0 },
    otp: { type: String },
    lastDailyLogin: { type: String, default: '' }, // Format: YYYY-MM-DD
    referralCount: { type: Number, default: 0 },
    lastSpinDate: { type: Date },
    withdrawals: [
        {
            method: String, // 'UPI', 'Bank', 'GooglePlay'
            details: String,
            amount: Number,
            status: { type: String, default: 'Pending' },
            date: { type: Date, default: Date.now }
        }
    ]
});

const User = mongoose.model('User', userSchema);

// 1. Send / Generate OTP Route (For Signup & Forgot Password)
app.post('/api/send-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone number is required' });

        // Generate a 6-digit random OTP
        const mockOtp = Math.floor(100000 + Math.random() * 900000).toString();

        let user = await User.findOne({ phone });
        if (!user) {
            user = new User({ phone, password: '', otp: mockOtp });
        } else {
            user.otp = mockOtp;
        }
        await user.save();

        res.status(200).json({ message: 'OTP sent successfully!', otp: mockOtp });
    } catch (err) {
        res.status(500).json({ error: 'Failed to send OTP', details: err.message });
    }
});

// 2. Register Route (Mobile + Password + 6-digit OTP verification)
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password, otp } = req.body;
        
        if (!phone || !password || !otp) {
            return res.status(400).json({ error: 'All fields (phone, password, otp) are required' });
        }

        let user = await User.findOne({ phone });
        if (!user || user.otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP or phone number' });
        }

        user.password = password;
        user.otp = undefined; // Clear OTP after use
        user.points = 10; // Signup bonus
        await user.save();

        res.status(201).json({ message: 'User registered successfully!', user });
    } catch (err) {
        res.status(400).json({ error: 'Registration failed. Number might already exist.', details: err.message });
    }
});

// 3. Login Route (Mobile + Password)
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ error: 'Please provide mobile number and password' });
        }

        const user = await User.findOne({ phone });
        if (!user || user.password !== password) {
            return res.status(401).json({ error: 'Invalid mobile number or password' });
        }

        res.status(200).json({ message: 'Login successful!', user });
    } catch (err) {
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

// 4. Forgot Password Route
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { phone, otp, newPassword } = req.body;
        const user = await User.findOne({ phone });

        if (!user || user.otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        user.password = newPassword;
        user.otp = undefined;
        await user.save();

        res.status(200).json({ message: 'Password updated successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset password', details: err.message });
    }
});

// 5. Daily Login Reward Route
app.post('/api/daily-login', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        if (user.lastDailyLogin === today) {
            return res.status(400).json({ error: 'Daily reward already claimed today!' });
        }

        user.lastDailyLogin = today;
        user.points += 20; // Daily bonus points
        await user.save();

        res.status(200).json({ message: 'Daily reward claimed!', points: user.points });
    } catch (err) {
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

// 6. Lucky Wheel Spin Route (Requires 10 referrals in 24h)
app.post('/api/spin-wheel', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.referralCount < 10) {
            return res.status(400).json({ error: 'You need to refer 10 users in 24 hours to spin the wheel!' });
        }

        const rewards = [10, 25, 50, 100, 150, 200];
        const wonPoints = rewards[Math.floor(Math.random() * rewards.length)];

        user.points += wonPoints;
        user.referralCount = 0; 
        await user.save();

        res.status(200).json({ message: `Congratulations! You won ${wonPoints} points!`, points: user.points });
    } catch (err) {
        res.status(500).json({ error: 'Spin failed', details: err.message });
    }
});

// 7. Points Update Route (For Ad Watching, etc.)
app.post('/api/points', async (req, res) => {
    try {
        const { userId, pointsToAdd } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.points += Number(pointsToAdd) || 0;
        await user.save();

        res.status(200).json({ message: 'Points updated successfully', points: user.points });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update points', details: err.message });
    }
});

// 8. Withdrawal Request Route
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, method, details, amount } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.points < amount) {
            return res.status(400).json({ error: 'Insufficient points for withdrawal!' });
        }

        user.points -= amount;
        user.withdrawals.push({ method, details, amount, status: 'Pending' });
        await user.save();

        res.status(200).json({ message: 'Withdrawal request submitted successfully!', user });
    } catch (err) {
        res.status(500).json({ error: 'Withdrawal failed', details: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
