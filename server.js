const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dns = require('dns');

// Fix for Render / Network DNS issues
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
const MONGO_URI = "mongodb://14sunilsunil3_db_user:7rbOaftd6JUrR9vm@ac-qrcqjqf-shard-00-00.xawbmz2.mongodb.net:27017,ac-qrcqjqf-shard-00-01.xawbmz2.mongodb.net:27017,ac-qrcqjqf-shard-00-02.xawbmz2.mongodb.net:27017/?ssl=true&replicaSet=atlas-ouku4a-shard-0&authSource=admin&appName=Cluster0";

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
    balance: { type: Number, default: 15000 },
    rewardCoins: { type: Number, default: 0 }, // <-- Added Reward Coins field here
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const gameResultSchema = new mongoose.Schema({
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    color: { type: String, required: true },
    size: { type: String },
    createdAt: { type: Date, default: Date.now }
});
const GameResult = mongoose.model('GameResult', gameResultSchema);

const betSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    period: String,
    betType: String, 
    betValue: String, 
    amount: Number,
    status: { type: String, default: 'pending' }, 
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

// Global Variables for Timer & Betting State
let isBettingOpen = true;
let countdownTime = 30;
let currentPeriod = generatePeriodCode();

// ==================== 3. AUTH & API ROUTES ====================

