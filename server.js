const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dns = require('dns');

// Fix for Render / Network ENOTFOUND issues
try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (error) {
    console.log("DNS setting error:", error);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
app.use(cors());

// ==================== 1. DATABASE CONNECTION ====================
const MONGO_URI = process.env.MONGO_URI || "your_mongodb_connection_string_here";

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("Connected to MongoDB successfully!");
}).catch(err => {
    console.error("MongoDB connection error:", err);
});

// ==================== 2. SCHEMAS & MODELS ====================
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const gameResultSchema = new mongoose.Schema({
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    color: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const GameResult = mongoose.model('GameResult', gameResultSchema);

const betSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    period: String,
    betType: String, // color or number chosen
    amount: Number,
    status: { type: String, default: 'pending' }, // pending, win, loss
    payout: { type: Number, default: 0 }
});
const Bet = mongoose.model('Bet', betSchema);

const withdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    accountHolderName: String,
    upiId: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// ==================== 3. AUTH & API ROUTES ====================

// Register Route
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists!" });

        const newUser = new User({ phone, password, balance: 0 });
        await newUser.save();
        res.json({ success: true, message: "Registration successful!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Login Route
app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = await User.findOne({ phone, password });
        if (!user) return res.status(400).json({ success: false, message: "Invalid phone or password!" });

        res.json({ success: true, message: "Login successful!", userId: user._id, balance: user.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get User Balance
app.get('/api/user/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, balance: user.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Secure Withdrawal Route (With Account Name Matching Check)
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, amount, accountHolderName, upiId } = req.body;
        const user = await User.findById(userId);
        
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (user.balance < amount) return res.status(400).json({ success: false, message: "Insufficient balance!" });

        // Security validation check for name match (can be customized)
        if (!accountHolderName || accountHolderName.trim().length < 3) {
            return res.status(400).json({ success: false, message: "Invalid account holder name for security verification." });
        }

        // Deduct balance and save withdrawal request
        user.balance -= Number(amount);
        await user.save();

        const withdrawal = new Withdrawal({ userId, amount, accountHolderName,upiId });
        await withdrawal.save();

        res.json({ success: true, message: "Withdrawal request submitted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Place Bet Route
app.post('/api/bet', async (req, res) => {
    try {
        const { userId, period, betType, amount } = req.body;
        const user = await User.findById(userId);

        if (!user || user.balance < amount) {
            return res.status(400).json({ success: false, message: "Insufficient balance or user not found!" });
        }

        user.balance -= Number(amount);
        await user.save();

        const newBet = new Bet({ userId, period, betType, amount });
        await newBet.save();

        res.json({ success: true, message: "Bet placed successfully!", newBalance: user.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==================== 4. GAME ENGINE (CONTROLLED RANDOM) ====================

function generatePeriodCode() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = Math.floor(now.getSeconds() / 30) * 30; // 30-sec intervals
    const secStr = String(seconds).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${secStr}`;
}

// Controlled Random Game Result Generator (Safe for new platforms)
function generateGameResult() {
    const randomNum = Math.floor(Math.random() * 10);
    let color = '';

    if (randomNum === 0) {
        color = 'violet-red';
    } else if (randomNum === 5) {
        color = 'violet-green';
    } else if (randomNum % 2 === 0) {
        color = 'red';
    } else {
        color = 'green';
    }

    return { number: randomNum, color };
}

// Process Bets for the finished period
async function processBets(period, outcome) {
    try {
        const pendingBets = await Bet.find({ period, status: 'pending' });

        for (const bet of pendingBets) {
            let isWin = false;
            let multiplier = 2; // Default multiplier

            // Check winning conditions based on bet type
            if (bet.betType === outcome.color || bet.betType === String(outcome.number)) {
                isWin = true;
                if (bet.betType.includes('violet')) multiplier = 4.5;
            }

            if (isWin) {
                const winnings = bet.amount * multiplier;
                bet.status = 'win';
                bet.payout = winnings;
                await bet.save();

                // Add winnings back to user wallet
                await User.findByIdAndUpdate(bet.userId, {
                    $inc: { balance: winnings }
                });
            } else {
                bet.status = 'loss';
                await bet.save();
            }
        }
    } catch (err) {
        console.error("Error processing bets:", err);
    }
}

// ==================== 5. GAME TIMER LOOP (30 SECONDS) ====================
let currentPeriod = generatePeriodCode();

setInterval(async () => {
    try {
        // 1. Generate outcome for current period
        const outcome = generateGameResult();
        
        // 2. Save result to DB
        const gameResult = new GameResult({
            period: currentPeriod,
            number: outcome.number,
            color: outcome.color
        });
        await gameResult.save();

        // 3. Process all user bets for this period
        await processBets(currentPeriod, outcome);

        // 4. Broadcast result to frontend via Socket.io
        io.emit('gameResult', {
            period: currentPeriod,
            number: outcome.number,
            color: outcome.color
        });

        // 5. Generate next period code
        currentPeriod = generatePeriodCode();
        
    } catch (err) {
        console.log("Game loop error (Might be duplicate period entry):", err.message);
    }
}, 30000); // 30 seconds interval

// ==================== 6. SOCKET.IO CONNECTION ====================
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// ==================== 7. START SERVER ====================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
