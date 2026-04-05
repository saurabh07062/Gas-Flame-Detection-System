const { Schema, model } = require('mongoose');

const readingSchema = new Schema({
  gasLevel: { type: Number, required: true },
  gasPPM: { type: Number },
  flameDetected: { type: Boolean, required: true },
  ssid: String,
  ip: String,
  rssi: Number,
  label: { type: String, enum: ['Normal', 'Smoke', 'LPG'] },
  isTraining: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

module.exports = model('Reading', readingSchema);
