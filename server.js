const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB Connection String (Apna password daalna na bhulein)
const MONGO_URI = "mongodb+srv://14sunilsunil3_db_user:APNA_PASSWORD_YAHAN_DAALEIN@cluster0.xawbrm2.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
.then(() => console.log('MongoDB Cloud Connected!'))
.catch((err) => console.log('MongoDB Connection Error:', err));

// User Schema (Email or Phone as optional/unique login identifiers)
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true, sparse: true },
    phone: { type: String, unique: true, sparse: true },
    password: { type: String, required: true },
    points: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);

// Register Route
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        
        // Ensure at least email or phone is provided
        if (!email && !phone) {
            return res.status(400).json({ error: 'Either email or phone is required' });
        }

        const newUser = new User({
            name,
            email: email || undefined,
            phone: phone || undefined,
            password,
            points: 10 // Starting signup bonus points
        });

        await newUser.save();
        res.status(201).json({ message: 'User registered successfully!', user: newUser });
    } catch (err) {
        res.status(400).json({ error: 'Registration failed. Email or Phone might already exist.', details: err.message });
    }
});

// Login Route (Supports login via Email or Phone using $or)
app.post('/api/login', async (req, res) => {
    try {
        const { loginId, password } = req.body; // loginId can be email or phone

        if (!loginId || !password) {
            return res.status(400).json({ error: 'Please provide login ID and password' });
        }

        const user = await User.findOne({
            $or: [
                { email: loginId },
                { phone: loginId }
            ]
        });

        if (!user || user.password !== password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        res.status(200).json({ message: 'Login successful!', user });
    } catch (err) {
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

// Points Tracking / Update Route
app.post('/api/points', async (req, res) => {
    try {
        const { userId, pointsToAdd } = req.body;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.points += Number(pointsToAdd) || 0;
        await user.save();

        res.status(200).json({ message: 'Points updated successfully', points: user.points });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update points', details: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
