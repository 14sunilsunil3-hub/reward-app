const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dns = require('dns');
const crypto = require('crypto');

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
app.use(express.static('public'));

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
    rewardCoins: { type: Number, default: 0 }, 
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const gameResultSchema = new mongoose.Schema({
    timerType: { type: String, default: '30s' }, 
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    color: { type: String, required: true },
    size: { type: String },
    createdAt: { type: Date, default: Date.now }
});
const GameResult = mongoose.model('GameResult', gameResultSchema);

const betSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timerType: { type: String, default: '30s' },
    period: String,
    betType: String, 
    betValue: String, 
    amount: Number,
    status: { type: String, default: 'pending' }, 
    payout: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
const Bet = mongoose.model('Bet', betSchema);

// Manual Admin Override Schema for Risk Control
const manualOverrideSchema = new mongoose.Schema({
    period: { type: String, required: true, unique: true },
    number: { type: Number, required: true },
    used: { type: Boolean, default: false }
});
const ManualOverride = mongoose.model('ManualOverride', manualOverrideSchema);

const withdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    accountHolderName: String,
    upiId: String,
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// ==================== 3. PROFESSIONAL PERIOD & SEEDED ENGINE ====================
const periodCounters = {
    '30s': 1000,
    '60s': 2000,
    '3m':  3000,
    '5m':  5000
};

function generatePeriodCode(timerType) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    // Normalize timerType key (handling both '60s' and '1m')
    let key = timerType === '60s' ? '1m' : timerType;
    if (!periodCounters[key]) periodCounters[key] = 1000;
    periodCounters[key]++;
    
    let gamePrefix = '1';
    if (key === '1m') gamePrefix = '2';
    if (timerType === '3m') gamePrefix = '3';
    if (timerType === '5m') gamePrefix = '5';

    return `${year}${month}${day}${gamePrefix}${periodCounters[key]}`;
}

const gameStates = {
    '30s': { countdown: 30, isBettingOpen: true, period: generatePeriodCode('30s') },
    '60s': { countdown: 60, isBettingOpen: true, period: generatePeriodCode('60s') },
    '3m':  { countdown: 180, isBettingOpen: true, period: generatePeriodCode('3m') },
    '5m':  { countdown: 300, isBettingOpen: true, period: generatePeriodCode('5m') }
};

