document.addEventListener('DOMContentLoaded', () => {
    // Standard relative connection
    const socket = io();
    
    // UI Elements
    const serverStatus = document.getElementById('server-status');
    const serverStatusText = serverStatus.querySelector('.status-text');
    const hwStatus = document.getElementById('hardware-status');
    const hwStatusText = hwStatus.querySelector('.status-text');
    
    // Sensors
    const gasValueStr = document.getElementById('gas-value');
    const gasGauge = document.getElementById('gas-gauge');
    const gasStatus = document.getElementById('gas-status');
    const gasBadge = document.getElementById('gas-badge');
    const flameStatus = document.getElementById('flame-status');
    const flameCard = document.getElementById('flame-card');
    
    // Alarm Controls
    const alarmSiren = document.getElementById('alarm-siren');
    const alarmToggle = document.getElementById('alarm-toggle');
    const alarmPanel = document.getElementById('alarm-panel');
    const alarmToggleText = document.getElementById('alarm-toggle-text');
    
    const alertLog = document.getElementById('alert-log');
    const simulateBtn = document.getElementById('simulate-btn');
    const clockDisplay = document.getElementById('live-clock');

    const CIRCUMFERENCE = 125.6; 
    
    setInterval(() => {
        const now = new Date();
        clockDisplay.textContent = now.toLocaleTimeString([], { hour12: false });
    }, 1000);

    function addLog(message, type = 'info') {
        const li = document.createElement('li');
        li.className = `incident-item ${type}`;
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        li.textContent = `[${time}] ${message}`;
        alertLog.insertBefore(li, alertLog.firstChild);
        if (alertLog.children.length > 15) alertLog.removeChild(alertLog.lastChild);
    }

    if (simulateBtn) {
        simulateBtn.addEventListener('click', async () => {
            try {
                simulateBtn.disabled = true;
                simulateBtn.textContent = 'Simulating...';
                await fetch('/api/simulate-hazard', { method: 'POST' });
                addLog('Simulation triggered.', 'info');
                setTimeout(() => {
                    simulateBtn.disabled = false;
                    simulateBtn.textContent = 'Simulate Test Hazard';
                }, 5000);
            } catch (error) {
                simulateBtn.disabled = false;
            }
        });
    }

    let alarmEnabled = false;
    alarmToggle.addEventListener('change', () => {
        alarmEnabled = alarmToggle.checked;
        alarmToggleText.textContent = alarmEnabled ? 'ON' : 'OFF';
        if (alarmEnabled) {
            alarmPanel.classList.add('alarm-on');
            addLog('Alarm ARMED.', 'info');
            alarmSiren.play().then(() => { alarmSiren.pause(); }).catch(e => {});
        } else {
            alarmPanel.classList.remove('alarm-on');
            alarmSiren.pause();
            alarmSiren.currentTime = 0;
            addLog('Alarm DISARMED.', 'info');
        }
    });

    socket.on('connect', () => {
        serverStatus.classList.add('online');
        serverStatusText.textContent = 'CONNECTED';
    });

    socket.on('device-status', (data) => {
        if (!data.isDeviceConnected) {
            hwStatus.classList.remove('online');
            hwStatusText.textContent = 'DISCONNECTED';
        }
    });

    socket.on('sensor-data', (data) => {
        let { gasLevel, flameDetected, isDeviceConnected } = data;
        
        if (isDeviceConnected) {
            hwStatus.classList.add('online');
            hwStatusText.textContent = 'ACTIVE';
        } else {
            hwStatus.classList.remove('online');
            hwStatusText.textContent = 'DISCONNECTED';
        }
        
        if (gasValueStr) gasValueStr.textContent = gasLevel;
        const percent = Math.min(Math.max(gasLevel / 2000, 0), 1);
        const offset = CIRCUMFERENCE - (percent * CIRCUMFERENCE);
        if (gasGauge) gasGauge.style.strokeDashoffset = offset;
        
        let state = 'normal';
        let statusText = 'SAFE';
        
        if (gasLevel > 800) {
            state = 'danger';
            statusText = 'CRITICAL';
            addLog(`Hazard: ${gasLevel} PPM`, 'danger');
        } else if (gasLevel > 300) {
            state = 'warning';
            statusText = 'CAUTION';
        }
        
        gasBadge.className = `badge ${state}`;
        gasBadge.textContent = state;
        gasStatus.textContent = statusText;
        gasGauge.style.stroke = state === 'danger' ? 'var(--accent-danger)' : (state === 'warning' ? 'var(--accent-warn)' : 'var(--accent-green)');

        if (flameDetected) {
            flameStatus.textContent = "FIRE";
            flameCard.classList.add("danger");
        } else {
            flameStatus.textContent = "SECURE";

          }

        if (alarmEnabled && (gasLevel > 800 || flameDetected)) {
            if (alarmSiren.paused) alarmSiren.play().catch(e => {});
        } else if (!alarmSiren.paused) {
            alarmSiren.pause();
            alarmSiren.currentTime = 0;
        }
    });
});
