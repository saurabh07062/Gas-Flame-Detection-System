const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const Reading = require('./models/reading');
const { RandomForestClassifier } = require('ml-random-forest');

// Connect to MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/gas_detection')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Connection Error:', err));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Store latest readings
let latestData = {
  gasLevel: 0,
  flameDetected: false,
  timestamp: Date.now()
};

let shouldRecalibrate = false; // Flag to tell ESP32 to reset baseline


let lastDevicePing = 0;
const DEVICE_TIMEOUT_MS = 5000;

// API endpoint for physical ESP32 to send data
app.post('/api/sensor-data', async (req, res) => {
  const { gasLevel, flameDetected, ssid, ip, rssi, rawLevel } = req.body;
  console.log(`[DATA] Gas: ${gasLevel} (Raw: ${rawLevel}) | Flame: ${flameDetected} | IP: ${ip}`);


  if (gasLevel !== undefined && flameDetected !== undefined) {
    latestData = {
      gasLevel,
      flameDetected,
      rawLevel,
      ssid,
      ip,
      rssi,
      timestamp: Date.now()
    };

    lastDevicePing = Date.now();

    // AI Prediction if model is active
    let aiPrediction = 'Unknown';
    if (aiModel) {
        aiPrediction = aiModel.predict([[gasLevel]])[0];
    }

    // Save to MongoDB automatically
    try {
        const newReading = new Reading({
            gasLevel,
            flameDetected,
            ssid,
            ip,
            rssi,
            timestamp: Date.now()
        });
        await newReading.save();
        console.log(`[DATA] Labeled & Saved: Gas ${gasLevel} | Flame ${flameDetected}`);

        // EMIT REAL-TIME DATA TO DASHBOARD (CRITICAL FIX)
        io.emit('sensor-data', { 
            ...latestData, 
            isDeviceConnected: true, 
            aiPrediction 
        });
    } catch (dbErr) {
        console.error('[DB ERROR] Failed to save reading:', dbErr.message);
    }
    
    res.status(200).json({ 
        success: true, 
        message: 'Data received & saved',
        recalibrate: shouldRecalibrate 
    });
    
    // Reset flag after sending it to ESP32
    if (shouldRecalibrate) shouldRecalibrate = false;
  } else {
    res.status(400).json({ success: false, message: 'Missing parameters' });
  }
});

// Endpoint to trigger recalibration from dashboard
app.post('/api/recalibrate', (req, res) => {
    console.log('[SYSTEM] Recalibration requested by dashboard...');
    shouldRecalibrate = true;
    res.json({ success: true, message: 'Recalibration signal queued' });
});


// Optional endpoint to fetch latest data (debug)
app.get('/api/latest', (req, res) => {
  res.json({ success: true, latestData });
});

let aiModel = null;
const LABEL_MAP = { 'Normal': 0, 'Smoke': 1, 'LPG': 2 };
const REVERSE_LABEL_MAP = { 0: 'Normal', 1: 'Smoke', 2: 'LPG' };

// Endpoint to save labeled training data
app.post('/api/train-data', async (req, res) => {
  const { gasLevel, label } = req.body;
  try {
    const newReading = new Reading({
      gasLevel,
      flameDetected: latestData.flameDetected,
      label,
      isTraining: true,
      timestamp: Date.now()
    });
    await newReading.save();
    console.log(`[AI] Saved training sample: ${label} (ADC: ${gasLevel})`);
    res.json({ success: true, message: 'Sample saved' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint to train the model from saved data
app.post('/api/train-model', async (req, res) => {
  try {
    const samples = await Reading.find({ isTraining: true });
    if (samples.length < 5) {
      return res.status(400).json({ success: false, message: 'Not enough data (min 5 samples)' });
    }

    const trainingData = samples.map(s => [s.gasLevel]);
    const labels = samples.map(s => LABEL_MAP[s.label] || 0); // Convert strings to numbers
    
    aiModel = new RandomForestClassifier({ nEstimators: 10 });
    aiModel.train(trainingData, labels);
    
    console.log('[AI] Model trained successfully!');
    res.json({ success: true, message: 'Model trained with ' + samples.length + ' samples' });
  } catch (err) {
    console.error('[AI] Training Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

let mockGasLevel = 22;

// API endpoint to trigger a temporary mock hazard
app.post('/api/simulate-hazard', (req, res) => {
    console.log('[MOCK] Triggering simulated hazard...');
    mockGasLevel = 2000; // Trigger spike
    res.json({ success: true, message: 'Hazard simulation started' });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Send current data on connection
  const isDeviceConnected = (Date.now() - lastDevicePing) < DEVICE_TIMEOUT_MS;
  
  // AI Prediction if model is active
  let aiPrediction = 'Waiting for Model...';
  if (aiModel) {
      const predIndex = Math.round(aiModel.predict([[latestData.gasLevel]])[0]);
      aiPrediction = REVERSE_LABEL_MAP[predIndex] || 'Unknown';
  }

  socket.emit('sensor-data', { ...latestData, isDeviceConnected, aiPrediction });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const MOCK_DATA = process.env.MOCK === 'true';

if (MOCK_DATA) {
  console.log('Mock Data Generator starting...');
  
  setInterval(() => {
    // Generate realistic fluctuating data (Normal range: 20-40)
    // Decreases slowly if spiked
    if (mockGasLevel > 60) {
        mockGasLevel *= 0.85; // Decay
    } else {
        mockGasLevel = Math.max(15, mockGasLevel + (Math.random() * 6 - 3));
    }
    
    let mockFlame = false;
    if (mockGasLevel > 1200) {
      mockFlame = true; // High gas or random fire
    }

    // Dummy WiFi info for mock mode
    latestData = {
      gasLevel: Math.round(mockGasLevel),
      flameDetected: mockFlame,
      ssid: "MOCK_WIFI_NETWORK",
      ip: "192.168.1.50",
      rssi: Math.round(-40 - Math.random() * 30),
      timestamp: Date.now()
    };

    // AI Prediction for Mock Data
    let aiPrediction = 'Unknown';
    if (aiModel) {
        const predIndex = Math.round(aiModel.predict([[Math.round(mockGasLevel)]])[0]);
        aiPrediction = REVERSE_LABEL_MAP[predIndex] || 'Unknown';
    }
    
    // In mock mode, we simulate that the device is always connected
    io.emit('sensor-data', { ...latestData, isDeviceConnected: true, aiPrediction });
  }, 2000);
} else {
  // Production mode: Check for hardware disconnection every 2 seconds
  setInterval(() => {
    if (lastDevicePing > 0 && (Date.now() - lastDevicePing) > DEVICE_TIMEOUT_MS) {
      // Device timed out!
      io.emit('device-status', { isDeviceConnected: false });
    }
  }, 2000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser.`);
});