// ==================== 4. AUTH & API ROUTES ====================

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
            rewardCoins: user.rewardCoins, 
            user: { _id: user._id, identifier: user.phone, points: user.balance, rewardCoins: user.rewardCoins } 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, balance: user.balance, rewardCoins: user.rewardCoins });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/convert-coins', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        const conversionRate = 100;
        if (user.rewardCoins < conversionRate) {
            return res.status(400).json({ success: false, message: `Kam se kam ${conversionRate} coins hone chahiye!` });
        }

        const rupeesEarned = Math.floor(user.rewardCoins / conversionRate);
        user.rewardCoins -= rupeesEarned * conversionRate;
        user.balance += rupeesEarned;
        await user.save();

        res.json({ success: true, message: `Converted successfully to ₹${rupeesEarned}!`, balance: user.balance, rewardCoins: user.rewardCoins });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/add-reward-coins', async (req, res) => {
    try {
        const { userId, coins } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        user.rewardCoins += Number(coins) || 50;
        await user.save();
        res.json({ success: true, message: "Coins added!", rewardCoins: user.rewardCoins });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, amount, accountHolderName, upiId } = req.body;
        const user = await User.findById(userId);
        
        if (!user) return res.status(404).json({ success: false, message: "User not found" });
        if (user.balance < amount) return res.status(400).json({ success: false, message: "Insufficient balance!" });

        user.balance -= Number(amount);
        await user.save();

        const withdrawal = new Withdrawal({ userId, amount, accountHolderName, upiId });
        await withdrawal.save();

        res.json({ success: true, message: "Withdrawal request submitted!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin Manual Override Route (Risk Control)
app.post('/api/admin/set-result', async (req, res) => {
    try {
        const { period, number } = req.body;
        if (!period || number === undefined) {
            return res.status(400).json({ success: false, message: "Period and number are required!" });
        }

        await ManualOverride.findOneAndUpdate(
            { period },
            { number: Number(number), used: false },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: `Manual override set for period ${period} with winning number ${number}` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin API to check current period bets and total amounts (Live Pool Monitor)
app.get('/api/admin/current-bets/:timerType/:period', async (req, res) => {
    try {
        const { timerType, period } = req.params;
        const bets = await Bet.find({ timerType, period }).populate('userId', 'phone');
        
        const summary = {
            green: 0, red: 0, violet: 0, big: 0, small: 0,
            numbers: Array(10).fill(0),
            totalPool: 0,
            totalBetsCount: bets.length
        };

        bets.forEach(bet => {
            const amt = Number(bet.amount) || 0;
            summary.totalPool += amt;
            if (bet.betType === 'color') {
                if (summary[bet.betValue] !== undefined) summary[bet.betValue] += amt;
            } else if (bet.betType === 'size') {
                if (summary[bet.betValue] !== undefined) summary[bet.betValue] += amt;
            } else if (bet.betType === 'number') {
                const numIdx = parseInt(bet.betValue);
                if (!isNaN(numIdx)) summary.numbers[numIdx] += amt;
            }
        });

        res.json({ success: true, summary, bets });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Game History API (Crucial for frontend table)
app.get('/api/game-history/:timerType', async (req, res) => {
    try {
        const { timerType } = req.params;
        const history = await GameResult.find({ timerType }).sort({ _id: -1 }).limit(20);
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// User Bet History API
app.get('/api/my-bets/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const bets = await Bet.find({ userId }).sort({ _id: -1 }).limit(20);
        res.json({ success: true, bets });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Primary Color Game Betting Endpoint (Matching HTML Frontend)
app.post('/api/color-game', async (req, res) => {
    try {
        const { userId, betType, betValue, betAmount, timerType = '30s' } = req.body;
        const amount = Number(betAmount);

        if (!gameStates[timerType] || !gameStates[timerType].isBettingOpen) {
            return res.status(400).json({ success: false, error: "Betting is closed for this period!" });
        }

        const user = await User.findById(userId);
        if (!user || user.balance < amount) {
            return res.status(400).json({ success: false, error: "Insufficient balance or user not found!" });
        }

        // Real money wallet deduction
        user.balance -= amount;
        await user.save();

        const currentPeriod = gameStates[timerType].period;

        const newBet = new Bet({ 
            userId, 
            timerType, 
            period: currentPeriod, 
            betType, 
            betValue, 
            amount 
        });
        await newBet.save();

        const history = await GameResult.find({ timerType }).sort({ _id: -1 }).limit(10);

        res.json({ 
            success: true, 
            message: `Bet placed successfully for ₹${amount}!`, 
            balance: user.balance, 
            points: user.balance, 
            periodId: currentPeriod,
            history
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// General Bet Route supporting all timer types
app.post('/api/bet', async (req, res) => {
    try {
        const { userId, timerType = '30s', period, betType, betValue, amount } = req.body;
        
        if (!gameStates[timerType] || !gameStates[timerType].isBettingOpen) {
            return res.status(400).json({ success: false, message: "Betting is closed for this period!" });
        }

        const user = await User.findById(userId);
        if (!user || user.balance < Number(amount)) {
            return res.status(400).json({ success: false, message: "Insufficient balance or user not found!" });
        }

        user.balance -= Number(amount);
        await user.save();

        const newBet = new Bet({ userId, timerType, period, betType, betValue, amount });
        await newBet.save();

        res.json({ success: true, message: "Bet placed successfully!", newBalance: user.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==================== 5. SEEDED GAME ENGINE & PROCESSORS ====================

async function getGameOutcome(period, timerType) {
    const override = await ManualOverride.findOne({ period, used: false });
    let randomNum;

    if (override) {
        randomNum = override.number;
        override.used = true;
        await override.save();
        console.log(`⚠️ Manual Override Used for Period ${period}: Number ${randomNum}`);
    } else {
        const hash = crypto.createHash('sha256').update(period + timerType).digest('hex');
        randomNum = parseInt(hash.substring(0, 8), 16) % 10;
    }

    let color = 'green';
    if ([2, 4, 6, 8].includes(randomNum)) color = 'red';
    else if ([0, 5].includes(randomNum)) color = 'violet';
    const size = randomNum >= 5 ? 'big' : 'small';

    return { number: randomNum, color, size };
}

async function processBetsForPeriod(period, timerType, outcome) {
    try {
        const pendingBets = await Bet.find({ period, timerType, status: 'pending' });

        for (const bet of pendingBets) {
            let isWin = false;
            let multiplier = 0;

            if (bet.betType === 'color' && bet.betValue === outcome.color) {
                isWin = true;
                multiplier = outcome.color === 'violet' ? 4.5 : 2;
            } else if (bet.betType === 'size' && bet.betValue === outcome.size) {
                isWin = true;
                multiplier = 1.9;
            } else if (bet.betType === 'number' && Number(bet.betValue) === outcome.number) {
                isWin = true;
                multiplier = 9;
            }

            if (isWin) {
                const winnings = bet.amount * multiplier;
                bet.status = 'win';
                bet.payout = winnings;
                await bet.save();

                await User.findByIdAndUpdate(bet.userId, { $inc: { balance: winnings } });
            } else {
                bet.status = 'loss';
                await bet.save();
            }
        }
    } catch (err) {
        console.error(`Error processing bets for ${timerType}:`, err);
    }
}

// ==================== 6. TIMERS LOOP FOR ALL SECTIONS ====================
function startTimerLoop(timerType, intervalSeconds) {
    setInterval(async () => {
        try {
            const state = gameStates[timerType];
            state.countdown--;

            if (state.countdown === 5) {
                state.isBettingOpen = false;
                io.emit(`bettingStatus_${timerType}`, { isOpen: false, period: state.period });
            }

            if (state.countdown <= 0) {
                const currentPeriod = state.period;
                const outcome = await getGameOutcome(currentPeriod, timerType);

                const existingResult = await GameResult.findOne({ period: currentPeriod });
                if (!existingResult) {
                    const gameResult = new GameResult({
                        timerType,
                        period: currentPeriod,
                        number: outcome.number,
                        color: outcome.color,
                        size: outcome.size
                    });
                    await gameResult.save();
                }

                await processBetsForPeriod(currentPeriod, timerType, outcome);

                io.emit(`gameResult_${timerType}`, {
                    period: currentPeriod,
                    number: outcome.number,
                    color: outcome.color,
                    size: outcome.size
                });
                
                // Generic event for HTML if it listens to single 'gameResult'
                io.emit('gameResult', {
                    period: currentPeriod,
                    number: outcome.number,
                    color: outcome.color,
                    size: outcome.size,
                    timerType
                });

                state.period = generatePeriodCode(timerType);
                state.countdown = intervalSeconds;
                state.isBettingOpen = true;

                io.emit(`bettingStatus_${timerType}`, { isOpen: true, period: state.period });
            }

            io.emit(`timerTick_${timerType}`, { 
                countdown: state.countdown, 
                isBettingOpen: state.isBettingOpen, 
                period: state.period 
            });

            // Generic event for HTML if it listens to single 'timerTick'
            io.emit('timerTick', {
                timerType,
                countdown: state.countdown,
                isBettingOpen: state.isBettingOpen,
                period: state.period
            });

        } catch (err) {
            console.log(`Loop error (${timerType}):`, err.message);
        }
    }, 1000);
}

startTimerLoop('30s', 30);
startTimerLoop('60s', 60);
startTimerLoop('3m', 180);
startTimerLoop('5m', 300);

// ==================== 7. SOCKET.IO CONNECTION ====================
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    ['30s', '60s', '3m', '5m'].forEach(type => {
        socket.emit(`timerTick_${type}`, { 
            countdown: gameStates[type].countdown, 
            isBettingOpen: gameStates[type].isBettingOpen, 
            period: gameStates[type].period 
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// ==================== 8. START SERVER ====================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server fully updated & running smoothly with Admin Bet Monitor on port ${PORT}`);
});
