const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve frontend from 'public' folder correctly
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection URI with proper credentials and database config
const MONGO_URL = process.env.MONGO_URL || "mongodb+srv://14sunilsunil3_db_user:28ItaGAHc4kinZIQ@cluster0.xawbrz2.mongodb.net/?retryWrites=true&w=majority";

mongoose.connect(MONGO_URL)
.then(() => console.log('MongoDB Cloud Connected!'))
.catch((err) => console.log('MongoDB Connection Error:', err));

// Custom Unique ID generator helper
function generateUID() {
    return 'UID' + Math.floor(100000 + Math.random() * 900000);
}

const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    uid: { type: String, unique: true, default: generateUID },
    username: { type: String, default: 'User' },
    profilePic: { type: String, default: 'https://api.dicebear.com/7.x/bottts/svg?seed=fallback' },
    password: { type: String, default: '' },
    points: { type: Number, default: 0 },
    otp: { type: String },
    lastDailyLogin: { type: String, default: '' },
    referralCount: { type: Number, default: 0 },
    withdrawals: [
        {
            method: String, // 'UPI' or 'Bank'
            details: Object, // UPI ID / Bank details with account info
            amount: Number,
            status: { type: String, default: 'Pending' },
            date: { type: Date, default: Date.now }
        }
    ]
});

const User = mongoose.model('User', userSchema);

// Send OTP Route Example
app.post('/api/send-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone number is required' });

        const mockOtp = Math.floor(100000 + Math.random() * 900000).toString();
        let user = await User.findOne({ phone });
        
        if (!user) {
            user = new User({ phone, otp: mockOtp, username: 'User' });
        } else {
            user.otp = mockOtp;
        }
        
        await user.save();
        res.status(200).json({ message: 'OTP sent successfully', otp: mockOtp });
    } catch (error) {
        console.error('Error in send-otp:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Port configuration for Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