// Register Route
app.post('/api/register', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ success: false, message: "User already exists!" });

        const newUser = new User({ phone, password, balance: 15000, rewardCoins: 0 });
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

        res.json({ 
            success: true, 
            message: "Login successful!", 
            userId: user._id, 
            balance: user.balance,
            rewardCoins: user.rewardCoins, // <-- Sent reward coins to frontend
            user: { _id: user._id, identifier: user.phone, points: user.balance, rewardCoins: user.rewardCoins } 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get User Details (Balance & Coins)
app.get('/api/user/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, balance: user.balance, rewardCoins: user.rewardCoins });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Convert Coins to Money Route
app.post('/api/convert-coins', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const conversionRate = 100; // 100 Coins = ₹1

        if (user.rewardCoins < conversionRate) {
            return res.status(400).json({ 
                success: false, 
                message: `Kam se kam ${conversionRate} coins hone chahiye convert karne ke liye!` 
            });
        }

        const rupeesEarned = Math.floor(user.rewardCoins / conversionRate);
        const coinsToDeduct = rupeesEarned * conversionRate;

        user.rewardCoins -= coinsToDeduct;
        user.balance += rupeesEarned;
        await user.save();

        res.json({
            success: true,
            message: `Successfully converted ${coinsToDeduct} coins into ₹${rupeesEarned}!`,
            balance: user.balance,
            rewardCoins: user.rewardCoins
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Test Route to add coins when user watches an ad
app.post('/api/add-reward-coins', async (req, res) => {
    try {
        const { userId, coins } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const addCoins = Number(coins) || 50; 
        user.rewardCoins += addCoins;
        await user.save();

        res.json({ success: true, message: `Added ${addCoins} coins successfully!`, rewardCoins: user.rewardCoins });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Secure Withdrawal Route
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, amount, accountHolderName, upiId } = req.body;
        const user = await User.findById(userId);
        
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (user.balance < amount) return res.status(400).json({ success: false, message: "Insufficient balance!" });

        if (!accountHolderName || accountHolderName.trim().length < 3) {
            return res.status(400).json({ success: false, message: "Invalid account holder name for security verification." });
        }

        user.balance -= Number(amount);
        await user.save();

        const withdrawal = new Withdrawal({ userId, amount, accountHolderName, upiId });
        await withdrawal.save();

        res.json({ success: true, message: "Withdrawal request submitted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Pro Color Game Bet & Play Route (Added Betting Open Check)
app.post('/api/color-game', async (req, res) => {
    try {
        if (!isBettingOpen) {
            return res.status(400).json({ success: false, error: "Betting is closed for this period! Please wait for the next round." });
        }

        const { userId, betType, betValue, betAmount, timerType } = req.body;
        const user = await User.findById(userId);

        if (!user) return res.status(404).json({ success: false, error: "User not found" });
        const amount = Number(betAmount);
        if (user.balance < amount) return res.status(400).json({ success: false, error: "Insufficient balance!" });

        user.balance -= amount;

        const winningNum = Math.floor(Math.random() * 10);
        const winningSize = winningNum >= 5 ? 'big' : 'small';
        let winningColor = 'green';
        if ([2, 4, 6, 8].includes(winningNum)) winningColor = 'red';
        else if ([0, 5].includes(winningNum)) winningColor = 'violet';

        let isWin = false;
        let payoutMultiplier = 0;

        if (betType === 'color') {
            if (betValue === winningColor) {
                isWin = true;
                payoutMultiplier = 2;
            }
        } else if (betType === 'size') {
            if (betValue === winningSize) {
                isWin = true;
                payoutMultiplier = 1.9;
            }
        } else if (betType === 'number') {
            if (Number(betValue) === winningNum) {
                isWin = true;
                payoutMultiplier = 3;
            }
        }

        let winnings = 0;
        if (isWin) {
            winnings = amount * payoutMultiplier;
            user.balance += winnings;
        }

        await user.save();

        const periodId = generatePeriodCode();
        
        const newResult = new GameResult({
            period: periodId,
            number: winningNum,
            color: winningColor,
            size: winningSize
        });
        await newResult.save().catch(() => {});

        const history = await GameResult.find().sort({ _id: -1 }).limit(10);

        res.json({
            success: isWin,
            message: isWin ? `🎉 You Won ${winnings} coins!` : `❌ You Lost ${amount} coins. Winning number was ${winningNum}`,
            balance: user.balance,
            points: user.balance,
            periodId,
            history: history.map(h => ({ period: h.period, number: h.number, size: h.size || (h.number >= 5 ? 'big' : 'small'), color: h.color }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/bet', async (req, res) => {
    try {
        if (!isBettingOpen) {
            return res.status(400).json({ success: false, message: "Betting is closed for this period!" });
        }

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

// ==================== 4. GAME ENGINE ====================

function generatePeriodCode() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = Math.floor(now.getSeconds() / 30) * 30; 
    const secStr = String(seconds).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${secStr}`;
}

function generateGameResult() {
    const randomNum = Math.floor(Math.random() * 10);
    let color = 'green';
    if ([2, 4, 6, 8].includes(randomNum)) color = 'red';
    else if ([0, 5].includes(randomNum)) color = 'violet';
    const size = randomNum >= 5 ? 'big' : 'small';

    return { number: randomNum, color, size };
}

async function processBets(period, outcome) {
    try {
        const pendingBets = await Bet.find({ period, status: 'pending' });

        for (const bet of pendingBets) {
            let isWin = false;
            let multiplier = 2;

            if (bet.betType === outcome.color || bet.betType === String(outcome.number)) {
                isWin = true;
                if (bet.betType.includes('violet')) multiplier = 4.5;
            }

            if (isWin) {
                const winnings = bet.amount * multiplier;
                bet.status = 'win';
                bet.payout = winnings;
                await bet.save();

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

// ==================== 5. GAME TIMER LOOP (1s Interval with 5s Lock) ====================
setInterval(async () => {
    try {
        countdownTime--;

        // Jab 5 seconds bachein, tab betting close kar do
        if (countdownTime === 5) {
            isBettingOpen = false;
            io.emit('bettingStatus', { isOpen: false, message: "Betting closed for this period!" });
        }

        // Jab timer 0 ho jaye, tab result process karein
        if (countdownTime <= 0) {
            const outcome = generateGameResult();
            
            const existingResult = await GameResult.findOne({ period: currentPeriod });
            if (!existingResult) {
                const gameResult = new GameResult({
                    period: currentPeriod,
                    number: outcome.number,
                    color: outcome.color,
                    size: outcome.size
                });
                await gameResult.save();
            }

            await processBets(currentPeriod, outcome);

            io.emit('gameResult', {
                period: currentPeriod,
                number: outcome.number,
                color: outcome.color,
                size: outcome.size
            });

            // Naya period start karein aur timer reset karein
            currentPeriod = generatePeriodCode();
            countdownTime = 30;
            isBettingOpen = true;

            io.emit('bettingStatus', { isOpen: true, period: currentPeriod });
        }

        // Har second timer tick sabhi clients ko bhejo
        io.emit('timerTick', { countdown: countdownTime, isBettingOpen });

    } catch (err) {
        console.log("Game loop error:", err.message);
    }
}, 1000); 

// ==================== 6. SOCKET.IO CONNECTION ====================
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Naye connect hone wale user ko turant current timer status bhej do
    socket.emit('timerTick', { countdown: countdownTime, isBettingOpen });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// ==================== 7. START SERVER ====================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
